import { randomInt } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { mupdfRenderer } from "./blueprints/mupdf.js";
import { CoreError } from "./errors.js";
import { type ChangeEvent, type ChangeListener, EventBus } from "./events.js";
import { type FileStore, nodeFileStore, type PdfRenderer } from "./files.js";
import {
  getBlueprintPage,
  listBlueprints,
  uploadBlueprint,
  viewImages,
} from "./operations/blueprints.js";
import { getChangeLog } from "./operations/changes.js";
import { listConstraints, setConstraints } from "./operations/constraints.js";
import {
  findDecisions,
  flagConflict,
  getDecision,
  listDecisions,
  recordFulfilment,
  resolveConflict,
  resolveFlag,
  saveDecision,
  setDecisionState,
} from "./operations/decisions.js";
import {
  createHome,
  getHome,
  listHomes,
  listSessions,
  saveHome,
  setUpHomeFolderOperation,
} from "./operations/homes.js";
import { findItems, listItems, saveItems } from "./operations/items.js";
import { listNotes, saveNote, searchNotes } from "./operations/notes.js";
import { saveGuides } from "./operations/purchases.js";
import { getRoom, getRoomSheet, saveRoom } from "./operations/rooms.js";
import { closeSession, openSession } from "./operations/sessions.js";
import { optional } from "./optional.js";
import type { CallContext, Operation, OperationContext } from "./registry.js";
import { openStore, type Store } from "./store.js";

export type { CallContext, Caller } from "./registry.js";

/**
 * The operation registry: every operation core offers, keyed by name. The Agent's tools are
 * listed in this order: the read tools, then the writes, then close_session.
 */
const operations = {
  create_home: createHome,
  list_homes: listHomes,
  get_home: getHome,
  set_up_home_folder: setUpHomeFolderOperation,
  list_sessions: listSessions,
  get_room: getRoom,
  list_items: listItems,
  list_constraints: listConstraints,
  list_notes: listNotes,
  get_change_log: getChangeLog,
  list_blueprints: listBlueprints,
  get_blueprint_page: getBlueprintPage,
  upload_blueprint: uploadBlueprint,
  list_decisions: listDecisions,
  resolve_flag: resolveFlag,
  resolve_conflict: resolveConflict,
  open_session: openSession,
  get_room_sheet: getRoomSheet,
  find_items: findItems,
  find_decisions: findDecisions,
  get_decision: getDecision,
  search_notes: searchNotes,
  view_images: viewImages,
  save_home: saveHome,
  save_room: saveRoom,
  save_items: saveItems,
  set_constraints: setConstraints,
  save_note: saveNote,
  save_decision: saveDecision,
  set_decision_state: setDecisionState,
  save_guides: saveGuides,
  record_fulfilment: recordFulfilment,
  flag_conflict: flagConflict,
  close_session: closeSession,
};

type Operations = typeof operations;
export type OperationName = keyof Operations;
/** What the operation takes: its input, or for the web UI its webInput when it has one. */
export type OperationInput<N extends OperationName> =
  Operations[N] extends Operation<infer Input, unknown, infer WebInput>
    ? z.input<Input> | z.input<WebInput>
    : never;
export type OperationOutput<N extends OperationName> = Awaited<
  ReturnType<Operations[N]["handler"]>
>;
export type AnyOperation = Operation<z.ZodObject, unknown>;

export interface CoreOptions {
  /** The SQLite database file, or ":memory:". */
  database?: string;
  /** Internal seam: a store already open, instead of `database`. */
  store?: Store;
  /** The port the MCP endpoint listens on, written into Home Folder .mcp.json files. */
  port?: number;
  /** This repository's root, written into Home Folder settings as the plugin marketplace. */
  repoRoot?: string;
  /**
   * The folder for uploads/ and rendered/: uploaded Blueprint files and their rendered pages. A
   * temporary folder, removed by close(), when left out.
   */
  dataDir?: string;
  files?: FileStore;
  /** Internal seam: renders Blueprint files; mupdf unless a test gives another. */
  renderPdf?: PdfRenderer;
  clock?: () => Date;
  random?: (max: number) => number;
  /** In LAN mode: the LAN listener's address, for each Quick Guide's phone URL. */
  lanUrl?: string;
}

