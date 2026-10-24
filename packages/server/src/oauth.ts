import { createHash, randomBytes } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { get as httpsGet } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Core, CurrentConnection } from "@settle/core";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

// Settle as the OAuth 2.1 sign-in server Claude talks to (the MCP authorization spec, 2025-11-25,
// with CIMD). Claude's connector hits /mcp, gets a 401 pointing at the discovery documents, sends
// the user to /authorize, where Settle's own Allow page asks them, and then trades the code at
// /token for an access token and a refresh token, each bound to <origin>/mcp. Each Allow is one
// Connection of the Account (core's accounts.ts keeps them, every token as its SHA-256).
//
// Written by hand, no library, following the structure of the MCP TypeScript SDK's auth server
// (`mcpAuthRouter` in @modelcontextprotocol/sdk/server/auth: the metadata routes, the authorize,
// token and register handlers, and the bearer check), which is built for Express, so its shape is
// copied and not its code. For anything beyond these basics (scopes, consent memory, token
// introspection or revocation endpoints, JWT access tokens), panva/node-oidc-provider is the
// reference to draw on as needs grow.

/** The endpoints, under the origin. */
export const OAUTH_PATHS = {
  resourceMetadata: "/.well-known/oauth-protected-resource/mcp",
  serverMetadata: "/.well-known/oauth-authorization-server",
  authorize: "/authorize",
  resume: "/authorize/resume",
  token: "/token",
  register: "/register",
} as const;

/** The routes no Login is needed for: the discovery documents, the Allow page, /token, /register. */
export function isOAuthOpen(path: string): boolean {
  return (
    path === OAUTH_PATHS.authorize ||
    path === OAUTH_PATHS.token ||
    path === OAUTH_PATHS.register ||
    path.startsWith("/.well-known/oauth-")
  );
}

declare module "hono" {
  interface ContextVariableMap {
    /** The Connection whose access token let a request to /mcp through. */
    connection: CurrentConnection;
  }
}

/**
 * The bearer check for /mcp: a Connection's live access token, or the 401 whose header points
 * Claude at the discovery document. Claude reads that header only on a 401.
 */
export function checkConnection(c: Context, core: Core): CurrentConnection | Response {
  const given = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  const current = given === undefined ? undefined : core.accounts.connected(given);
  if (current) return current;
  const metadata = `${core.accounts.origin}${OAUTH_PATHS.resourceMetadata}`;
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${metadata}"${given === undefined ? "" : ', error="invalid_token"'}`,
  );
  const message =
    "Settle's MCP endpoint needs a Connection: add Settle as a connector in Claude and click " +
    "Allow on Settle's page. Its access token goes in Authorization: Bearer <token>.";
  return c.json({ error: { code: "unauthorized", message } }, 401);
}

/** The Connection the bearer check found; only /mcp, past the check, has one. */
export function connectionOf(c: Context): CurrentConnection {
  const connection = c.get("connection") as CurrentConnection | undefined;
  if (!connection) throw new Error(`${c.req.path} was reached without a Connection`);
  return connection;
}

/** A CIMD client's metadata document, fetched from its client id URL. */
export type ClientMetadataFetcher = (url: string) => Promise<unknown>;

export interface OAuthOptions {
  /** Fetches a CIMD client's metadata document; a test gives its own. */
  fetchClientMetadata?: ClientMetadataFetcher;
}

/** What the server's login gives the Allow page: the Account logged in, if any. */
export interface OAuthLogin {
  /** The Account the request's Login names, or undefined when it has none. */
  account(c: Context): { id: number; email: string } | undefined;
  /** The page attributes the login pages use: their HTML and their headers. */
  page(title: string, body: string[]): string;
  headers: Record<string, string>;
  escape(text: string): string;
  secure: boolean;
}

/** The hosted apps' callback: claude.ai, the desktop and phone apps. */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ALLOW_COOKIE = "settle_allow";
const ALLOW_MINUTES = 10;
/** A form or JSON body of an OAuth request: a few short fields. */
const BODY_LIMIT = 16 * 1024;

/**
 * Whether Settle sends codes to this redirect URI at all: Claude's hosted callback exactly, or
 * Claude Code's loopback callback on any port. Nothing else, so a code can only land with Claude
 * or on the user's own computer.
 */
export function redirectAllowed(uri: string): boolean {
  if (uri === CLAUDE_CALLBACK) return true;
  const url = parseUrl(uri);
  return (
    url !== undefined &&
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.pathname === "/callback" &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === ""
  );
}

