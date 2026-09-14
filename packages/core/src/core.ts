import { randomInt } from "node:crypto";
import { join } from "node:path";
import type { z } from "zod";
import { CoreError } from "./errors.js";
import { type ChangeEvent, type ChangeListener, EventBus } from "./events.js";
import { type FileStore, nodeFileStore } from "./files.js";
import {
  createHome,
  getHome,
  listHomes,
  listSessions,
  setUpHomeFolderOperation,
} from "./operations/homes.js";
import { getRoomSheet, saveRoom } from "./operations/rooms.js";
import { closeSession, openSession } from "./operations/sessions.js";
import type { CallContext, Operation, OperationContext } from "./registry.js";
import { openStore, type Store } from "./store.js";

export type { CallContext, Caller } from "./registry.js";

/** The operation registry: every operation core offers, keyed by name. */
const operations = {
  create_home: createHome,
  list_homes: listHomes,
  get_home: getHome,
  set_up_home_folder: setUpHomeFolderOperation,
  list_sessions: listSessions,
  open_session: openSession,
  save_room: saveRoom,
  get_room_sheet: getRoomSheet,
  close_session: closeSession,
};

type Operations = typeof operations;
export type OperationName = keyof Operations;
export type OperationInput<N extends OperationName> = z.input<Operations[N]["input"]>;
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
  files?: FileStore;
  clock?: () => Date;
  random?: (max: number) => number;
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

  const base = {
    store,
    files: options.files ?? nodeFileStore,
    now: () => clock().toISOString(),
    random: options.random ?? randomInt,
    homeFolder: { port: options.port ?? 4380, repoRoot: options.repoRoot ?? REPO_ROOT },
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
      const parsed = operation.input.safeParse(input ?? {});
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
    close: () => store.close(),
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
