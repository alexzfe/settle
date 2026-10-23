// The login, written against the rules it keeps: every route needs a Login except /health, the
// login-type pages, and each Quick Guide by its token; a Home's MCP endpoint and Home Folder
// script take that Home's bearer key instead, and the key opens nothing else; one Account never
// reaches another's Homes by any route, and is told they don't exist; guessing is limited.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addAccount,
  type CallContext,
  createFixtureHome,
  type FixtureHome,
  TEST_PASSWORD,
} from "@settle/core";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { safeNext } from "./auth.js";
import { FAILURE_LIMITS, FailureLimiter, UploadLimiter } from "./limits.js";
import { loginCookie } from "./testing.js";

const PORT = 4380;
const ORIGIN = "https://settle.example.com";
const EMAIL = "fixture@example.com";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, ...new Array(56)]);

let fixture: FixtureHome;
/** A second Account, Kim's, with a Home of its own. */
let kim: CallContext;
let cottage: string;
let app: Hono;
let guideToken: string;
let homeToken: string;
let cottageToken: string;
let photo: number;
beforeAll(async () => {
  fixture = await createFixtureHome({ publicOrigin: ORIGIN });
  kim = await addAccount(fixture.core, "kim@example.com");
  cottage = (
    await fixture.core.run("create_home", kim, { name: "Cottage", country: "GB", city: "York" })
  ).home.slug;
  app = authed();
  const { decision } = await fixture.core.run("get_decision", fixture.web, {
    home: fixture.home,
    decision: "wool-rug",
  });
  guideToken = (decision.guides?.phoneUrl ?? "").slice(`${ORIGIN}/guide/`.length);
  homeToken = fixture.core.homeToken(fixture.home) as string;
  cottageToken = fixture.core.homeToken(cottage) as string;
  photo =
    (
      await fixture.core.run("add_photo", fixture.web, {
        home: fixture.home,
        item: "sofa",
        file: JPEG,
        thumb: JPEG,
      })
    ).photos[0]?.id ?? 0;
});
afterAll(() => fixture.core.close());
afterEach(() => vi.useRealTimers());

