// The login, written against the rules it keeps: with SETTLE_PASSWORD every route needs a session
// except /health, the login, and each Quick Guide by its token; a Home's MCP endpoint and Home
// Folder script take that Home's bearer key instead, and the key opens nothing else.
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixtureHome, type FixtureHome } from "@settle/core";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { safeNext, sessionSecret } from "./auth.js";

const PORT = 4380;
const ORIGIN = "https://settle.example.com";
const PASSWORD = "open sesame";
const SECRET = Buffer.alloc(32, 7);

let fixture: FixtureHome;
let other: string;
let app: Hono;
let guideToken: string;
let homeToken: string;
let otherToken: string;
beforeAll(async () => {
  fixture = await createFixtureHome({ publicOrigin: ORIGIN });
  other = (
    await fixture.core.run(
      "create_home",
      { caller: { kind: "web" } },
      { name: "Cottage", country: "GB", city: "York" },
    )
  ).home.slug;
  app = authed();
  const { decision } = await fixture.core.run(
    "get_decision",
    { caller: { kind: "web" } },
    { home: fixture.home, decision: "wool-rug" },
  );
  guideToken = (decision.guides?.phoneUrl ?? "").slice(`${ORIGIN}/guide/`.length);
  homeToken = fixture.core.homeToken(fixture.home) as string;
  otherToken = fixture.core.homeToken(other) as string;
});
afterAll(() => fixture.core.close());
afterEach(() => vi.useRealTimers());

function authed(options: { password?: string; webDist?: string } = {}): Hono {
  return createApp({
    core: fixture.core,
    port: PORT,
    publicOrigin: ORIGIN,
    auth: { password: options.password ?? PASSWORD, secret: SECRET, failureDelayMs: 0 },
    ...(options.webDist ? { webDist: options.webDist } : {}),
  });
}

/** A request as a browser at the public origin sends it. */
function request(path: string, init: RequestInit = {}, to: Hono = app) {
  return to.request(path, {
    ...init,
    headers: { host: "settle.example.com", ...(init.headers as Record<string, string>) },
  });
}

