import { z } from "zod";
import { CoreError } from "../errors.js";
import type { OperationContext } from "../registry.js";
import type { HomeRow, SessionRow } from "../store.js";

export const homeInput = z.string().min(1).describe("The Home's slug.");

export const sessionInput = z
  .string()
  .min(1)
  .describe("The id of this conversation's open Session, as open_session returned it.");

/** The Home the call is scoped to. */
export function requireHome(context: OperationContext): HomeRow {
  if (!context.home) throw new CoreError("validation", "Pass `home`, the slug of the Home.");
  const home = context.store.home(context.home);
  if (!home) {
    throw new CoreError(
      "not_found",
      `The app has no Home "${context.home}". If this is a Home Folder, set it up again from the ` +
        "Home's page in the app.",
    );
  }
  return home;
}

/**
 * The Session the Agent's call carries, which must belong to `home`. For a write it must also be
 * open: a closed Session's id is refused, pointing the AI at open_session.
 */
export function requireSession(
  context: OperationContext,
  home: HomeRow,
  { open }: { open: boolean },
): SessionRow {
  const { caller } = context;
  if (caller.kind !== "session") {
    throw new CoreError("validation", "Only the Agent calls this, on behalf of a Session.");
  }
  if (!caller.session) {
    throw new CoreError(
      "session_required",
      "This call needs a Session: call open_session first, then pass the id it returns as " +
        "`session`.",
    );
  }
  const session = context.store.session(caller.session);
  // A Session of another Home is reported as unknown: the AI never learns of other Homes.
  if (!session || session.homeId !== home.id) {
    throw new CoreError(
      "unknown_session",
      `This Home has no Session "${caller.session}". Call open_session to open one, then pass ` +
        "the id it returns as `session`.",
    );
  }
  if (open && session.closedAt !== null) {
    throw new CoreError(
      "session_closed",
      `Session "${session.slug}" is closed: close_session saved its summary. Call open_session ` +
        "without `session` to start a new Session, then retry with the id it returns.",
    );
  }
  return session;
}

/** The change log's origin for the caller: its Session's slug, or "web". */
export function originOf(context: OperationContext, session?: SessionRow): string {
  if (context.caller.kind === "web") return "web";
  if (!session) throw new Error("An Agent write needs its Session");
  return session.slug;
}
