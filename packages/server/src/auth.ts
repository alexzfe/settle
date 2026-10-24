import { createHash, timingSafeEqual } from "node:crypto";
import {
  type AccountLinkKind,
  type Caller,
  type Core,
  CoreError,
  LINK_MISS,
  LOGIN_DAYS,
  PASSWORD_MAX,
  PASSWORD_MIN,
} from "@settle/core";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { GOOGLE_PATHS, type GoogleOptions, useGoogle } from "./google.js";
import { clientIp, FailureLimiter, inWords, type TrustedProxy } from "./limits.js";
import { checkConnection, isOAuthOpen, type OAuthOptions, useOAuth } from "./oauth.js";
import { FILE_HEADERS } from "./pages.js";

// Accounts at the door. A browser logs in with an email and password, or through a one-time link
// (setup, invite, reset), or with Google when the server has it on (google.ts), and gets a cookie naming one of its Account's Logins, a row in core's
// database, so one can be ended without touching the others. The Agent has no cookie: on the
// Account's MCP endpoint, /mcp, a Connection's access token from Settle's OAuth server (oauth.ts)
// lets it in; on the older path, each Home's own bearer key opens that Home's MCP endpoint and its
// Home Folder script, and nothing else. There is no way in without one of them, on loopback too.

export interface AuthOptions {
  /** SETTLE_TRUSTED_PROXY: where the client IP comes from, for the failure limits. */
  trustedProxy?: TrustedProxy;
  /** The failure limits; a test gives its own, with its own clock. */
  failures?: FailureLimiter;
  /** The OAuth server's options: a test gives its own CIMD fetcher. */
  oauth?: OAuthOptions;
  /** Sign in with Google, when the server's owner set its client; absent, there is no button. */
  google?: GoogleOptions;
}

const COOKIE = "settle_login";
/** The most a login-type form may send: a few short fields. */
const FORM_LIMIT = 16 * 1024;

/**
 * Adds the login: the login-type pages, POST /logout, the OAuth server's routes, and, before every
 * other route, the check. Open without a Login: /health (the container's healthcheck), the
 * login-type pages, the OAuth discovery documents, /authorize, /token and /register, and each
 * Quick Guide's phone page by its token. /mcp takes a Connection's access token and nothing else.
 * A Home's MCP endpoint and its Home Folder script take that Home's bearer key instead; the key
 * opens nothing else. Call after the front door and before the routes.
 */
