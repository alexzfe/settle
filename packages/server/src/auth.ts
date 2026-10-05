import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import type { Core } from "@settle/core";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { FILE_HEADERS } from "./pages.js";

// The login (SETTLE_PASSWORD): one password the household shares, a signed session cookie, and,
// for the Agent, which has no cookie, each Home's own bearer key. Without a password the app asks
// for nothing, which config.ts allows only on loopback.

export interface AuthOptions {
  password: string;
  /** Random bytes kept in the data dir, so a session outlives a restart. */
  secret: Buffer;
  /** How long a failed login waits before answering: friction against guessing. */
  failureDelayMs?: number;
}

const COOKIE = "settle_session";
const SESSION_DAYS = 30;
const SECRET_FILE = "session-secret";

/** The data dir's session secret, made on first start, readable only by this user. */
export function sessionSecret(dataDir: string): Buffer {
  const path = join(dataDir, SECRET_FILE);
  try {
    writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readFileSync(path);
}

/**
 * Signs and checks session cookies. The key mixes the data dir's secret with the password, so a
 * session survives a restart, and changing the password logs everyone out.
 */
class Sessions {
  readonly #key: Buffer;
  readonly #password: Buffer;

  constructor(password: string, secret: Buffer) {
    this.#key = createHmac("sha256", secret).update(password).digest();
    this.#password = digest(password);
  }

  passwordMatches(given: string): boolean {
    return timingSafeEqual(digest(given), this.#password);
  }

  /** "<expiry in ms>.<signature>": the expiry is inside what is signed. */
  issue(now: number): string {
    const expires = String(now + SESSION_DAYS * 24 * 60 * 60 * 1000);
    return `${expires}.${this.#sign(expires)}`;
  }

  valid(cookie: string | undefined, now: number): boolean {
    const [expires, signature, ...rest] = (cookie ?? "").split(".");
    if (!expires || !signature || rest.length > 0 || !/^\d+$/.test(expires)) return false;
    const expected = Buffer.from(this.#sign(expires));
    const given = Buffer.from(signature);
    return (
      given.length === expected.length && timingSafeEqual(given, expected) && Number(expires) > now
    );
  }

  #sign(expires: string): string {
    return createHmac("sha256", this.#key).update(`session.${expires}`).digest("base64url");
  }
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/**
 * Adds the login: GET and POST /login, POST /logout, and, before every other route, the check.
 * Open without a session: /health (the container's healthcheck), the login itself, and each
 * Quick Guide's phone page by its token. A Home's MCP endpoint and its Home Folder script take
 * that Home's bearer key instead; the key opens nothing else. Call after the front door and
 * before the routes.
 */
export function useAuth(
  app: Hono,
  { core, publicOrigin, auth }: { core: Core; publicOrigin?: string; auth: AuthOptions },
): void {
  const sessions = new Sessions(auth.password, auth.secret);
  const failureDelayMs = auth.failureDelayMs ?? 1000;
  const secure = publicOrigin?.startsWith("https:") ?? false;

  app.use("*", async (c, next) => {
    if (isOpen(c) || sessions.valid(getCookie(c, COOKIE), Date.now())) return next();
    const home = keyedHome(c);
    if (home !== undefined && bearerMatches(c, core.homeToken(home))) return next();
    return refuse(c);
  });

  app.get("/login", (c) =>
    c.html(loginPage(safeNext(c.req.query("next")), false), 200, LOGIN_HEADERS),
  );
  app.post("/login", async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const password = typeof form.password === "string" ? form.password : "";
    const next = safeNext(typeof form.next === "string" ? form.next : undefined);
    if (!sessions.passwordMatches(password)) {
      await wait(failureDelayMs);
      return c.html(loginPage(next, true), 401, LOGIN_HEADERS);
    }
    setCookie(c, COOKIE, sessions.issue(Date.now()), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure,
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return c.redirect(next, 303);
  });
  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/", secure });
    return c.redirect("/login", 303);
  });
}

/** Without a password: /login has nothing to ask, so it goes where it was headed. */
export function useNoAuth(app: Hono): void {
  app.get("/login", (c) => c.redirect(safeNext(c.req.query("next")), 302));
  app.post("/logout", (c) => c.redirect("/", 303));
}

/** The routes no one needs a session for. Logging out is harmless without one. */
function isOpen(c: Context): boolean {
  const path = c.req.path;
  if (path === "/health" || path === "/login" || path === "/logout") return true;
  // A Quick Guide by its token; with ?home= it is the page by the guessable slug.
  return /^\/guide\/[^/]+$/.test(path) && c.req.query("home") === undefined;
}

/** The Home whose bearer key may open this request: its MCP endpoint, or its Home Folder script. */
function keyedHome(c: Context): string | undefined {
  const mcp = /^\/mcp\/homes\/([^/]+)$/.exec(c.req.path);
  if (mcp) return mcp[1];
  if (c.req.path === "/api/home_folder_script" && c.req.method === "GET") {
    return c.req.query("home");
  }
  return undefined;
}

function bearerMatches(c: Context, token: string | undefined): boolean {
  const given = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  if (token === undefined || given === undefined) return false;
  return timingSafeEqual(digest(given), digest(token));
}

function refuse(c: Context): Response {
  const path = c.req.path;
  if (path.startsWith("/mcp/")) {
    const message =
      "This Home's MCP endpoint needs the Home's key, sent as Authorization: Bearer <key>, as " +
      "the Home Folder's .mcp.json does. Run the Home Folder command from the Home's About page " +
      "in this folder again to write it.";
    c.header("WWW-Authenticate", "Bearer");
    return c.json({ error: { code: "unauthorized", message } }, 401);
  }
  const page = c.req.method === "GET" || c.req.method === "HEAD";
  if (path.startsWith("/api/") || path === "/events" || !page) {
    const message = "Log in first: open the app in a browser and enter the household's password.";
    return c.json({ error: { code: "unauthorized", message } }, 401);
  }
  const url = new URL(c.req.url);
  return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
}

/** A path on this site to go to after logging in; anything else, which could lead off it, is /. */
export function safeNext(next: string | undefined): string {
  // A backslash reads as a slash to a browser, and a control character can hide one.
  if (!next?.startsWith("/") || next.startsWith("//") || /[\\\p{Cc}]/u.test(next)) return "/";
  return next;
}

// The guide pages' policy, except that this page's one form may post back here, and its own
// origin is sent with the post, which the front door checks.
const LOGIN_HEADERS: Record<string, string> = {
  ...FILE_HEADERS,
  "content-security-policy": (FILE_HEADERS["content-security-policy"] ?? "").replace(
    "form-action 'none'",
    "form-action 'self'",
  ),
  "referrer-policy": "same-origin",
};

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The login page: one password field, no JavaScript, styled inline. */
export function loginPage(next: string, failed: boolean): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Log in to Settle</title>",
    "<style>",
    "body { font-family: system-ui, sans-serif; max-width: 22rem; margin: 15vh auto; padding: 0 1rem; color: #222; background: #fafaf7; }",
    "h1 { font-size: 1.4rem; font-weight: 600; }",
    "label { display: block; margin: 1rem 0 0.3rem; }",
    "input { box-sizing: border-box; width: 100%; padding: 0.5rem; font: inherit; border: 1px solid #bbb; border-radius: 4px; }",
    "button { margin-top: 1rem; padding: 0.5rem 1.2rem; font: inherit; border: 0; border-radius: 4px; background: #333; color: #fff; }",
    ".error { color: #a1260d; }",
    "@media (prefers-color-scheme: dark) { body { color: #eee; background: #1c1c1a; } input { background: #2a2a28; color: #eee; border-color: #555; } button { background: #eee; color: #222; } .error { color: #ff8a6b; } }",
    "</style>",
    "</head>",
    "<body>",
    "<h1>Settle</h1>",
    '<form method="post" action="/login">',
    `<input type="hidden" name="next" value="${escapeHtml(next)}">`,
    '<label for="password">Password</label>',
    '<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>',
    ...(failed ? ['<p class="error">That is not the password. Try again.</p>'] : []),
    '<button type="submit">Log in</button>',
    "</form>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