function api(operation: string, headers: Record<string, string> = {}, to: Hono = app) {
  return request(
    `/api/${operation}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({}),
    },
    to,
  );
}

function mcp(home: string, headers: Record<string, string> = {}) {
  return request(`/mcp/homes/${home}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

function logIn(password: string, next?: string, to: Hono = app) {
  const form = new URLSearchParams({ password, ...(next === undefined ? {} : { next }) });
  return request(
    "/login",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: form.toString(),
    },
    to,
  );
}

/** The session cookie a successful login sets, as a Cookie header. */
async function session(to: Hono = app): Promise<string> {
  const response = await logIn(PASSWORD, undefined, to);
  expect(response.status).toBe(303);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] as string;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("without a session", () => {
  it("answers /health, for the container's healthcheck", async () => {
    expect((await request("/health")).status).toBe(200);
  });

  it("sends a page to the login, keeping where it was headed", async () => {
    for (const [path, next] of [
      ["/", "/"],
      ["/homes/my-flat/decisions?state=leaning", "/homes/my-flat/decisions?state=leaning"],
    ] as const) {
      const response = await request(path, { headers: { accept: "text/html" } });
      expect(response.status, path).toBe(302);
      expect(response.headers.get("location"), path).toBe(
        `/login?next=${encodeURIComponent(next)}`,
      );
    }
  });

  it("keeps the built UI's files behind the login too", async () => {
    const dist = mkdtempSync(join(tmpdir(), "settle-auth-"));
    try {
      writeFileSync(join(dist, "index.html"), "<!doctype html><title>The UI</title>");
      mkdirSync(join(dist, "assets"));
      writeFileSync(join(dist, "assets", "app.js"), "console.log('ui')");
      const withUi = authed({ webDist: dist });
      expect((await request("/assets/app.js", {}, withUi)).status).toBe(302);
      const cookie = await session(withUi);
      const asset = await request("/assets/app.js", { headers: { cookie } }, withUi);
      expect(await asset.text()).toBe("console.log('ui')");
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it("answers the API and the events 401, saying what to do", async () => {
    for (const response of [
      await api("list_homes"),
      await request(`/events?home=${fixture.home}`),
      await request(`/api/get_listing_photo?home=${fixture.home}&listing=x`),
    ]) {
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("unauthorized");
      expect(body.error.message).toMatch(/Log in/);
    }
  });

  it("serves a Quick Guide by its token, but not by its slug, and every wrong token the one 404", async () => {
    const byToken = await request(`/guide/${guideToken}`);
    expect(byToken.status).toBe(200);
    expect(await byToken.text()).toContain("<h1>Wool rug</h1>");

    const bySlug = await request(`/guide/wool-rug?home=${fixture.home}`);
    expect(bySlug.status).toBe(302);
    expect(bySlug.headers.get("location")).toBe(
      `/login?next=${encodeURIComponent(`/guide/wool-rug?home=${fixture.home}`)}`,
    );

    for (const path of ["/guide/wool-rug", `/guide/${guideToken.toLowerCase()}`]) {
      const miss = await request(path);
      expect(miss.status, path).toBe(404);
      expect(await miss.text(), path).toContain("There is nothing here.");
    }
  });
});

describe("the login page", () => {
  it("is a form with no JavaScript, posting back to itself, carrying where to go next", async () => {
    const response = await request(`/login?next=${encodeURIComponent("/homes/x?a=1&b=2")}`);
    expect(response.status).toBe(200);
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("script-src 'none'");
    expect(policy).toContain("form-action 'self'");
    // A browser posting the form must send its Origin, which the front door checks.
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    const page = await response.text();
    expect(page).toContain('<form method="post" action="/login">');
    expect(page).toContain('type="password"');
    expect(page).toContain('name="next" value="/homes/x?a=1&amp;b=2"');
    expect(page).not.toContain("<script");
    expect(page).not.toContain("not the password");
  });

  it("refuses a wrong password with the page and its error line, after a pause", async () => {
    const slow = createApp({
      core: fixture.core,
      port: PORT,
      publicOrigin: ORIGIN,
      auth: { password: PASSWORD, secret: SECRET, failureDelayMs: 50 },
    });
    const started = performance.now();
    const response = await logIn("open says me", "/homes", slow);
    expect(performance.now() - started).toBeGreaterThanOrEqual(45);
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    const page = await response.text();
    expect(page).toContain("That is not the password.");
    expect(page).toContain('name="next" value="/homes"');
    expect((await logIn("", "/homes")).status).toBe(401);
  });

  it("sets a session cookie for the right one and goes where it was headed", async () => {
    const response = await logIn(PASSWORD, "/homes/my-flat");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/homes/my-flat");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^settle_session=\d+\.[\w-]+;/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);

    const listed = await api("list_homes", { cookie: cookie.split(";")[0] as string });
    expect(listed.status).toBe(200);
  });

  it("leaves Secure off on a plain-http origin, where the browser would drop it", async () => {
    const plain = createApp({
      core: fixture.core,
      port: PORT,
      auth: { password: PASSWORD, secret: SECRET, failureDelayMs: 0 },
    });
    const response = await plain.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: PASSWORD }).toString(),
    });
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("goes only to a path on this site afterwards, never off it", async () => {
    for (const next of ["//evil.example", "/\\evil.example", "https://evil.example", "evil", ""]) {
      expect(safeNext(next), next).toBe("/");
      expect((await logIn(PASSWORD, next)).headers.get("location"), next).toBe("/");
    }
    expect(safeNext("/homes/my-flat?x=1#y")).toBe("/homes/my-flat?x=1#y");
  });

  it("is refused to a form posted from another site, by the front door", async () => {
    const response = await request("/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.example",
      },
      body: new URLSearchParams({ password: PASSWORD }).toString(),
    });
    expect(response.status).toBe(403);
  });
});

