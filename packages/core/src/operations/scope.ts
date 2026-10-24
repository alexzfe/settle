import { z } from "zod";
import { CoreError } from "../errors.js";
import type { Caller, OperationContext } from "../registry.js";
import type { AccountRow, HomeRow, SessionRow, Store } from "../store.js";

export const homeInput = z.string().min(1).describe("The Home's slug.");

export const sessionInput = z
  .string()
  .min(1)
  .describe("The id of this conversation's open Session, as open_session returned it.");

/** The Home the call is scoped to, which the web caller's Account must own. */
export function requireHome(context: OperationContext): HomeRow {
  if (!context.home) throw new CoreError("validation", "Pass `home`, the slug of the Home.");
  return ownedHome(context.store, context.caller, context.home);
}

/**
 * The ownership check, the one wall between Accounts: the Home with this slug, if the caller may
 * reach it. The Agent through a Connection reaches only a Home its enabled Account owns; through a
 * Home Folder, the Home whose key the server checked; the web caller, only a Home its Account
 * owns; a Quick Guide's link, none by slug. Every refusal is the refusal for a Home that doesn't
 * exist, word for word, so nobody learns which Homes do.
 */
export function ownedHome(store: Store, caller: Caller, slug: string): HomeRow {
  const home = store.home(slug);
  if (home === undefined || !reaches(store, caller, home)) throw noSuchHome(slug);
  return home;
}

function reaches(store: Store, caller: Caller, home: HomeRow): boolean {
  switch (caller.kind) {
    case "session":
      return caller.account === undefined || ownsEnabled(store, caller.account, home);
    case "web":
      return home.accountId === caller.account;
    case "guide":
      return false;
  }
}

function ownsEnabled(store: Store, accountId: number, home: HomeRow): boolean {
  return home.accountId === accountId && store.account(accountId)?.disabledAt === null;
}

/**
 * The Home of the Session with this slug, for the Agent through a Connection: undefined when there
 * is no such Session or its Home is not the enabled Account's, so both read as an unknown Session.
 */
export function connectedSessionHome(
  store: Store,
  accountId: number,
  slug: string,
): HomeRow | undefined {
  const session = store.session(slug);
  if (!session) return undefined;
  const home = store.homesOf(accountId).find((each) => each.id === session.homeId);
  return home && ownsEnabled(store, accountId, home) ? home : undefined;
}

/**
 * The web caller's Account. The server lets only an enabled Account's Login through, but a call
 * made as one disabled meanwhile is refused here too.
 */
export function requireAccount(context: OperationContext): AccountRow {
  const { caller } = context;
  const account = caller.kind === "web" ? context.store.account(caller.account) : undefined;
  if (!account || account.disabledAt !== null) {
    throw new CoreError("validation", "Only someone logged in to the app can do this.");
  }
  return account;
}

/** The web caller's Account, which must be the Admin's. */
export function requireAdmin(context: OperationContext): AccountRow {
  const account = requireAccount(context);
  if (!account.admin) {
    throw new CoreError("validation", "Only the Admin, who runs this server, can do this.");
  }
  return account;
}

export function noSuchHome(slug: string): CoreError {
  return new CoreError(
    "not_found",
    `The app has no Home "${slug}". If this is a Home Folder, set it up again from the ` +
      "Home's page in the app.",
  );
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
  if (!session || session.homeId !== home.id) throw unknownSession(caller.session);
  if (open && session.closedAt !== null) {
    throw new CoreError(
      "session_closed",
      `Session "${session.slug}" is closed: close_session saved its summary. Call open_session ` +
        "without `session` to start a new Session, then retry with the id it returns.",
    );
  }
  return session;
}

/** The refusal for a Session the caller can't reach, the same whether or not it exists. */
export function unknownSession(slug: string): CoreError {
  return new CoreError(
    "unknown_session",
    `This Home has no Session "${slug}". Call open_session to open one, then pass the id it ` +
      "returns as `session`.",
  );
}

/** The change log's origin for the caller: its Session's slug, or "web". */
export function originOf(context: OperationContext, session?: SessionRow): string {
  if (context.caller.kind === "web") return "web";
  if (!session) throw new Error("An Agent write needs its Session");
  return session.slug;
}