/** Whether `uri` is one the client registered: exactly, or a loopback one with the port ignored. */
export function redirectRegistered(uri: string, registered: readonly string[]): boolean {
  if (registered.includes(uri)) return true;
  const url = parseUrl(uri);
  if (url?.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return false;
  return registered.some((each) => {
    const other = parseUrl(each);
    return (
      other !== undefined &&
      other.protocol === "http:" &&
      other.hostname === url.hostname &&
      other.pathname === url.pathname &&
      other.search === url.search
    );
  });
}

/** A client, as /authorize found it: who to name on the Allow page and where codes may go. */
interface Client {
  clientId: string;
  /** The host the Allow page names: never the name the client gives itself. */
  host: string;
  redirectUris: string[];
}

/** An /authorize request that passed every check: what the Allow page carries through. */
interface AuthorizationRequest {
  clientId: string;
  clientHost: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}

type Checked =
  | { outcome: "ok"; request: AuthorizationRequest }
  /** Shown as a page: the client or redirect URI can't be trusted with a redirect. */
  | { outcome: "page"; message: string }
  /** Sent back to the client at its redirect URI, as RFC 6749 says. */
  | { outcome: "redirect"; to: string };

/**
 * Adds the OAuth sign-in server's routes: the two discovery documents, /register, /authorize
 * with the Allow page, /authorize/resume after a login, and /token. Call inside the login
 * (auth.ts), which lets the open ones through.
 */
export function useOAuth(
  app: Hono,
  { core, login, options = {} }: { core: Core; login: OAuthLogin; options?: OAuthOptions },
): void {
  const { origin, mcpUrl } = core.accounts;
  const fetchMetadata = cached(options.fetchClientMetadata ?? fetchClientMetadata);
  // Allows given before a login, by the SHA-256 of the cookie that binds each to its browser.
  const pending = new Map<string, { request: AuthorizationRequest; until: number }>();

  const limit = bodyLimit({
    maxSize: BODY_LIMIT,
    onError: (c) =>
      oauthError(c, "invalid_request", "The request is far larger than it should be."),
  });
  app.post(OAUTH_PATHS.token, limit);
  app.post(OAUTH_PATHS.register, limit);
  app.post(OAUTH_PATHS.authorize, limit);

  // RFC 9728. The resource is the MCP URL exactly as the user adds it; Claude reads only the
  // first authorization server.
  const resourceMetadata = {
    resource: mcpUrl,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource_name: "Settle",
  };
  app.get(OAUTH_PATHS.resourceMetadata, (c) => c.json(resourceMetadata));
  // The same at the root, for a client that looks there first.
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(resourceMetadata));

  // RFC 8414. Without both client_id_metadata_document_supported and "none", Claude silently
  // falls back to DCR.
  app.get(OAUTH_PATHS.serverMetadata, (c) =>
    c.json({
      issuer: origin,
      authorization_endpoint: `${origin}${OAUTH_PATHS.authorize}`,
      token_endpoint: `${origin}${OAUTH_PATHS.token}`,
      registration_endpoint: `${origin}${OAUTH_PATHS.register}`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      scopes_supported: ["homes", "offline_access"],
      authorization_response_iss_parameter_supported: true,
    }),
  );

  // RFC 7591, the fallback for a client without CIMD. Every client is public: no secret is made.
  app.post(OAUTH_PATHS.register, async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    const uris = body?.redirect_uris;
    if (
      !Array.isArray(uris) ||
      uris.length === 0 ||
      uris.length > 10 ||
      !uris.every((uri) => typeof uri === "string" && redirectAllowed(uri))
    ) {
      return c.json(
        {
          error: "invalid_redirect_uri",
          error_description:
            `Settle sends codes only to ${CLAUDE_CALLBACK} or to ` +
            "http://localhost:<port>/callback or http://127.0.0.1:<port>/callback.",
        },
        400,
      );
    }
    const name = typeof body?.client_name === "string" ? body.client_name : undefined;
    const client = core.accounts.registerClient({
      redirectUris: uris as string[],
      ...(name ? { clientName: name } : {}),
    });
    return c.json(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        ...(client.clientName ? { client_name: client.clientName } : {}),
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
      { "cache-control": "no-store" },
    );
  });

  /** The client a client id names: its CIMD document, fetched, or its registration. */
  async function clientOf(clientId: string): Promise<Client | string> {
    if (clientId.startsWith("https://")) {
      let document: unknown;
      try {
        document = await fetchMetadata(clientId);
      } catch (error) {
        return `Settle couldn't read the client's metadata at ${clientId}: ${(error as Error).message}`;
      }
      const doc = document as Record<string, unknown> | null;
      if (doc?.client_id !== clientId) {
        return "The client's metadata document names a different client_id than its own URL.";
      }
      const uris = doc.redirect_uris;
      if (!Array.isArray(uris) || !uris.every((uri) => typeof uri === "string")) {
        return "The client's metadata document has no redirect_uris.";
      }
      return { clientId, host: new URL(clientId).host, redirectUris: uris };
    }
    const registered = core.accounts.registeredClient(clientId);
    if (!registered) return "Settle doesn't know that client_id. Connect again from Claude.";
    // A registered client has no URL of its own: it is named by where its codes go.
    const host = new URL(registered.redirectUris[0] ?? CLAUDE_CALLBACK).hostname;
    return { clientId, host, redirectUris: registered.redirectUris };
  }

  /** Every check of an authorization request (RFC 6749 4.1.1, PKCE, RFC 8707's resource). */
  async function check(params: Record<string, string | undefined>): Promise<Checked> {
    const clientId = params.client_id;
    if (!clientId) return { outcome: "page", message: "The request names no client_id." };
    const client = await clientOf(clientId);
    if (typeof client === "string") return { outcome: "page", message: client };
    const redirectUri = params.redirect_uri;
    if (
      !redirectUri ||
      !redirectAllowed(redirectUri) ||
      !redirectRegistered(redirectUri, client.redirectUris)
    ) {
      return {
        outcome: "page",
        message: "The request's redirect_uri is not one this client registered, or not Claude's.",
      };
    }
    const back = (error: string, description: string): Checked => ({
      outcome: "redirect",
      to: withParams(redirectUri, {
        error,
        error_description: description,
        ...(params.state === undefined ? {} : { state: params.state }),
        iss: origin,
      }),
    });
    if (params.response_type !== "code") {
      return back("unsupported_response_type", "Only response_type=code is supported.");
    }
    if (!params.code_challenge || params.code_challenge_method !== "S256") {
      return back("invalid_request", "PKCE is required: send code_challenge with method S256.");
    }
    if (params.resource !== mcpUrl) {
      return back("invalid_target", `The resource must be ${mcpUrl}.`);
    }
    return {
      outcome: "ok",
      request: {
        clientId,
        clientHost: client.host,
        redirectUri,
        codeChallenge: params.code_challenge,
        ...(params.state === undefined ? {} : { state: params.state }),
      },
    };
  }

  /** The Allow: a Connection and its code, sent back to the client with the state and iss. */
  function issue(accountId: number, request: AuthorizationRequest): string {
    const code = core.accounts.connect(accountId, request);
    // Which client id claude.ai sends is not yet known for sure: the log says, on the first one.
    console.info(`New Connection for Account ${accountId}, client ${request.clientId}`);
    return withParams(request.redirectUri, {
      code,
      ...(request.state === undefined ? {} : { state: request.state }),
      iss: origin,
    });
  }

  /** The page for a request Settle can't send back: a bad client or redirect URI. */
  const refusedPage = (c: Context, message: string) =>
    c.html(
      login.page("Settle", [
        `<p>${login.escape(message)}</p>`,
        "<p>Go back to Claude and connect Settle again.</p>",
      ]),
      400,
      login.headers,
    );

  app.get(OAUTH_PATHS.authorize, async (c) => {
    const checked = await check(c.req.query());
    if (checked.outcome === "page") return refusedPage(c, checked.message);
    if (checked.outcome === "redirect") return c.redirect(checked.to, 302);
    const account = login.account(c);
    return c.html(
      allowPage(login, checked.request, mcpUrl, account?.email),
      200,
      allowHeaders(login, checked.request),
    );
  });

  // The Allow page's buttons. Shown before any login, so the user always sees what is asking
  // before any sign-in (Google's included, which may remember its consent) can wave it through.
  app.post(OAUTH_PATHS.authorize, async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const params = Object.fromEntries(
      Object.entries(form).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const checked = await check(params);
    if (checked.outcome === "page") return refusedPage(c, checked.message);
    if (checked.outcome === "redirect") return c.redirect(checked.to, 303);
    const { request } = checked;
    if (params.decision !== "allow") {
      return c.redirect(
        withParams(request.redirectUri, {
          error: "access_denied",
          error_description: "The user cancelled.",
          ...(request.state === undefined ? {} : { state: request.state }),
          iss: origin,
        }),
        303,
      );
    }
    const account = login.account(c);
    if (account) return c.redirect(issue(account.id, request), 303);
    // Not logged in: the Allow waits, bound to this browser by a cookie, for the login to come
    // back to /authorize/resume.
    const token = newToken();
    const now = Date.now();
    for (const [key, { until }] of pending) if (until <= now) pending.delete(key);
    if (pending.size >= 1000) pending.delete(pending.keys().next().value as string);
    pending.set(tokenHash(token), { request, until: now + ALLOW_MINUTES * 60 * 1000 });
    setCookie(c, ALLOW_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: OAUTH_PATHS.authorize,
      secure: login.secure,
      maxAge: ALLOW_MINUTES * 60,
    });
    return c.redirect(`/login?next=${encodeURIComponent(OAUTH_PATHS.resume)}`, 303);
  });

  // After the login: the Allow this browser gave, now for the Account it logged in to. The login
  // check sends anyone without a Login to the login page first. Track C's Google sign-in comes
  // back here too, through the login page's `next`.
  app.get(OAUTH_PATHS.resume, (c) => {
    const account = login.account(c);
    const token = getCookie(c, ALLOW_COOKIE);
    const key = token === undefined ? undefined : tokenHash(token);
    const waiting = key === undefined ? undefined : pending.get(key);
    if (key !== undefined) pending.delete(key);
    deleteCookie(c, ALLOW_COOKIE, { path: OAUTH_PATHS.authorize, secure: login.secure });
    if (!account || !waiting || waiting.until <= Date.now()) {
      return refusedPage(c, "This sign-in has expired, or was started in another browser.");
    }
    const to = issue(account.id, waiting.request);
    // A page, not a redirect: after the login form's post, a redirect off this site would be
    // held to that page's form-action, which allows only this site.
    return c.html(
      login.page("Back to Claude", [
        `<meta http-equiv="refresh" content="0; url=${login.escape(to)}">`,
        `<p>Connected. <a href="${login.escape(to)}">Back to ${login.escape(waiting.request.clientHost)}</a></p>`,
      ]),
      200,
      login.headers,
    );
  });

  app.post(OAUTH_PATHS.token, async (c) => {
    if (!c.req.header("content-type")?.startsWith("application/x-www-form-urlencoded")) {
      return oauthError(
        c,
        "invalid_request",
        "Send the form as application/x-www-form-urlencoded.",
      );
    }
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const text = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
    // A public client sends its id in the form; one that sends it by Basic is read the same.
    const clientId = text("client_id") || basicClientId(c.req.header("authorization"));
    if (!clientId) return oauthError(c, "invalid_request", "Send client_id.");
    if (text("resource") !== "" && text("resource") !== mcpUrl) {
      return oauthError(c, "invalid_target", `Tokens here are only for ${mcpUrl}.`);
    }
    const grantType = text("grant_type");
    const result =
      grantType === "authorization_code"
        ? core.accounts.exchangeCode({
            code: text("code"),
            clientId,
            redirectUri: text("redirect_uri"),
            verifier: text("code_verifier"),
          })
        : grantType === "refresh_token"
          ? core.accounts.refresh({ refreshToken: text("refresh_token"), clientId })
          : undefined;
    if (!result) {
      return oauthError(c, "unsupported_grant_type", "Use authorization_code or refresh_token.");
    }
    if (result.outcome === "refused") return oauthError(c, "invalid_grant", result.why);
    return c.json(
      {
        access_token: result.grant.accessToken,
        token_type: "Bearer",
        expires_in: result.grant.expiresIn,
        refresh_token: result.grant.refreshToken,
      },
      200,
      NO_STORE,
    );
  });
}