describe("the session cookie", () => {
  it("is refused when tampered with, malformed, or expired", async () => {
    const cookie = await session();
    const [expires, signature] = cookie.slice("settle_session=".length).split(".") as [
      string,
      string,
    ];
    for (const value of [
      `${Number(expires) + 1}.${signature}`,
      `${expires}.${signature.slice(1)}`,
      `${expires}`,
      `${expires}.${signature}.x`,
      "",
    ]) {
      expect((await api("list_homes", { cookie: `settle_session=${value}` })).status).toBe(401);
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Number(expires) + 1);
    expect((await api("list_homes", { cookie })).status).toBe(401);
  });

  it("survives a restart, and changing the password logs everyone out", async () => {
    const cookie = await session();
    expect((await api("list_homes", { cookie }, authed())).status).toBe(200);
    expect((await api("list_homes", { cookie }, authed({ password: "new one" }))).status).toBe(401);
  });

  it("is cleared by logging out, which goes to the login", async () => {
    const response = await request("/logout", { method: "POST", headers: { origin: ORIGIN } });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("set-cookie")).toMatch(/^settle_session=;.*Max-Age=0/);
  });
});

describe("a Home's bearer key", () => {
  it("opens that Home's MCP endpoint, and nothing opens it without the key or a session", async () => {
    const response = await mcp(fixture.home, bearer(homeToken));
    expect(response.status).toBe(200);
    const listed = await response.text();
    expect(listed).toContain("open_session");
    expect(listed).not.toContain(homeToken);

    for (const headers of [
      {},
      bearer(otherToken),
      bearer(`${homeToken}x`),
      { authorization: homeToken },
    ]) {
      const refused = await mcp(fixture.home, headers);
      expect(refused.status).toBe(401);
      expect(refused.headers.get("www-authenticate")).toBe("Bearer");
      const body = (await refused.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("unauthorized");
      expect(body.error.message).toMatch(/Authorization: Bearer/);
    }
    expect((await mcp("nowhere", bearer(homeToken))).status).toBe(401);
  });

  it("opens that Home's Home Folder script, which writes the key into .mcp.json", async () => {
    const script = await request(`/api/home_folder_script?home=${fixture.home}`, {
      headers: bearer(homeToken),
    });
    expect(script.status).toBe(200);
    expect(await script.text()).toContain(`"Authorization": "Bearer ${homeToken}"`);

    const otherHome = await request(`/api/home_folder_script?home=${other}`, {
      headers: bearer(homeToken),
    });
    expect(otherHome.status).toBe(401);
  });

  it("opens nothing else: not the web API, not the events, not the pages", async () => {
    const headers = bearer(homeToken);
    expect((await api("list_homes", headers)).status).toBe(401);
    expect((await api("home_folder_setup", headers)).status).toBe(401);
    expect((await request(`/events?home=${fixture.home}`, { headers })).status).toBe(401);
    expect((await request(`/guide/wool-rug?home=${fixture.home}`, { headers })).status).toBe(302);
    expect((await request("/", { headers })).status).toBe(302);
  });

  it("is not needed alongside a session, so the web and a browser reach both routes", async () => {
    const cookie = await session();
    expect((await mcp(fixture.home, { cookie })).status).toBe(200);
    const script = await request(`/api/home_folder_script?home=${other}`, { headers: { cookie } });
    expect(script.status).toBe(200);
  });
});

describe("auth_status", () => {
  it("tells the web whether there is a login to log out of", async () => {
    const cookie = await session();
    const on = await request("/api/auth_status", { headers: { cookie } });
    expect(await on.json()).toEqual({ auth: true });

    const open = createApp({ core: fixture.core, port: PORT });
    expect(await (await open.request("/api/auth_status")).json()).toEqual({ auth: false });
  });
});

describe("without a password", () => {
  it("asks for nothing, and /login goes where it was headed", async () => {
    const open = createApp({ core: fixture.core, port: PORT });
    expect(
      (
        await open.request("/api/list_homes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const login = await open.request(`/login?next=${encodeURIComponent("/homes")}`);
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe("/homes");
  });
});

describe("the session secret", () => {
  it("is made once in the data dir, readable only by its owner, and read back after", () => {
    const dir = mkdtempSync(join(tmpdir(), "settle-auth-"));
    try {
      const first = sessionSecret(dir);
      expect(first).toHaveLength(32);
      expect(statSync(join(dir, "session-secret")).mode & 0o777).toBe(0o600);
      expect(sessionSecret(dir).equals(first)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
