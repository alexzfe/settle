/**
 * Why core refused an operation. `code` is for adapters and the UI to branch on; `message` is
 * written for whoever reads it, the AI or the user, and says what to do next.
 */
export type CoreErrorCode =
  | "validation"
  | "not_found"
  | "unknown_session"
  | "session_required"
  | "session_closed"
  /** A value would be replaced by one of weaker Provenance without overrideProvenance. */
  | "weaker_provenance"
  /** A record can't be removed while something else still refers to it. */
  | "referenced_cannot_delete"
  /** An uploaded Blueprint file that renders to no pages: truncated, damaged, or empty. */
  | "no_pages"
  /** An uploaded file that is not a PDF, PNG, or JPEG (HEIC included, until conversion). */
  | "unsupported_file"
  /** A Decision state change the transitions table does not allow. */
  | "illegal_transition"
  /** An Agent state change without a reason. */
  | "reason_required"
  /** A Conflict raised, or a Fulfilment recorded, on a Decision that is not Locked. */
  | "not_locked"
  | "city_not_found";

export class CoreError extends Error {
  readonly code: CoreErrorCode;

  constructor(code: CoreErrorCode, message: string) {
    super(message);
    this.name = "CoreError";
    this.code = code;
  }
}