export interface Core {
  /** The registry, in declaration order, for the adapters to build from. */
  readonly operations: readonly AnyOperation[];
  /** Validates `input` against the operation's schema, then runs it for the caller. */
  run<N extends OperationName>(
    name: N,
    context: CallContext,
    input: OperationInput<N>,
  ): Promise<OperationOutput<N>>;
  run(name: string, context: CallContext, input: unknown): Promise<unknown>;
  /** Hears every change after its write commits; the returned function stops listening. */
  subscribe(listener: ChangeListener): () => void;
  close(): void;
}

// packages/core/src or packages/core/dist, three levels below the repo root.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

export function createCore(options: CoreOptions = {}): Core {
  const store = options.store ?? openStore(options.database ?? ":memory:");
  const bus = new EventBus();
  const clock = options.clock ?? (() => new Date());
  const registry = new Map<string, AnyOperation>(
    Object.values(operations).map((operation) => [operation.name, operation as AnyOperation]),
  );
  let dataDir = options.dataDir;
  let temporaryDataDir: string | undefined;

  const base = {
    store,
    files: options.files ?? nodeFileStore,
    renderPdf: options.renderPdf ?? mupdfRenderer,
    dataDir(): string {
      if (dataDir === undefined) {
        temporaryDataDir = mkdtempSync(join(tmpdir(), "idh-data-"));
        dataDir = temporaryDataDir;
      }
      return dataDir;
    },
    now: () => clock().toISOString(),
    random: options.random ?? randomInt,
    homeFolder: { port: options.port ?? 4380, repoRoot: options.repoRoot ?? REPO_ROOT },
    ...optional({ lanUrl: options.lanUrl }),
    write<T>(origin: string, fn: Parameters<OperationContext["write"]>[1]): T {
      const events: ChangeEvent[] = [];
      const result = store.transaction(() =>
        fn((change) => {
          store.appendChange({
            homeId: change.home.id,
            at: clock().toISOString(),
            origin,
            recordKind: change.recordKind,
            recordId: change.record.id,
            recordSlug: change.record.slug,
            field: change.field ?? null,
            old: change.old,
            new: change.new,
            reason: change.reason ?? null,
          });
          const event = {
            home: change.home.slug,
            recordKind: change.recordKind,
            recordSlug: change.record.slug,
          };
          const seen = events.some(
            (other) =>
              other.recordKind === event.recordKind && other.recordSlug === event.recordSlug,
          );
          if (!seen) events.push(event);
        }),
      );
      for (const event of events) bus.publish(event);
      return result as T;
    },
  };

  return {
    operations: [...registry.values()],
    async run(name: string, context: CallContext, input: unknown): Promise<never> {
      const operation = registry.get(name);
      if (!operation) throw new CoreError("not_found", `There is no operation "${name}".`);
      const schema =
        context.caller.kind === "web" && operation.webInput ? operation.webInput : operation.input;
      const parsed = schema.safeParse(input ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
        );
        throw new CoreError("validation", `Invalid input for ${name}. ${issues.join("; ")}.`);
      }
      const data = parsed.data as Record<string, unknown>;
      const operationContext: OperationContext = {
        ...base,
        caller: withSession(context, data.session),
        home: context.home ?? (typeof data.home === "string" ? data.home : undefined),
      };
      return (await operation.handler(operationContext, parsed.data)) as never;
    },
    subscribe: (listener) => bus.subscribe(listener),
    close() {
      store.close();
      if (temporaryDataDir) rmSync(temporaryDataDir, { recursive: true, force: true });
    },
  };
}

/** The Agent passes its Session as a tool argument; core reads it from the caller. */
function withSession(context: CallContext, session: unknown): CallContext["caller"] {
  const { caller } = context;
  if (caller.kind !== "session" || typeof session !== "string") return caller;
  if (caller.session !== undefined && caller.session !== session) {
    throw new CoreError("validation", "The call names two different Sessions.");
  }
  return { kind: "session", session };
}
