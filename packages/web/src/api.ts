// The web API client: every operation is POST /api/<name> with JSON in and out, and a refusal
// comes back as { error: { code, message } } with a message written for the reader. The shapes
// are core's: the Zod schemas in packages/core/src/operations/ are their single source of truth.
// Uploads are the exception to JSON: they post a multipart form, and answer the same way.

import type {
  OperationName as CoreOperationName,
  DecisionReceiptResult,
  ExportGuidesInput,
  ExportShoppingListInput,
  GetDecisionResult,
  GetDecisionWebInput,
  GetShoppingInput,
  GetShoppingResult,
  ListDecisionsInput,
  ListDecisionsResult,
  ListingResult,
  OperationInput,
  OperationOutput,
  ResolveConflictInput,
  ResolveFlagInput,
  RoomDetail,
  SetDecisionStateWebInput,
  UploadBlueprintResult,
} from "@settle/core";

export type {
  BasisEntry,
  Blueprint,
  BlueprintPage,
  ChangeEntry,
  Conflict,
  Constraint,
  DecisionDetail,
  DecisionKind,
  DecisionState,
  DecisionSummary,
  Deviation,
  Door,
  EvidenceEntry,
  Feature,
  Flag,
  FlagCause,
  FullGuide,
  Guides,
  Held,
  HoldReason,
  Home,
  Item,
  Level,
  ListDecisionsInput,
  Listing,
  ListingCheck,
  Note,
  QuickGuide,
  QuickGuideLine,
  Requirement,
  Resolution,
  Room,
  RoomDetail,
  Session,
  ShoppingEntry,
  Wall,
  Window,
} from "@settle/core";

// @settle/core's own `Surface` names which adapters offer an operation, and it shadows the schema's
// Surface record in the package's exports; the record's type is taken from the Room detail.
export type Surface = RoomDetail["surfaces"][number];

/** An operation's input and output, as core's registry declares them. */
interface Shapes<Name extends CoreOperationName> {
  input: OperationInput<Name>;
  output: OperationOutput<Name>;
}

/** The operations the web UI calls with JSON. */
export interface Operations {
  list_homes: Shapes<"list_homes">;
  create_home: Shapes<"create_home">;
  get_home: Shapes<"get_home">;
  set_up_home_folder: Shapes<"set_up_home_folder">;
  list_sessions: Shapes<"list_sessions">;
  get_room: Shapes<"get_room">;
  list_items: Shapes<"list_items">;
  list_constraints: Shapes<"list_constraints">;
  list_notes: Shapes<"list_notes">;
  get_change_log: Shapes<"get_change_log">;
  list_blueprints: Shapes<"list_blueprints">;
  // The Decision operations, from their schemas: get_decision and set_decision_state are shared
  // with the Agent, and the web calls them with their web inputs (no Session, reason optional).
  list_decisions: { input: ListDecisionsInput; output: ListDecisionsResult };
  get_decision: { input: GetDecisionWebInput; output: GetDecisionResult };
  set_decision_state: { input: SetDecisionStateWebInput; output: DecisionReceiptResult };
  resolve_flag: { input: ResolveFlagInput; output: DecisionReceiptResult };
  resolve_conflict: { input: ResolveConflictInput; output: DecisionReceiptResult };
  get_shopping: { input: GetShoppingInput; output: GetShoppingResult };
  // The board's own writes: the first Listings have ever had from the web.
  drop_listing: Shapes<"drop_listing">;
  hold_listing: Shapes<"hold_listing">;
}

export type OperationName = keyof Operations;

/** The operations the web UI calls with a multipart form, and what they answer. */
export interface Uploads {
  upload_blueprint: UploadBlueprintResult;
  /** The board's paste box: the bytes the user pasted, or an image URL for the app to fetch. */
  set_listing_photo: ListingResult;
}

export type UploadName = keyof Uploads;

/** A refusal from the server, or a failure to reach it, with a code the UI can branch on. */
export class ApiError extends Error {
  readonly code: string;
  /** The HTTP status, absent when the server could not be reached. */
  readonly status: number | undefined;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function call<Op extends OperationName>(
  operation: Op,
  input: Operations[Op]["input"],
): Promise<Operations[Op]["output"]> {
  return send(`/api/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Posts `form` as multipart form data; the browser sets the Content-Type and its boundary. */
export function upload<Op extends UploadName>(operation: Op, form: FormData): Promise<Uploads[Op]> {
  return send(`/api/${operation}`, { method: "POST", body: form });
}

/**
 * Where the server serves a Listing's stored picture. `v` is the Listing's photoVersion: the
 * server ignores it, but it changes whenever the stored bytes do, so a replaced picture arrives
 * at a new address and the browser cannot serve the old one back.
 */
export function listingPhotoUrl(home: string, listing: string, v?: string): string {
  const query = new URLSearchParams({ home, listing });
  if (v) query.set("v", v);
  return `/api/get_listing_photo?${query}`;
}

/** Where the server serves one page of a Blueprint, rendered as a PNG. */
export function blueprintPageUrl(home: string, blueprint: string, page: number): string {
  return `/api/get_blueprint_page?${new URLSearchParams({ home, blueprint, page: String(page) })}`;
}

// The exports are files, rendered by the server from stored data, so the pages link to them.

/** Where the server serves the Shopping List: a printable page, or a CSV file. */
export function shoppingListExportUrl(
  home: string,
  format: ExportShoppingListInput["format"],
): string {
  return `/api/export_shopping_list?${new URLSearchParams({ home, format })}`;
}

/** Where the server serves the Shopping Guides of one Purchase, or of every one with Guides. */
export function guidesExportUrl(
  home: string,
  format: ExportGuidesInput["format"],
  decision?: string,
): string {
  const query = new URLSearchParams({ home, format });
  if (decision) query.set("decision", decision);
  return `/api/export_guides?${query}`;
}

async function send<Output>(url: string, init: RequestInit): Promise<Output> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError("unreachable", "The server is not answering. Start it with pnpm dev.");
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok && body !== undefined) return body as Output;
  const error = errorIn(body);
  if (error) throw new ApiError(error.code, error.message, response.status);
  throw new ApiError(
    "unexpected_response",
    `${url} answered ${response.status} without an error message. Is the server running?`,
    response.status,
  );
}

function errorIn(body: unknown): { code: string; message: string } | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const { error } = body;
  if (typeof error !== "object" || error === null) return undefined;
  const { code, message } = error as Record<string, unknown>;
  return typeof code === "string" && typeof message === "string" ? { code, message } : undefined;
}