/** The cookie binding a waiting Allow to its browser: 256 random bits, kept by its SHA-256. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

function oauthError(c: Context, error: string, description: string): Response {
  return c.json({ error, error_description: description }, 400, NO_STORE);
}

function basicClientId(header: string | undefined): string {
  const encoded = /^Basic (.+)$/.exec(header ?? "")?.[1];
  if (!encoded) return "";
  const [id = ""] = Buffer.from(encoded, "base64").toString("utf8").split(":");
  return decodeURIComponent(id);
}

function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

function withParams(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

/** "claude.ai", or what a loopback client is to the user. */
function clientLabel(host: string): string {
  return LOOPBACK_HOSTS.has(host) ? "A program on this computer" : host;
}

/** The Allow page: who asks, for what, and the two buttons. No Home picking: the chat picks. */
function allowPage(
  login: OAuthLogin,
  request: AuthorizationRequest,
  resource: string,
  email?: string,
): string {
  const hidden = (name: string, value: string | undefined) =>
    value === undefined
      ? []
      : [`<input type="hidden" name="${name}" value="${login.escape(value)}">`];
  return login.page("Connect to Settle", [
    `<p><strong>${login.escape(clientLabel(request.clientHost))}</strong> wants to use your ` +
      "Settle Account: read and change your Homes.</p>",
    email
      ? `<p class="hint">You're logged in as ${login.escape(email)}.</p>`
      : '<p class="hint">You\'ll log in to Settle next.</p>',
    '<form method="post" action="/authorize">',
    ...hidden("response_type", "code"),
    ...hidden("client_id", request.clientId),
    ...hidden("redirect_uri", request.redirectUri),
    ...hidden("code_challenge", request.codeChallenge),
    ...hidden("code_challenge_method", "S256"),
    ...hidden("state", request.state),
    // The resource was checked already; sent again so the post passes the same check.
    ...hidden("resource", resource),
    '<button type="submit" name="decision" value="allow">Allow</button> ',
    '<button type="submit" name="decision" value="cancel" class="secondary">Cancel</button>',
    "</form>",
  ]);
}

