import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { CoreError } from "./errors.js";
import type {
  AccountLinkKind,
  AccountLinkRow,
  AccountRow,
  ConnectionRow,
  OauthClientRow,
  Store,
} from "./store.js";

// Accounts, as the server's login pages and cookie check reach them: passwords, Google sign-in,
// Logins, the one-time links, and the Connections Settle's OAuth server (server/src/oauth.ts) makes and
// checks. The account and admin pages reach the rest through the web operations
// (operations/accounts.ts). Every token is stored as its SHA-256; the raw token exists only in the
// cookie, the link, or the client holding it.

/** The password hash of an Account made with Google, which has no password until it sets one. */
export const NO_PASSWORD = "";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;
export const LOGIN_DAYS = 30;
export const INVITE_DAYS = 7;
export const RESET_HOURS = 24;
/** A setup link lasts as long as an invite; each start of the server makes a new one anyway. */
export const SETUP_DAYS = 7;
/** A Connection's access token: Claude refreshes it on a 401, or up to 5 minutes before. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** An authorisation code, between the Allow and the client's exchange of it. */
export const CODE_MINUTES = 5;
/** A Connection unused this long has lapsed: its refresh token expires this long after last use. */
export const CONNECTION_DAYS = 90;

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

/** Whether the Account has a password; one made with Google has none until it sets one. */
export function hasPassword(account: AccountRow): boolean {
  return account.passwordHash !== NO_PASSWORD;
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

/** Who Google says signed in, from the ID token it gave at the code exchange. */
export interface GoogleIdentity {
  /** Google's permanent user id. */
  sub: string;
  email?: string;
  /** Only an email Google has verified may match an Account or redeem an invite. */
  emailVerified: boolean;
}

/**
 * A sign-in with Google: the Account, or why not. `unknown` covers an unverified email too, so
 * nothing about which emails have Accounts here leaks.
 */
export type GoogleLogInResult =
  | { outcome: "ok"; account: AccountRow }
  | { outcome: "unknown" }
  | { outcome: "disabled" }
  | { outcome: "linked_elsewhere" };

/** A Login, as the cookie check finds it. */
export interface CurrentLogin {
  login: number;
  account: AccountRow;
}

/** What /token hands a client: a new access token and, always, a new refresh token. */
export interface TokenGrant {
  accessToken: string;
  refreshToken: string;
  /** The access token's lifetime, in seconds. */
  expiresIn: number;
}

/** A code or refresh exchange: the grant, or why not, which the client is told as invalid_grant. */
export type GrantResult =
  | { outcome: "ok"; grant: TokenGrant }
  | { outcome: "refused"; why: string };

/** A Connection, as an access token finds it at /mcp. */
export interface CurrentConnection {
  connection: number;
  account: AccountRow;
}

/** The server's way to Accounts: the login pages, the cookie check, and the first run. */
export interface Accounts {
  /** The origin the server names itself by: the public origin, or the loopback one. */
  readonly origin: string;
  /** The MCP URL every Connection is for and every access token is bound to: `<origin>/mcp`. */
  readonly mcpUrl: string;
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
   * Finds the Account a Google sign-in is for: the one linked to its `sub`, always first, since
   * emails change; else the Account whose email is Google's verified email, which is linked to the
   * `sub` from then on. Never makes an Account: an invite does that (redeemWithGoogle).
   */
  googleLogIn(identity: GoogleIdentity): GoogleLogInResult;
  /**
   * Uses an invite link with Google instead of a password: makes the Account with Google's
   * verified email, linked to its `sub` and with no password. Refused like redeem: LINK_MISS as
   * not_found, and as validation an unverified email, a Google account already linked here, or an
   * email another Account has.
   */
  redeemWithGoogle(token: string, identity: GoogleIdentity): AccountRow;
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

  /** Stores a client that registers itself (RFC 7591), with a new client id. It has no secret. */
  registerClient(client: { clientName?: string; redirectUris: string[] }): OauthClientRow;
  /** A client that registered itself, by its id. */
  registeredClient(clientId: string): OauthClientRow | undefined;
  /**
   * The Allow: a new Connection of the Account for the client, and the one-time code that the
   * client exchanges for its tokens, with the PKCE S256 challenge it must answer then.
   */
  connect(
    accountId: number,
    request: { clientId: string; clientHost: string; redirectUri: string; codeChallenge: string },
  ): string;
  /**
   * Exchanges a code for the Connection's first tokens. The code works once, within
   * CODE_MINUTES, for the client and redirect URI it was made for, and with the PKCE verifier
   * whose S256 is its challenge. Any failed exchange of a real code ends its Connection, so a
   * code used twice takes the tokens of the first use with it (RFC 6749 4.1.2).
   */
  exchangeCode(exchange: {
    code: string;
    clientId: string;
    redirectUri: string;
    verifier: string;
  }): GrantResult;
  /**
   * Swaps a Connection's refresh token for new tokens. The refresh token is rotated: the one
   * given stops working, and the new one lasts CONNECTION_DAYS. A lapsed Connection is ended.
   */
  refresh(exchange: { refreshToken: string; clientId: string }): GrantResult;
  /**
   * The Connection an access token names, while it and the Connection last and its Account is
   * enabled. Marks the Connection used, at most once a minute, which keeps it from lapsing.
   */
  connected(accessToken: string): CurrentConnection | undefined;
  /** The Account's Connections that work, newest first. */
  connections(accountId: number): ConnectionRow[];
  /** Ends one of the Account's Connections at once; false when it has no such Connection. */
  disconnect(accountId: number, connectionId: number): boolean;
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

  const at = (offset: number) => new Date(clock().getTime() + offset).toISOString();
  const enabled = (accountId: number) => store.account(accountId)?.disabledAt === null;
  const lapsed = (connection: ConnectionRow) =>
    connection.refreshExpiresAt === null || connection.refreshExpiresAt <= now();

  /** New tokens for a Connection, its old refresh token void, all as one write's part. */
  const grant = (connectionId: number): TokenGrant => {
    const accessToken = newToken();
    const refreshToken = newToken();
    store.update("connections", connectionId, {
      refreshHash: tokenHash(refreshToken),
      refreshExpiresAt: at(CONNECTION_DAYS * DAY),
      lastUsedAt: now(),
    });
    store.insert("access_tokens", {
      tokenHash: tokenHash(accessToken),
      connectionId,
      expiresAt: at(ACCESS_TOKEN_SECONDS * 1000),
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_SECONDS };
  };
  const refused = (why: string): GrantResult => ({ outcome: "refused", why });
  /** Spent tokens and codes, lapsed Connections, and Allows whose code was never exchanged. */
  const prune = () => store.pruneConnections(now());

  return {
    origin,
    mcpUrl: `${origin}/mcp`,

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
      if (!account || !hasPassword(account)) {
        decoy ??= hashPassword("not anyone's password", cost);
        await passwordMatches(password, await decoy);
        return { outcome: "wrong" };
      }
      if (!(await passwordMatches(password, account.passwordHash))) return { outcome: "wrong" };
      if (account.disabledAt !== null) return { outcome: "disabled" };
      return { outcome: "ok", account };
    },

    googleLogIn({ sub, email, emailVerified }) {
      const linked = store.accountByGoogle(sub);
      if (linked) {
        return linked.disabledAt === null
          ? { outcome: "ok", account: linked }
          : { outcome: "disabled" };
      }
      if (!emailVerified || email === undefined) return { outcome: "unknown" };
      const account = store.accountByEmail(email.trim());
      if (!account) return { outcome: "unknown" };
      if (account.disabledAt !== null) return { outcome: "disabled" };
      // Linked to another Google account already: the email alone must not move the link.
      if (account.googleSub !== null) return { outcome: "linked_elsewhere" };
      store.update("accounts", account.id, { googleSub: sub });
      return { outcome: "ok", account: { ...account, googleSub: sub } };
    },

    redeemWithGoogle(token, { sub, email, emailVerified }) {
      return store.transaction(() => {
        const link = store.accountLink(tokenHash(token));
        if (!link || !usable(link, "invite")) throw new CoreError("not_found", LINK_MISS);
        if (!emailVerified || email === undefined) {
          throw new CoreError(
            "validation",
            "Google hasn't verified this Google account's email, so it can't be used to join. " +
              "Make your account with a password instead.",
          );
        }
        if (store.accountByGoogle(sub)) {
          throw new CoreError(
            "validation",
            "This Google account already has an account here. Log in with Google instead.",
          );
        }
        const clean = cleanEmail(email);
        if (store.accountByEmail(clean)) {
          throw new CoreError(
            "validation",
            "There is already an account with that email. Log in with it instead.",
          );
        }
        store.update("account_links", link.id, { usedAt: now() });
        return store.insert("accounts", {
          email: clean,
          passwordHash: NO_PASSWORD,
          admin: false,
          disabledAt: null,
          createdAt: now(),
          googleSub: sub,
        });
      });
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
          // A reset means the password may be known to someone else: Claude's Connections end too.
          store.deleteLogins(accountId);
          store.deleteConnections(accountId);
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
          googleSub: null,
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

    registerClient({ clientName, redirectUris }) {
      // A registered client no Connection uses after a day is only clutter: each fresh connect
      // of a DCR client registers anew.
      store.pruneOauthClients(at(-DAY));
      return store.insert("oauth_clients", {
        clientId: newToken(),
        clientName: clientName?.slice(0, 200) ?? null,
        redirectUris,
        createdAt: now(),
      });
    },

    registeredClient: (clientId) => store.oauthClient(clientId),

    connect(accountId, { clientId, clientHost, redirectUri, codeChallenge }) {
      const code = newToken();
      store.transaction(() => {
        prune();
        const connection = store.insert("connections", {
          accountId,
          clientId,
          clientHost,
          createdAt: now(),
          lastUsedAt: now(),
          refreshHash: null,
          refreshExpiresAt: null,
        });
        store.insert("authorization_codes", {
          codeHash: tokenHash(code),
          connectionId: connection.id,
          redirectUri,
          codeChallenge,
          expiresAt: at(CODE_MINUTES * 60 * 1000),
          usedAt: null,
        });
      });
      return code;
    },

    exchangeCode({ code, clientId, redirectUri, verifier }) {
      return store.transaction(() => {
        const row = store.authorizationCode(tokenHash(code));
        if (!row) return refused("That code is not one this server gave, or it has expired.");
        const end = (why: string) => {
          store.deleteConnection(row.connectionId);
          return refused(why);
        };
        if (row.usedAt !== null) return end("That code was used already.");
        store.update("authorization_codes", row.id, { usedAt: now() });
        const connection = store.connection(row.connectionId);
        if (!connection || row.expiresAt <= now()) return end("That code has expired.");
        if (connection.clientId !== clientId) return end("That code was given to another client.");
        if (row.redirectUri !== redirectUri) {
          return end("redirect_uri differs from the one the code was asked for with.");
        }
        if (!pkceMatches(verifier, row.codeChallenge)) {
          return end("code_verifier does not match the code_challenge.");
        }
        if (!enabled(connection.accountId)) return end("The Account is disabled.");
        return { outcome: "ok", grant: grant(connection.id) };
      });
    },

    refresh({ refreshToken, clientId }) {
      return store.transaction(() => {
        prune();
        const connection = store.connectionByRefresh(tokenHash(refreshToken));
        if (!connection || lapsed(connection)) {
          return refused("That refresh token doesn't work: it was replaced, ended, or lapsed.");
        }
        if (connection.clientId !== clientId) {
          return refused("That refresh token was given to another client.");
        }
        if (!enabled(connection.accountId)) return refused("The Account is disabled.");
        return { outcome: "ok", grant: grant(connection.id) };
      });
    },

    connected(accessToken) {
      const token = store.accessToken(tokenHash(accessToken));
      if (!token || token.expiresAt <= now()) return undefined;
      const connection = store.connection(token.connectionId);
      if (!connection || lapsed(connection)) return undefined;
      const account = store.account(connection.accountId);
      if (!account || account.disabledAt !== null) return undefined;
      // Last used to the minute is enough for the list, and spares a write per tool call.
      if (clock().getTime() - Date.parse(connection.lastUsedAt) > 60_000) {
        store.update("connections", connection.id, {
          lastUsedAt: now(),
          refreshExpiresAt: at(CONNECTION_DAYS * DAY),
        });
      }
      return { connection: connection.id, account };
    },

    connections: (accountId) =>
      store
        .connections(accountId)
        .filter((connection) => connection.refreshHash !== null && !lapsed(connection)),

    disconnect(accountId, connectionId) {
      const connection = store.connection(connectionId);
      if (connection?.accountId !== accountId) return false;
      store.deleteConnection(connection.id);
      return true;
    },
  };
}

/** PKCE S256 (RFC 7636): the verifier's SHA-256, in base64url, is the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const given = createHash("sha256").update(verifier).digest();
  const expected = Buffer.from(challenge, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
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
