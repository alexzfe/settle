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
