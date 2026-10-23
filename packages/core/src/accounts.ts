import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { CoreError } from "./errors.js";
import type { AccountLinkKind, AccountLinkRow, AccountRow, Store } from "./store.js";

// Accounts, as the server's login pages and cookie check reach them: passwords, Logins, and the
// one-time links. The account and admin pages reach the rest through the web operations
// (operations/accounts.ts). Every token is stored as its SHA-256; the raw token exists only in the
// cookie or the link.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;
export const LOGIN_DAYS = 30;
export const INVITE_DAYS = 7;
export const RESET_HOURS = 24;
/** A setup link lasts as long as an invite; each start of the server makes a new one anyway. */
export const SETUP_DAYS = 7;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** scrypt's cost: OWASP's parameters, about 128 MiB and a fraction of a second per hash. */
export interface PasswordCost {
  N: number;
  r: number;
  p: number;
}

export const PASSWORD_COST: PasswordCost = { N: 2 ** 17, r: 8, p: 1 };

const KEY_LENGTH = 32;

/** "scrypt$<N>$<r>$<p>$<salt>$<hash>", so the cost can be raised later and old hashes still check. */
export async function hashPassword(password: string, cost: PasswordCost): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, cost);
  return ["scrypt", cost.N, cost.r, cost.p, salt.toString("base64"), hash.toString("base64")].join(
    "$",
  );
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const given = await derive(password, Buffer.from(salt, "base64"), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function derive(password: string, salt: Buffer, { N, r, p }: PasswordCost): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    // Node's default limit is 32 MiB; N=2^17 with r=8 needs 128 MiB, so twice that is allowed.
    scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: 2 * 128 * N * r * p }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/**
 * A new token for a Login or a one-time link: 256 random bits. Always from the system's secure
 * random source, never the core's injected one, which a test makes predictable.
 */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** How a token is stored: its SHA-256, in hex. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A password's length rule, NIST's: long enough, nothing else asked. Undefined when it passes. */
export function passwordProblem(password: string): string | undefined {
  // Counted in characters as a person sees them, not UTF-16 units.
  const length = [...password].length;
  if (length < PASSWORD_MIN) {
    return `Use a password of at least ${PASSWORD_MIN} characters. A few words in a row is fine.`;
  }
  if (length > PASSWORD_MAX) return `Use a password of at most ${PASSWORD_MAX} characters.`;
  return undefined;
}

/** The email as given, trimmed, or a CoreError saying what is wrong with it. No email is sent. */
export function cleanEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(trimmed)) {
    throw new CoreError("validation", "Enter an email address, such as sam@example.com.");
  }
  return trimmed;
}

/** What a bad, used, or expired link is told: the same for every miss. */
export const LINK_MISS =
  "This link doesn't work. It may have been used already, or expired. Ask whoever runs this " +
  "server for a new one.";

export type LogInResult =
  | { outcome: "ok"; account: AccountRow }
  | { outcome: "wrong" }
  | { outcome: "disabled" };

/** A Login, as the cookie check finds it. */
export interface CurrentLogin {
  login: number;
  account: AccountRow;
}

/** The server's way to Accounts: the login pages, the cookie check, and the first run. */
export interface Accounts {
  /** How many Accounts there are; with none, the server prints a setup link. */
  count(): number;
  /**
   * A new setup link, `<origin>/setup/<token>`, voiding any made before; undefined once an
   * Account exists, since setup links are then void.
   */
  makeSetupLink(): string | undefined;
  /** Whether a link of this kind can be used now, for its page to show the form or the miss. */
  linkOpen(kind: AccountLinkKind, token: string): boolean;
  /** Checks an email and password. A wrong email and a wrong password read the same. */
  logIn(email: string, password: string): Promise<LogInResult>;
  /**
   * Uses a link: setup makes the Admin and claims every unclaimed Home, invite makes an Account,
   * reset sets the password and ends every Login. Returns the Account. A link that can't be used
   * is refused with LINK_MISS as not_found; a bad email or password, as validation.
   */
  redeem(
    kind: AccountLinkKind,
    token: string,
    form: { email?: string; password: string },
  ): Promise<AccountRow>;
  /** Starts a Login for the Account and returns the cookie's token. */
  startLogin(accountId: number, userAgent: string | undefined): string;
  /** The Login a cookie's token names, while it lasts and its Account is enabled. */
  current(token: string): CurrentLogin | undefined;
  /** Ends the Login a cookie's token names, if there is one. */
  endLogin(token: string): void;
}

interface AccountsDeps {
  store: Store;
  origin: string;
  cost: PasswordCost;
  clock: () => Date;
}