/**
 * The Allow page's headers: the login pages', with its form allowed to lead on to the client's
 * redirect URI, where the Allow and the Cancel both go.
 */
function allowHeaders(login: OAuthLogin, request: AuthorizationRequest): Record<string, string> {
  const csp = login.headers["content-security-policy"] ?? "";
  return {
    ...login.headers,
    "content-security-policy": csp.replace(
      "form-action 'self'",
      `form-action 'self' ${new URL(request.redirectUri).origin}`,
    ),
  };
}

// The CIMD fetch: a URL any client names, fetched by the server, so it must never reach inside
// the server's own network. https only, no private, loopback or link-local address (checked at
// connect time, so a DNS answer can't change between the check and the fetch), no redirects, a
// short timeout, a small size cap, and each answer kept a few minutes.

const METADATA_TIMEOUT_MS = 5_000;
const METADATA_MAX_BYTES = 64 * 1024;
const METADATA_CACHE_MS = 5 * 60 * 1000;

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["64:ff9b::", 96],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

/** Whether an address is one the server must never fetch from: private, loopback, and the like. */
export function addressBlocked(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return BLOCKED.check(mapped, "ipv4");
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** DNS, refusing any answer that names a blocked address. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 4);
    const blocked = addresses.find(({ address }) => addressBlocked(address));
    if (blocked || addresses.length === 0) {
      return callback(new Error(`${hostname} is a private address`), "", 4);
    }
    if (options.all)
      return (callback as never as (e: null, a: LookupAddress[]) => void)(null, addresses);
    const first = addresses[0] as LookupAddress;
    return callback(null, first.address, first.family);
  });
};

