import { randomInt } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { type Accounts, createAccounts, PASSWORD_COST, type PasswordCost } from "./accounts.js";
import { mupdfRenderer } from "./blueprints/mupdf.js";
import { CoreError } from "./errors.js";
import { type ChangeEvent, type ChangeListener, EventBus } from "./events.js";
import { type FileStore, nodeFileStore, type PdfRenderer } from "./files.js";
import { type ImageFetcher, nodeImageFetcher } from "./images.js";
import {
  adminDeleteAccount,
  cancelInvite,
  changeEmail,
  changePassword,
  createInvite,
  createResetLink,
  deleteAccount,
  disableAccount,
  enableAccount,
  endLogins,
  exportAccount,
  getAccount,
  listAccounts,
  listInvites,
  listLogins,
  rotateGuideLink,
  rotateHomeKey,
} from "./operations/accounts.js";
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
import { addDocument, deleteDocument, editDocument, getDocument } from "./operations/documents.js";
import { findIndex } from "./operations/find-index.js";
import {
  createHome,
  getHome,
  homeFolderSetupOperation,
  listHomes,
  listSessions,
  saveHome,
} from "./operations/homes.js";
import { editItem, getItem } from "./operations/item-page.js";
import { findItems, listItems, saveItems } from "./operations/items.js";
import { listNotes, saveNote, searchNotes } from "./operations/notes.js";
import { addPhoto, deletePhoto, editPhoto, getPhoto, viewPhotos } from "./operations/photos.js";
import {
  dropListing,
  getListingPhoto,
  holdListing,
  recordListing,
  saveGuides,
  setListingPhoto,
} from "./operations/purchases.js";
import { getRoom, getRoomSheet, saveRoom } from "./operations/rooms.js";
import { ownedHome } from "./operations/scope.js";
import { closeSession, openSession } from "./operations/sessions.js";
import {
  exportGuides,
  exportShoppingList,
  getGuidePage,
  getShopping,
} from "./operations/shopping.js";
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
  home_folder_setup: homeFolderSetupOperation,
  list_sessions: listSessions,
  get_room: getRoom,
  list_items: listItems,
  get_item: getItem,
  list_constraints: listConstraints,
  list_notes: listNotes,
  get_change_log: getChangeLog,
  list_blueprints: listBlueprints,
  get_blueprint_page: getBlueprintPage,
  upload_blueprint: uploadBlueprint,
  list_decisions: listDecisions,
  get_shopping: getShopping,
  find_index: findIndex,
  export_shopping_list: exportShoppingList,
  export_guides: exportGuides,
  get_guide_page: getGuidePage,
  get_listing_photo: getListingPhoto,
  resolve_flag: resolveFlag,
  resolve_conflict: resolveConflict,
  drop_listing: dropListing,
  hold_listing: holdListing,
  set_listing_photo: setListingPhoto,
  add_photo: addPhoto,
  edit_photo: editPhoto,
  delete_photo: deletePhoto,
  get_photo: getPhoto,
  add_document: addDocument,
  edit_document: editDocument,
  delete_document: deleteDocument,
  get_document: getDocument,
  edit_item: editItem,
  open_session: openSession,
  get_room_sheet: getRoomSheet,
  find_items: findItems,
  find_decisions: findDecisions,
  get_decision: getDecision,
  search_notes: searchNotes,
  view_images: viewImages,
  view_photos: viewPhotos,
  save_home: saveHome,
  save_room: saveRoom,
  save_items: saveItems,
  set_constraints: setConstraints,
  save_note: saveNote,
  save_decision: saveDecision,
  set_decision_state: setDecisionState,
  save_guides: saveGuides,
  record_listing: recordListing,
  record_fulfilment: recordFulfilment,
  flag_conflict: flagConflict,
  close_session: closeSession,
  get_account: getAccount,
  change_password: changePassword,
  change_email: changeEmail,
  list_logins: listLogins,
  end_logins: endLogins,
  export_account: exportAccount,
  delete_account: deleteAccount,
  create_invite: createInvite,
  list_invites: listInvites,
  cancel_invite: cancelInvite,
  create_reset_link: createResetLink,
  list_accounts: listAccounts,
  disable_account: disableAccount,
  enable_account: enableAccount,
  admin_delete_account: adminDeleteAccount,
  rotate_home_key: rotateHomeKey,
  rotate_guide_link: rotateGuideLink,
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
  /**
   * The port the MCP endpoint listens on: without a public origin the app names itself
   * http://127.0.0.1:<port>, as in each Home Folder's .mcp.json.
   */
  port?: number;
  /**
   * When hosted: the origin the app is reached at, e.g. "https://settle.example.com", named by
   * the Home Folder files and each Quick Guide's phone URL instead of the port.
   */
  publicOrigin?: string;
  /**
   * The folder for uploads/ and rendered/: uploaded Blueprint files and their rendered pages. A
   * temporary folder, removed by close(), when left out.
   */
  dataDir?: string;
  files?: FileStore;
  /** Internal seam: renders Blueprint files; mupdf unless a test gives another. */
  renderPdf?: PdfRenderer;
  /** Internal seam: fetches a Listing's photo over HTTP; a test always gives its own. */
  fetchImage?: ImageFetcher;
  clock?: () => Date;
  random?: (max: number) => number;
  /** In LAN mode: the LAN listener's address, for each Quick Guide's phone URL. */
  lanUrl?: string;
  /** Internal seam: scrypt's cost for new password hashes; OWASP's unless a test gives a cheap one. */
  passwordCost?: PasswordCost;
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
  /**
   * The bearer key of the Home with this slug, for the server to check a request against;
   * undefined when there is no such Home, or it has no Account yet, or its Account is disabled.
   * No operation returns it to the Agent.
   */
  homeToken(home: string): string | undefined;
  /**
   * The ownership check, for a route that reads a Home without running an operation (the
   * events): refuses a Home the caller can't reach exactly as a Home that doesn't exist.
   */
  checkHome(context: CallContext, home: string): void;
  /** Logins, passwords and the one-time links, for the server's login pages and cookie check. */
  readonly accounts: Accounts;
  close(): void;
}

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
    fetchImage: options.fetchImage ?? nodeImageFetcher,
    dataDir(): string {
      if (dataDir === undefined) {
        temporaryDataDir = mkdtempSync(join(tmpdir(), "settle-data-"));
        dataDir = temporaryDataDir;
      }
      return dataDir;
    },
    now: () => clock().toISOString(),
    random: options.random ?? randomInt,
    passwordCost: options.passwordCost ?? PASSWORD_COST,
    origin: options.publicOrigin ?? `http://127.0.0.1:${options.port ?? 4380}`,
    ...optional({ publicOrigin: options.publicOrigin, lanUrl: options.lanUrl }),
    write<T>(origin: string, fn: Parameters<OperationContext["write"]>[1]): T {
      const events: ChangeEvent[] = [];
      // One moment per write, so a write's changes read as one event (the Item page's history).
      const at = clock().toISOString();
      const result = store.transaction(() =>
        fn((change) => {
          store.appendChange({
            homeId: change.home.id,
            at,
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
      if (context.caller.kind === "guide" && name !== "get_guide_page") {
        throw new CoreError("not_found", `There is no operation "${name}".`);
      }
      // The web caller is refused another Account's Home before its input is even read, so no
      // operation's validation can tell a Home that exists from one that doesn't.
      const named = context.home ?? (input as { home?: unknown } | undefined)?.home;
      if (context.caller.kind !== "session" && typeof named === "string" && named !== "") {
        ownedHome(store, context.caller, named);
      }
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
    homeToken(slug) {
      const home = store.home(slug);
      const owner = home?.accountId == null ? undefined : store.account(home.accountId);
      return owner && owner.disabledAt === null ? home?.token : undefined;
    },
    checkHome(context, home) {
      ownedHome(store, context.caller, home);
    },
    accounts: createAccounts({
      store,
      origin: base.origin,
      cost: base.passwordCost,
      clock,
    }),
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
