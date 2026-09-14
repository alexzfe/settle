// The web API client: every operation is POST /api/<name> with JSON in and out, and a refusal
// comes back as { error: { code, message } } with a message written for the reader.

export interface Home {
  slug: string;
  name: string;
  country: string;
  city: string;
  latitude: number;
  homeFolderPath?: string;
}

export interface Level {
  slug: string;
  name: string;
  storey: number;
}

export interface Room {
  slug: string;
  name: string;
  /** The slug of the Level the Room is on. */
  level: string;
}

export interface SessionSummary {
  changed: string;
  open: string;
  next: string;
}

export interface Session {
  slug: string;
  skills: string[];
  openedAt: string;
  closedAt?: string;
  summary?: SessionSummary;
}

/** The operations the web UI calls, with their input and output shapes. */
export interface Operations {
  list_homes: { input: Record<string, never>; output: { homes: Home[] } };
  create_home: {
    input: { name: string; country: string; city: string; latitude?: number };
    output: { home: Home };
  };
  get_home: { input: { home: string }; output: { home: Home; levels: Level[]; rooms: Room[] } };
  set_up_home_folder: {
    input: { home: string; path: string };
    output: { path: string; files: string[] };
  };
  list_sessions: { input: { home: string }; output: { sessions: Session[] } };
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