export function createAccounts({ store, origin, cost, clock }: AccountsDeps): Accounts {
  // Checked against when there is no such email, so a miss takes as long as a wrong password.
  let decoy: Promise<string> | undefined;
  const now = () => clock().toISOString();
  const usable = (link: AccountLinkRow | undefined, kind: AccountLinkKind) =>
    link !== undefined &&
    link.kind === kind &&
    link.usedAt === null &&
    link.expiresAt > now() &&
    (kind !== "setup" || store.accountCount() === 0);

  return {
    count: () => store.accountCount(),

    makeSetupLink() {
      if (store.accountCount() > 0) return undefined;
      const token = newToken();
      store.transaction(() => {
        for (const old of store.accountLinks("setup")) store.deleteAccountLink(old.id);
        insertLink(store, { kind: "setup", token, at: clock(), lasts: SETUP_DAYS * DAY });
      });
      return `${origin}/setup/${token}`;
    },

    linkOpen: (kind, token) => usable(store.accountLink(tokenHash(token)), kind),

    async logIn(email, password) {
      const account = store.accountByEmail(email.trim());
      if (!account) {
        decoy ??= hashPassword("not anyone's password", cost);
        await passwordMatches(password, await decoy);
        return { outcome: "wrong" };
      }
      if (!(await passwordMatches(password, account.passwordHash))) return { outcome: "wrong" };
      if (account.disabledAt !== null) return { outcome: "disabled" };
      return { outcome: "ok", account };
    },

    async redeem(kind, token, form) {
      const hash = tokenHash(token);
      if (!usable(store.accountLink(hash), kind)) throw new CoreError("not_found", LINK_MISS);
      const problem = passwordProblem(form.password);
      if (problem) throw new CoreError("validation", problem);
      const email = kind === "reset" ? undefined : cleanEmail(form.email ?? "");
      const passwordHash = await hashPassword(form.password, cost);
      // Checked again inside the write: the hash took a while, and another tab may have used it.
      return store.transaction(() => {
        const link = store.accountLink(hash);
        if (!link || !usable(link, kind)) throw new CoreError("not_found", LINK_MISS);
        store.update("account_links", link.id, { usedAt: now() });
        if (kind === "reset") {
          const accountId = link.accountId as number;
          store.update("accounts", accountId, { passwordHash });
          store.deleteLogins(accountId);
          return store.account(accountId) as AccountRow;
        }
        if (store.accountByEmail(email as string)) {
          throw new CoreError(
            "validation",
            "There is already an account with that email. Log in with it instead.",
          );
        }
        const account = store.insert("accounts", {
          email: email as string,
          passwordHash,
          admin: kind === "setup",
          disabledAt: null,
          createdAt: now(),
        });
        if (kind === "setup") {
          store.claimHomes(account.id);
          for (const other of store.accountLinks("setup")) store.deleteAccountLink(other.id);
        }
        return account;
      });
    },

    startLogin(accountId, userAgent) {
      const token = newToken();
      const at = clock();
      store.insert("logins", {
        tokenHash: tokenHash(token),
        accountId,
        createdAt: at.toISOString(),
        lastSeenAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + LOGIN_DAYS * DAY).toISOString(),
        userAgent: userAgent?.slice(0, 300) ?? null,
      });
      return token;
    },

    current(token) {
      const login = store.login(tokenHash(token));
      const at = clock();
      if (!login || login.expiresAt <= at.toISOString()) return undefined;
      const account = store.account(login.accountId);
      if (!account || account.disabledAt !== null) return undefined;
      // Last seen to the minute is enough for the Logins list, and spares a write per request.
      if (at.getTime() - Date.parse(login.lastSeenAt) > 60_000) {
        store.update("logins", login.id, { lastSeenAt: at.toISOString() });
      }
      return { login: login.id, account };
    },

    endLogin(token) {
      const login = store.login(tokenHash(token));
      if (login) store.deleteLogin(login.id);
    },
  };
}

/** Stores a new link's hash; the raw token is the caller's to hand out. */
export function insertLink(
  store: Store,
  {
    kind,
    token,
    at,
    lasts,
    accountId = null,
    madeBy = null,
  }: {
    kind: AccountLinkKind;
    token: string;
    at: Date;
    lasts: number;
    accountId?: number | null;
    madeBy?: number | null;
  },
): AccountLinkRow {
  return store.insert("account_links", {
    kind,
    tokenHash: tokenHash(token),
    accountId,
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + lasts).toISOString(),
    usedAt: null,
    madeBy,
  });
}

export const INVITE_MS = INVITE_DAYS * DAY;
export const RESET_MS = RESET_HOURS * HOUR;
