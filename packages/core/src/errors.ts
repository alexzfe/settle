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
  | "city_not_found"
  | "folder_belongs_to_other_home"
  | "home_folder_unusable";

export class CoreError extends Error {
  readonly code: CoreErrorCode;

  constructor(code: CoreErrorCode, message: string) {
    super(message);
    this.name = "CoreError";
    this.code = code;
  }
}
