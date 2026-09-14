// The web API client: every operation is POST /api/<name> with JSON in and out, and a refusal
// comes back as { error: { code, message } } with a message written for the reader. The shapes
// are core's: the Zod schemas in packages/core/src/operations/ are their single source of truth.

import type {
  OperationName as CoreOperationName,
  OperationInput,
  OperationOutput,
  RoomDetail,
} from "@idh/core";

export type {
  ChangeEntry,
  Constraint,
  Door,
  Feature,
  Home,
  Item,
  Level,
  Note,
  Room,
  RoomDetail,
  Session,
  Wall,
  Window,
} from "@idh/core";

// @idh/core's own `Surface` names which adapters offer an operation, and it shadows the schema's
// Surface record in the package's exports; the record's type is taken from the Room detail.
export type Surface = RoomDetail["surfaces"][number];

/** An operation's input and output, as core's registry declares them. */
interface Shapes<Name extends CoreOperationName> {
  input: OperationInput<Name>;
  output: OperationOutput<Name>;
}

/** The operations the web UI calls. */
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
}

export type OperationName = keyof Operations;

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

export async function call<Op extends OperationName>(
  operation: Op,
  input: Operations[Op]["input"],
): Promise<Operations[Op]["output"]> {
  const url = `/api/${operation}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError("unreachable", "The server is not answering. Start it with pnpm dev.");
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok && body !== undefined) return body as Operations[Op]["output"];
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
