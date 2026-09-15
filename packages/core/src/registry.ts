import type { z } from "zod";
import type { RecordKind } from "./events.js";
import type { FileStore, PdfRenderer } from "./files.js";
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
  /** Renders Blueprint files to page images and text lines. */
  renderPdf: PdfRenderer;
  /** The folder holding uploads/ and rendered/, which the stored Blueprint paths are relative to. */
  dataDir(): string;
  /** Now, as an ISO timestamp. */
  now(): string;
  /** A random integer from 0 up to, not including, `max`. */
  random(max: number): number;
  homeFolder: { port: number; repoRoot: string };
  /**
   * In LAN mode: the address of the listener phones on the user's network reach, e.g.
   * "http://192.168.1.20:4380", which serves only the Quick Guide pages by their tokens.
   */
  lanUrl?: string;
  /**
   * Runs `fn` as one write: in a transaction, with every change it logs appended to the change
   * log from `origin` (a Session slug, or "web"), and each changed record published on the event
   * bus once the transaction commits.
   */
  write<T>(origin: string, fn: (log: (change: Change) => void) => T): T;
}

/** Which adapters offer an operation: the MCP server, the web API, or both. */
export type OperationSurface = "agent" | "web" | "both";

export interface Operation<
  Input extends z.ZodObject = z.ZodObject,
  Output = unknown,
  WebInput extends z.ZodObject = Input,
> {
  name: string;
  /** For an Agent operation, the MCP tool description: written for a new hire. */
  description: string;
  input: Input;
  /**
   * For an operation both adapters offer whose web input differs (the Home instead of a Session,
   * say): what the web UI passes. The MCP tool's schema is always `input`.
   */
  webInput?: WebInput;
  readOnly: boolean;
  surface: OperationSurface;
  handler(
    context: OperationContext,
    input: z.output<Input> | z.output<WebInput>,
  ): Output | Promise<Output>;
  /** For an Agent operation, the text the AI reads, rendered from the result. */
  text?(output: Output): string;
  /**
   * For an Agent operation that shows pictures (view_images): the images, which the MCP tool
   * returns as image blocks after the text block, never as structuredContent.
   */
  images?(output: Output): { data: Uint8Array; mimeType: string }[];
}

export function defineOperation<
  Input extends z.ZodObject,
  Output,
  WebInput extends z.ZodObject = Input,
>(operation: Operation<Input, Output, WebInput>): Operation<Input, Output, WebInput> {
  return operation;
}