function authed(
  options: { webDist?: string; failures?: FailureLimiter; uploads?: UploadLimiter } = {},
): Hono {
  return createApp({
    core: fixture.core,
    port: PORT,
    publicOrigin: ORIGIN,
    auth: { failures: options.failures ?? new FailureLimiter() },
    ...(options.uploads ? { uploads: options.uploads } : {}),
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

function api(
  operation: string,
  headers: Record<string, string> = {},
  body: unknown = {},
  to: Hono = app,
) {
  return request(
    `/api/${operation}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
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

/** A form posted from this site, as the login-type pages post theirs. */
function post(path: string, fields: Record<string, string>, to: Hono = app, ip?: string) {
  return request(
    path,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: ORIGIN,
        ...(ip ? { "cf-connecting-ip": ip } : {}),
      },
      body: new URLSearchParams(fields).toString(),
    },
    to,
  );
}

function logIn(email: string, password: string, next?: string, to: Hono = app) {
  return post("/login", { email, password, ...(next === undefined ? {} : { next }) }, to);
}

/** A Login of the fixture's Account, as the Cookie header. */
const fixtureLogin = () => ({ cookie: loginCookie(fixture.core, fixture.web) });
/** A Login of Kim's Account. */
const kimLogin = () => ({ cookie: loginCookie(fixture.core, kim) });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("without a Login", () => {
  it("answers /health, for the container's healthcheck", async () => {
    expect((await request("/health")).status).toBe(200);
  });

  it("sends a page to the login, keeping where it was headed", async () => {
    for (const [path, next] of [
      ["/", "/"],
      ["/homes/my-flat/decisions?state=leaning", "/homes/my-flat/decisions?state=leaning"],
      ["/account", "/account"],
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
      const asset = await request("/assets/app.js", { headers: fixtureLogin() }, withUi);
      expect(await asset.text()).toBe("console.log('ui')");
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it("answers the API, the events, and the export 401, saying what to do", async () => {
    for (const response of [
      await api("list_homes"),
      await request(`/events?home=${fixture.home}`),
      await request(`/api/get_listing_photo?home=${fixture.home}&listing=x`),
      await request("/api/export_account"),
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
    expect(page).toContain('type="email"');
    expect(page).toContain('type="password"');
    expect(page).toContain('name="next" value="/homes/x?a=1&amp;b=2"');
    expect(page).not.toContain("<script");
    expect(page).not.toContain('class="error"');
  });

  it("refuses a wrong password or email alike, logging the email and IP, never the password", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fresh = authed();
      const wrong = await logIn(EMAIL, "not the password at all", "/homes", fresh);
      const nobody = await logIn("nobody@example.com", TEST_PASSWORD, "/homes", fresh);
      for (const response of [wrong, nobody]) {
        expect(response.status).toBe(401);
        expect(response.headers.get("set-cookie")).toBeNull();
        const page = await response.text();
        expect(page).toContain("That email and password don't match an account.");
        expect(page).toContain('name="next" value="/homes"');
      }
      const logged = warn.mock.calls.map((call) => String(call[0]));
      expect(logged).toEqual([
        `Failed login for "${EMAIL}" from unknown`,
        'Failed login for "nobody@example.com" from unknown',
      ]);
      expect(logged.join("\n")).not.toContain("not the password");
    } finally {
      warn.mockRestore();
    }
  });

  it("sets a Login cookie for the right one and goes where it was headed", async () => {
    const response = await logIn(EMAIL.toUpperCase(), TEST_PASSWORD, "/homes/my-flat");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/homes/my-flat");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^settle_login=[\w-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);

    const listed = await api("list_homes", { cookie: cookie.split(";")[0] as string });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      homes: [expect.objectContaining({ slug: "fixture-home" })],
    });
  });

  it("leaves Secure off on a plain-http origin, where the browser would drop it", async () => {
    const plain = createApp({ core: fixture.core, port: PORT });
    const response = await plain.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: EMAIL, password: TEST_PASSWORD }).toString(),
    });
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("goes only to a path on this site afterwards, never off it", async () => {
    for (const next of ["//evil.example", "/\\evil.example", "https://evil.example", "evil", ""]) {
      expect(safeNext(next), next).toBe("/");
      expect((await logIn(EMAIL, TEST_PASSWORD, next)).headers.get("location"), next).toBe("/");
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
      body: new URLSearchParams({ email: EMAIL, password: TEST_PASSWORD }).toString(),
    });
    expect(response.status).toBe(403);
  });

  it("refuses a form far larger than its few fields, before reading it", async () => {
    const response = await post("/login", { email: EMAIL, password: "x".repeat(17 * 1024) });
    expect(response.status).toBe(413);
  });
});

describe("failed logins", () => {
  it("lock an account and IP pair after 5, the sixth refused even when right", async () => {
    const limited = authed();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let i = 0; i < 5; i++) {
        expect((await logIn(EMAIL, `wrong ${i} password`, undefined, limited)).status).toBe(401);
      }
      const sixth = await logIn(EMAIL, TEST_PASSWORD, undefined, limited);
      expect(sixth.status).toBe(429);
      expect(sixth.headers.get("retry-after")).toBe(String(15 * 60));
      expect(await sixth.text()).toContain("Try again in 15 minutes");
      // Another account from the same IP is not locked by these.
      const other = await logIn("kim@example.com", TEST_PASSWORD, undefined, limited);
      expect(other.status).toBe(303);
    } finally {
      warn.mockRestore();
    }
  });

  it("lock an IP after 20 across every account, and unlock after 15 minutes", async () => {
    let now = Date.parse("2026-10-22T10:00:00Z");
    const limiter = new FailureLimiter(FAILURE_LIMITS, () => now);
    const ip = "203.0.113.9";
    for (let i = 0; i < 19; i++) limiter.fail(ip, `person${i}@example.com`);
    expect(limiter.lockedUntil(ip, "someone@example.com")).toBeUndefined();
    limiter.fail(ip, "person19@example.com");
    expect(limiter.lockedUntil(ip, "someone@example.com")).toBe(now + 15 * 60_000);
    expect(limiter.lockedUntil("203.0.113.10", "someone@example.com")).toBeUndefined();
    now += 15 * 60_000;
    expect(limiter.lockedUntil(ip, "someone@example.com")).toBeUndefined();
  });

  it("forget failures older than 15 minutes, and a success clears the pair", () => {
    let now = 0;
    const limiter = new FailureLimiter(FAILURE_LIMITS, () => now);
    for (let i = 0; i < 4; i++) limiter.fail("ip", EMAIL);
    now += 15 * 60_000 + 1;
    limiter.fail("ip", EMAIL);
    expect(limiter.lockedUntil("ip", EMAIL)).toBeUndefined();
    for (let i = 0; i < 3; i++) limiter.fail("ip", EMAIL);
    limiter.succeed("ip", EMAIL);
    limiter.fail("ip", EMAIL);
    expect(limiter.lockedUntil("ip", EMAIL)).toBeUndefined();
  });

  it("are counted by Cloudflare's visitor IP only with SETTLE_TRUSTED_PROXY=cloudflare", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failures = new FailureLimiter();
      const proxied = createApp({
        core: fixture.core,
        port: PORT,
        publicOrigin: ORIGIN,
        auth: { trustedProxy: "cloudflare", failures },
      });
      for (let i = 0; i < 5; i++) {
        await post("/login", { email: EMAIL, password: "wrong" }, proxied, "198.51.100.1");
      }
      expect(failures.lockedUntil("198.51.100.1", EMAIL)).toBeDefined();
      // Another visitor behind the same proxy is not.
      const next = await post(
        "/login",
        { email: EMAIL, password: TEST_PASSWORD },
        proxied,
        "198.51.100.2",
      );
      expect(next.status).toBe(303);

      // Without the setting, the header is anyone's to send, so it is ignored.
      const direct = new FailureLimiter();
      const plain = authed({ failures: direct });
      await post("/login", { email: EMAIL, password: "wrong" }, plain, "198.51.100.3");
      expect(warn.mock.calls.at(-1)?.[0]).toBe(`Failed login for "${EMAIL}" from unknown`);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the Login cookie", () => {
  it("is refused when made up, expired, or of a disabled Account", async () => {
    for (const value of ["", "made-up", `${loginCookie(fixture.core, kim).slice(13)}x`]) {
      expect((await api("list_homes", { cookie: `settle_login=${value}` })).status).toBe(401);
    }
    const cookie = kimLogin();
    expect((await api("list_homes", cookie)).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000 + 1);
    expect((await api("list_homes", cookie)).status).toBe(401);
    vi.useRealTimers();

    const before = kimLogin();
    const account = (kim.caller as { account: number }).account;
    await fixture.core.run("disable_account", fixture.web, { account });
    try {
      expect((await api("list_homes", before)).status).toBe(401);
      const page = await logIn("kim@example.com", TEST_PASSWORD);
      expect(page.status).toBe(403);
      expect(await page.text()).toContain("This account is disabled.");
    } finally {
      await fixture.core.run("enable_account", fixture.web, { account });
    }
  });

  it("is ended by logging out, so the same cookie never works again", async () => {
    const cookie = kimLogin();
    const response = await request("/logout", {
      method: "POST",
      headers: { origin: ORIGIN, ...cookie },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("set-cookie")).toMatch(/^settle_login=;.*Max-Age=0/);
    expect((await api("list_homes", cookie)).status).toBe(401);
  });

  it("is the old shared-password cookie no longer", async () => {
    expect((await api("list_homes", { cookie: "settle_session=1.abc" })).status).toBe(401);
  });
});

describe("the one-time links' pages", () => {
  it("show their form for a good link, and one plain message for every miss", async () => {
    const { invite } = await fixture.core.run("create_invite", fixture.web, {});
    const path = new URL(invite.url).pathname;
    const page = await request(path);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("You've been invited.");
    expect(html).toContain('<form method="post">');
    expect(html).not.toContain("<script");

    const token = path.slice("/invite/".length);
    // Word for word the same for each: a wrong token, another kind's, a used one, none at all.
    const misses = [`/invite/${token}x`, `/reset/${token}`, `/setup/${token}`, "/invite/x"];
    const texts: string[] = [];
    for (const miss of misses) {
      const response = await request(miss);
      expect(response.status, miss).toBe(404);
      texts.push(await response.text());
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toContain("This link doesn");
  });

  it("make an Account from an invite and log it in, once", async () => {
    const { invite } = await fixture.core.run("create_invite", fixture.web, {});
    const path = new URL(invite.url).pathname;
    const different = await post(path, {
      email: "lee@example.com",
      password: "a long password here",
      again: "a long password there",
    });
    expect(different.status).toBe(400);
    expect(await different.text()).toContain("The two passwords are different.");
    const short = await post(path, { email: "lee@example.com", password: "short", again: "short" });
    expect(short.status).toBe(400);
    expect(await short.text()).toContain("at least 12 characters");

    const made = await post(path, {
      email: "lee@example.com",
      password: "a long password here",
      again: "a long password here",
    });
    expect(made.status).toBe(303);
    expect(made.headers.get("location")).toBe("/");
    const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0] as string;
    const account = await api("get_account", { cookie });
    expect(await account.json()).toEqual({
      account: { email: "lee@example.com", admin: false, createdAt: expect.any(String) },
    });
    const again = await post(path, {
      email: "max@example.com",
      password: "a long password here",
      again: "a long password here",
    });
    expect(again.status).toBe(404);
  });

  it("set a password from a reset link, ending every other Login", async () => {
    const account = (kim.caller as { account: number }).account;
    const before = kimLogin();
    const { reset } = await fixture.core.run("create_reset_link", fixture.web, { account });
    const path = new URL(reset.url).pathname;
    expect(await (await request(path)).text()).not.toContain('name="email"');
    const done = await post(path, { password: "kim's new password", again: "kim's new password" });
    expect(done.status).toBe(303);
    expect((await api("list_homes", before)).status).toBe(401);
    expect((await logIn("kim@example.com", "kim's new password")).status).toBe(303);
    // Back as it was, for the other tests.
    const { reset: back } = await fixture.core.run("create_reset_link", fixture.web, { account });
    await post(new URL(back.url).pathname, { password: TEST_PASSWORD, again: TEST_PASSWORD });
  });

  it("limit how often one IP may miss", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const limited = authed();
      for (let i = 0; i < 5; i++) {
        const miss = await post(
          `/invite/made-up-${i}`,
          {
            email: "x@example.com",
            password: TEST_PASSWORD,
            again: TEST_PASSWORD,
          },
          limited,
        );
        expect(miss.status).toBe(404);
      }
      const { invite } = await fixture.core.run("create_invite", fixture.web, {});
      const locked = await post(
        new URL(invite.url).pathname,
        {
          email: "x@example.com",
          password: TEST_PASSWORD,
          again: TEST_PASSWORD,
        },
        limited,
      );
      expect(locked.status).toBe(429);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("one Account's Homes, to another", () => {
  it("are not found by any route, with the message a Home that doesn't exist gets", async () => {
    const as = kimLogin();
    const home = fixture.home;
    const responses = {
      get_home: await api("get_home", as, { home }),
      get_photo: await request(`/api/get_photo?home=${home}&item=sofa&photo=${photo}&size=thumb`, {
        headers: as,
      }),
      export: await request(`/api/export_shopping_list?home=${home}&format=csv`, { headers: as }),
      events: await request(`/events?home=${home}`, { headers: as }),
      script: await request(`/api/home_folder_script?home=${home}`, { headers: as }),
      mcp: await mcp(home, as),
      guide: await request(`/guide/wool-rug?home=${home}`, { headers: as }),
    };
    const missing = (await (await api("get_home", as, { home: "nowhere" })).json()) as {
      error: { message: string };
    };
    const message = missing.error.message.replace('"nowhere"', `"${home}"`);
    for (const [route, response] of Object.entries(responses)) {
      expect([route, response.status]).toEqual([route, 404]);
      const text = await response.text();
      const said =
        route === "script"
          ? text.trim()
          : route === "guide"
            ? text.replaceAll("&quot;", '"')
            : (JSON.parse(text) as { error: { message: string } }).error.message;
      expect(said, route).toContain(message);
    }
    // The Home's own Account reaches each.
    const own = fixtureLogin();
    expect((await api("get_home", own, { home })).status).toBe(200);
    expect((await mcp(home, own)).status).toBe(200);
    expect(
      (
        await request(`/api/get_photo?home=${home}&item=sofa&photo=${photo}&size=thumb`, {
          headers: own,
        })
      ).status,
    ).toBe(200);
  });

  it("list only the Account's own", async () => {
    const listed = (await (await api("list_homes", kimLogin())).json()) as {
      homes: { slug: string }[];
    };
    expect(listed.homes.map((each) => each.slug)).toEqual([cottage]);
  });
});

describe("a Home's bearer key", () => {
  it("opens that Home's MCP endpoint, and nothing opens it without the key or a Login", async () => {
    const response = await mcp(fixture.home, bearer(homeToken));
    expect(response.status).toBe(200);
    const listed = await response.text();
    expect(listed).toContain("open_session");
    expect(listed).not.toContain(homeToken);

    for (const headers of [
      {},
      bearer(cottageToken),
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

    const otherHome = await request(`/api/home_folder_script?home=${cottage}`, {
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

  it("stops working while its Account is disabled, and when the key is rotated", async () => {
    const account = (kim.caller as { account: number }).account;
    expect((await mcp(cottage, bearer(cottageToken))).status).toBe(200);
    await fixture.core.run("disable_account", fixture.web, { account });
    expect((await mcp(cottage, bearer(cottageToken))).status).toBe(401);
    await fixture.core.run("enable_account", fixture.web, { account });
    expect((await mcp(cottage, bearer(cottageToken))).status).toBe(200);

    await api("rotate_home_key", kimLogin(), { home: cottage });
    expect((await mcp(cottage, bearer(cottageToken))).status).toBe(401);
    cottageToken = fixture.core.homeToken(cottage) as string;
    expect((await mcp(cottage, bearer(cottageToken))).status).toBe(200);
  });

  it("is not needed alongside a Login, for the Account's own Homes", async () => {
    const cookie = fixtureLogin();
    expect((await mcp(fixture.home, cookie)).status).toBe(200);
    const script = await request(`/api/home_folder_script?home=${fixture.home}`, {
      headers: cookie,
    });
    expect(script.status).toBe(200);
  });
});

describe("uploads", () => {
  function upload(path: string, length: number, to: Hono = app) {
    return request(
      path,
      {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(length),
          ...fixtureLogin(),
        },
        body: "--x--",
      },
      to,
    );
  }

  it("refuse a body over each route's cap by its length, before reading it", async () => {
    const MB = 1024 * 1024;
    for (const [path, cap] of [
      ["/api/upload_blueprint", 51 * MB],
      ["/api/set_listing_photo", 3 * MB],
      ["/api/add_photo", 5 * MB],
      ["/api/add_document", 51 * MB],
    ] as const) {
      const response = await upload(path, cap + 1);
      expect([path, response.status]).toEqual([path, 413]);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toMatch(/over|too big|larger/i);
    }
  });

  it("refuse a body with no length once it passes the cap", async () => {
    const big = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    const response = await request("/api/add_photo", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", ...fixtureLogin() },
      body: big,
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(413);
  });

  it("are limited per Account, saying when to try again", async () => {
    let now = Date.parse("2026-10-22T10:00:00Z");
    const limited = authed({
      uploads: new UploadLimiter({ perHour: 2, bytesPerDay: 1000 }, () => now),
    });
    expect((await upload("/api/add_photo", 10, limited)).status).not.toBe(429);
    expect((await upload("/api/add_document", 10, limited)).status).not.toBe(429);
    const third = await upload("/api/upload_blueprint", 10, limited);
    expect(third.status).toBe(429);
    const body = (await third.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toContain("Try again in");
    expect(third.headers.get("retry-after")).toBeDefined();
    now += 60 * 60 * 1000 + 1;
    expect((await upload("/api/add_photo", 10, limited)).status).not.toBe(429);
    // And by the bytes of the day.
    expect((await upload("/api/add_photo", 990, limited)).status).toBe(429);
  });
});

describe("the account export", () => {
  it("downloads one zip of the Account's Homes", async () => {
    const response = await request("/api/export_account", { headers: fixtureLogin() });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="settle-export-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A zip's local file header.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