/** Fetches a CIMD document over https, refusing private addresses, slow answers and big ones. */
export function fetchClientMetadata(url: string): Promise<unknown> {
  const parsed = parseUrl(url);
  if (parsed?.protocol !== "https:") return Promise.reject(new Error("it isn't an https URL"));
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || (isIP(host) !== 0 && addressBlocked(host))) {
    return Promise.reject(new Error(`${host} is a private address`));
  }
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      parsed,
      { lookup: safeLookup, headers: { accept: "application/json" } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`it answered ${response.statusCode}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > METADATA_MAX_BYTES) request.destroy(new Error("it is too large"));
          else chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("it isn't JSON"));
          }
        });
        response.on("error", reject);
      },
    );
    request.setTimeout(METADATA_TIMEOUT_MS, () => request.destroy(new Error("it took too long")));
    request.on("error", reject);
  });
}

/** A fetcher whose answers are kept a few minutes, for at most a hundred clients. */
function cached(fetch: ClientMetadataFetcher): ClientMetadataFetcher {
  const answers = new Map<string, { document: unknown; until: number }>();
  return async (url) => {
    const now = Date.now();
    const kept = answers.get(url);
    if (kept && kept.until > now) return kept.document;
    const document = await fetch(url);
    if (answers.size >= 100) answers.delete(answers.keys().next().value as string);
    answers.set(url, { document, until: now + METADATA_CACHE_MS });
    return document;
  };
}