export function useAuth(
  app: Hono,
  { core, publicOrigin, auth = {} }: { core: Core; publicOrigin?: string; auth?: AuthOptions },
): void {
  const failures = auth.failures ?? new FailureLimiter();
  const secure = publicOrigin?.startsWith("https:") ?? false;
  const ipOf = (c: Context) => clientIp(c, auth.trustedProxy);
  const google = auth.google !== undefined;

  app.use("*", async (c, next) => {
    // The Account's MCP endpoint: a Connection's access token, never a Login or a Home's key.
    if (c.req.path === "/mcp") {
      const connection = checkConnection(c, core);
      if (connection instanceof Response) return connection;
      c.set("connection", connection);
      return next();
    }
    const token = getCookie(c, COOKIE);
    const current = token === undefined ? undefined : core.accounts.current(token);
    if (current) {
      const caller: Caller = {
        kind: "web",
        account: current.account.id,
        login: current.login,
      };
      c.set("caller", caller);
    }
    // The Allow page reads the Login, if there is one, but needs none.
    if (isOpen(c, google)) return next();
    const home = keyedHome(c);
    if (home !== undefined && bearerMatches(c, core.homeToken(home))) c.set("keyed", home);
    return current || c.get("keyed") !== undefined ? next() : refuse(c);
  });

  const formLimit = bodyLimit({
    maxSize: FORM_LIMIT,
    onError: (c) => c.html(noticePage("That form sent far more than it should."), 413, HEADERS),
  });
  for (const path of ["/login", "/logout", "/setup/:token", "/invite/:token", "/reset/:token"]) {
    app.post(path, formLimit);
  }

  /** Starts a Login for the Account and sends the browser on with its cookie. */
  const logIn = (c: Context, account: number, next: string) => {
    const token = core.accounts.startLogin(account, c.req.header("user-agent"));
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure,
      maxAge: LOGIN_DAYS * 24 * 60 * 60,
    });
    return c.redirect(next, 303);
  };

  /** The page for a locked pair or IP, saying when to try again. */
  const locked = (c: Context, until: number) => {
    c.header("Retry-After", String(Math.ceil((until - Date.now()) / 1000)));
    return c.html(
      noticePage(
        `Too many wrong tries from here. Try again ${inWords(until)}. If you've forgotten your ` +
          "password, ask whoever runs this server for a reset link.",
      ),
      429,
      HEADERS,
    );
  };

  app.get("/login", (c) =>
    c.html(loginPage({ next: safeNext(c.req.query("next")), google }), 200, HEADERS),
  );
  app.post("/login", async (c) => {
    const form = await readForm(c);
    const email = form.email.trim();
    const next = safeNext(form.next);
    const ip = ipOf(c);
    const until = failures.lockedUntil(ip, email);
    if (until) return locked(c, until);
    const result = await core.accounts.logIn(email, form.password);
    if (result.outcome === "ok") {
      failures.succeed(ip, email);
      return logIn(c, result.account.id, next);
    }
    if (result.outcome === "disabled") {
      const error = "This account is disabled. Ask whoever runs this server.";
      return c.html(loginPage({ next, email, error, google }), 403, HEADERS);
    }
    // The email as given and the IP, never the password.
    console.warn(`Failed login for ${JSON.stringify(email)} from ${ip}`);
    failures.fail(ip, email);
    const error = "That email and password don't match an account. Try again.";
    return c.html(loginPage({ next, email, error, google }), 401, HEADERS);
  });

  for (const kind of ["setup", "invite", "reset"] as const) {
    // Only an invite can be used with Google: the Admin sets up with a password, and a reset sets one.
    const googleFor = (token: string) => (google && kind === "invite" ? token : undefined);
    app.get(`/${kind}/:token`, (c) => {
      const token = c.req.param("token") ?? "";
      return core.accounts.linkOpen(kind, token)
        ? c.html(linkPage(kind, { google: googleFor(token) }), 200, HEADERS)
        : c.html(noticePage(LINK_MISS), 404, HEADERS);
    });
    app.post(`/${kind}/:token`, async (c) => {
      const form = await readForm(c);
      const ip = ipOf(c);
      // A link's token is too long to guess; this only keeps one IP from trying.
      const until = failures.lockedUntil(ip, `${kind} link`);
      if (until) return locked(c, until);
      const email = form.email.trim();
      const token = c.req.param("token") ?? "";
      if (form.password !== form.again) {
        const error = "The two passwords are different. Type the same one twice.";
        return c.html(linkPage(kind, { email, error, google: googleFor(token) }), 400, HEADERS);
      }
      try {
        const account = await core.accounts.redeem(kind, token, {
          ...(kind === "reset" ? {} : { email }),
          password: form.password,
        });
        return logIn(c, account.id, "/");
      } catch (error) {
        if (!(error instanceof CoreError)) throw error;
        if (error.code === "validation") {
          const page = linkPage(kind, { email, error: error.message, google: googleFor(token) });
          return c.html(page, 400, HEADERS);
        }
        console.warn(`Failed ${kind} link from ${ip}`);
        failures.fail(ip, `${kind} link`);
        return c.html(noticePage(LINK_MISS), 404, HEADERS);
      }
    });
  }

  if (auth.google) {
    useGoogle(app, {
      core,
      google: auth.google,
      login: {
        logIn,
        loginPage: (c, next, error, status) =>
          c.html(loginPage({ next, error, google }), status, HEADERS),
        invitePage: (c, token, error) =>
          c.html(linkPage("invite", { error, google: token }), 400, HEADERS),
        notice: (c, message, status) => c.html(noticePage(message), status, HEADERS),
        safeNext,
        secure,
      },
    });
  }

  useOAuth(app, {
    core,
    login: {
      account(c) {
        const token = getCookie(c, COOKIE);
        const current = token === undefined ? undefined : core.accounts.current(token);
        return current && { id: current.account.id, email: current.account.email };
      },
      page,
      headers: HEADERS,
      escape: escapeHtml,
      secure,
    },
    ...(auth.oauth ? { options: auth.oauth } : {}),
  });

  app.post("/logout", (c) => {
    const token = getCookie(c, COOKIE);
    if (token !== undefined) core.accounts.endLogin(token);
    deleteCookie(c, COOKIE, { path: "/", secure });
    return c.redirect("/login", 303);
  });
}

async function readForm(
  c: Context,
): Promise<{ email: string; password: string; again: string; next?: string }> {
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const text = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
  return {
    email: text("email"),
    password: text("password"),
    again: text("again"),
    ...(typeof form.next === "string" ? { next: form.next } : {}),
  };
}

