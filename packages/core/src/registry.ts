import type { z } from "zod";
import type { RecordKind } from "./events.js";
import type { FileStore } from "./files.js";
import type { HomeRow, Store } from "./store.js";

/**
 * Who is calling. The Agent calls on behalf of a Session (absent only when open_session starts a
 * new one); the web UI calls as itself and needs no Session.
 */
export type Caller = { kind: "session"; session?: string } | { kind: "web" };

/** What an adapter passes with each call. */
export interface CallContext {
  caller: Caller;
  /** The Home's slug: from the MCP endpoint's URL, or from `home` in the web API's body. */
  home?: string;
}

/** One changed field of a record, or a created record when `field` is absent. */
export interface Change {
  home: HomeRow;
  recordKind: RecordKind;
  record: { id: number; slug: string };
  field?: string;
  old?: unknown;
  new?: unknown;
  /** Why, when the write said: an override of Provenance, a removal. */
  reason?: string;
}

/** What core hands an operation's handler along with the caller. */
export interface OperationContext extends CallContext {
  store: Store;
  files: FileStore;
  /** Now, as an ISO timestamp. */
  now(): string;
  /** A random integer from 0 up to, not including, `max`. */
  random(max: number): number;
  homeFolder: { port: number; repoRoot: string };
  /**
   * Runs `fn` as one write: in a transaction, with every change it logs appended to the change
   * log from `origin` (a Session slug, or "web"), and each changed record published on the event
   * bus once the transaction commits.
   */
  write<T>(origin: string, fn: (log: (change: Change) => void) => T): T;
}

/** Which adapters offer an operation: the MCP server, the web API, or both. */
export type OperationSurface = "agent" | "web" | "both";

export interface Operation<Input extends z.ZodObject = z.ZodObject, Output = unknown> {
  name: string;
  /** For an Agent operation, the MCP tool description: written for a new hire. */
  description: string;
  input: Input;
  readOnly: boolean;
  surface: OperationSurface;
  handler(context: OperationContext, input: z.output<Input>): Output | Promise<Output>;
  /** For an Agent operation, the text the AI reads, rendered from the result. */
  text?(output: Output): string;
}

export function defineOperation<Input extends z.ZodObject, Output>(
  operation: Operation<Input, Output>,
): Operation<Input, Output> {
  return operation;
}