/** The routes no one needs a Login for. Logging out is harmless without one. */
function isOpen(c: Context, google: boolean): boolean {
  const path = c.req.path;
  if (path === "/health" || path === "/login" || path === "/logout") return true;
  if (google && (path === GOOGLE_PATHS.start || path === GOOGLE_PATHS.callback)) return true;
  if (isOAuthOpen(path)) return true;
  if (/^\/(setup|invite|reset)\/[^/]+$/.test(path)) return true;
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

/** Whether the request's bearer key is `token`; never, when the Home has none that opens it. */
function bearerMatches(c: Context, token: string | undefined): boolean {
  const given = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  if (token === undefined || given === undefined) return false;
  return timingSafeEqual(digest(given), digest(token));
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
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
    const message = "Log in first: open the app in a browser and log in to your account.";
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

// The guide pages' policy, except that these pages' one form may post back here, and its own
// origin is sent with the post, which the front door checks.
const HEADERS: Record<string, string> = {
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

const STYLE = [
  "body { font-family: system-ui, sans-serif; max-width: 22rem; margin: 15vh auto; padding: 0 1rem; color: #222; background: #fafaf7; }",
  "h1 { font-size: 1.4rem; font-weight: 600; }",
  "label { display: block; margin: 1rem 0 0.3rem; }",
  "input { box-sizing: border-box; width: 100%; padding: 0.5rem; font: inherit; border: 1px solid #bbb; border-radius: 4px; }",
  "button { margin-top: 1rem; padding: 0.5rem 1.2rem; font: inherit; border: 0; border-radius: 4px; background: #333; color: #fff; }",
  "button.secondary { background: transparent; color: inherit; border: 1px solid #bbb; }",
  ".error { color: #a1260d; }",
  ".hint { color: #666; font-size: 0.9rem; }",
  "a.google { display: block; margin-top: 1rem; padding: 0.5rem 1.2rem; text-align: center; color: inherit; text-decoration: none; border: 1px solid #bbb; border-radius: 4px; }",
  ".or { margin: 1.5rem 0 0; color: #666; text-align: center; }",
  "@media (prefers-color-scheme: dark) { body { color: #eee; background: #1c1c1a; } input { background: #2a2a28; color: #eee; border-color: #555; } button { background: #eee; color: #222; } .error { color: #ff8a6b; } .hint { color: #aaa; } }",
];

/** A page in the login pages' style: no JavaScript, styled inline. */
function page(title: string, body: string[]): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    ...STYLE,
    "</style>",
    "</head>",
    "<body>",
    "<h1>Settle</h1>",
    ...body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** A page with one message: a link that doesn't work, a lock. */
function noticePage(message: string): string {
  return page("Settle", [`<p>${escapeHtml(message)}</p>`, '<p><a href="/login">Log in</a></p>']);
}

const emailField = (email: string, autofocus: boolean) =>
  '<label for="email">Email</label>\n' +
  `<input id="email" name="email" type="email" autocomplete="username" value="${escapeHtml(email)}" required${autofocus ? " autofocus" : ""}>`;

const errorLine = (error: string | undefined) =>
  error ? [`<p class="error">${escapeHtml(error)}</p>`] : [];

/** The Google button, a link: it leads to Google, and a form's post may not. */
const googleButton = (href: string, label: string) => [
  `<p><a class="google" href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`,
  '<p class="or">or</p>',
];

/** The login page: an email and a password, and Google when the server has it on. */
export function loginPage({
  next,
  email = "",
  error,
  google = false,
}: {
  next: string;
  email?: string;
  error?: string;
  google?: boolean;
}): string {
  return page("Log in to Settle", [
    ...(google
      ? googleButton(`${GOOGLE_PATHS.start}?next=${encodeURIComponent(next)}`, "Log in with Google")
      : []),
    '<form method="post" action="/login">',
    `<input type="hidden" name="next" value="${escapeHtml(next)}">`,
    emailField(email, email === ""),
    '<label for="password">Password</label>',
    `<input id="password" name="password" type="password" autocomplete="current-password" required${email === "" ? "" : " autofocus"}>`,
    ...errorLine(error),
    '<button type="submit">Log in</button>',
    "</form>",
  ]);
}

const INVITE_WITH_GOOGLE =
  "You've been invited. Join with your Google account, or make an account with your email and " +
  "a password.";

const LINK_PAGES: Record<AccountLinkKind, { title: string; intro: string; submit: string }> = {
  setup: {
    title: "Set up Settle",
    intro:
      "Make the Admin account: the one that runs this server and invites everyone else. Every " +
      "Home already here becomes yours.",
    submit: "Make the Admin account",
  },
  invite: {
    title: "Join Settle",
    intro: "You've been invited. Make your account: your email is what you'll log in with.",
    submit: "Make my account",
  },
  reset: {
    title: "Reset your password",
    intro: "Choose a new password. Every browser logged in to your account will be logged out.",
    submit: "Set my password",
  },
};

/**
 * The page a setup, invite, or reset link opens: email (not for a reset) and a new password. An
 * invite's page, given its token as `google`, also offers Join with Google.
 */
export function linkPage(
  kind: AccountLinkKind,
  { email = "", error, google }: { email?: string; error?: string; google?: string },
): string {
  const { title, intro, submit } = LINK_PAGES[kind];
  const withGoogle = kind === "invite" && google !== undefined;
  return page(title, [
    `<p>${escapeHtml(withGoogle ? INVITE_WITH_GOOGLE : intro)}</p>`,
    ...(withGoogle
      ? googleButton(
          `${GOOGLE_PATHS.start}?invite=${encodeURIComponent(google)}`,
          "Join with Google",
        )
      : []),
    // Back to this page's own address.
    '<form method="post">',
    ...(kind === "reset" ? [] : [emailField(email, true)]),
    '<label for="password">New password</label>',
    `<input id="password" name="password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" maxlength="${PASSWORD_MAX}" required${kind === "reset" ? " autofocus" : ""}>`,
    `<p class="hint">At least ${PASSWORD_MIN} characters. A few words in a row is fine.</p>`,
    '<label for="again">The same password again</label>',
    `<input id="again" name="again" type="password" autocomplete="new-password" required>`,
    ...errorLine(error),
    `<button type="submit">${escapeHtml(submit)}</button>`,
    "</form>",
  ]);
}
