// The OAuth sign-in server, written against what Claude's connector expects of it: the 401 that
// points at discovery, both discovery documents, CIMD and DCR clients, PKCE, single-use codes,
// rotating refresh tokens, Connections that lapse or end with their Account, and /mcp reaching the
// Account's MCP handler as the Connection's Account.
import { createHash, randomBytes } from "node:crypto";
import {
  addAccount,
  type CallContext,
  createFixtureHome,
  type FixtureHome,
  TEST_PASSWORD,
} from "@settle/core";
import type { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { FailureLimiter } from "./limits.js";
import { addressBlocked, CLAUDE_CALLBACK, fetchClientMetadata } from "./oauth.js";
import { loginCookie } from "./testing.js";

const { accountMcp } = vi.hoisted(() => ({
  accountMcp: vi.fn(async (_request: Request, _options: { account: number }) =>
    Response.json({ jsonrpc: "2.0", id: 1, result: {} }),
  ),
}));
// Track B's handler is stubbed: this file checks only that /mcp reaches it as the right Account.
vi.mock("./mcp.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mcp.js")>()),
  handleAccountMcpRequest: accountMcp,
}));

const ORIGIN = "https://settle.example.com";
const MCP_URL = `${ORIGIN}/mcp`;
const CLIENT = "https://claude.ai/oauth/claude-client-metadata";
const CODE_CLIENT = "https://claude.ai/oauth/claude-code-client-metadata";
const DAY = 24 * 60 * 60 * 1000;

const documents: Record<string, unknown> = {
  [CLIENT]: { client_id: CLIENT, client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK] },
  [CODE_CLIENT]: {
    client_id: CODE_CLIENT,
    client_name: "Claude Code",
    redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  },
  // Calls itself Claude, from somewhere else.
  "https://evil.example/client": {
    client_id: "https://evil.example/client",
    client_name: "Claude",
    redirect_uris: [CLAUDE_CALLBACK],
  },
  "https://liar.example/client": { client_id: CLIENT, redirect_uris: [CLAUDE_CALLBACK] },
};
const fetchMetadata = vi.fn(async (url: string) => {
  if (!(url in documents)) throw new Error("it answered 404");
  return documents[url];
});

let now = Date.parse("2026-10-24T10:00:00Z");
let fixture: FixtureHome;
let kim: CallContext;
let app: Hono;

beforeAll(async () => {
  fixture = await createFixtureHome({ publicOrigin: ORIGIN, clock: () => new Date(now) });
  kim = await addAccount(fixture.core, "kim@example.com");
  app = createApp({
    core: fixture.core,
    port: 4391,
    publicOrigin: ORIGIN,
    auth: { failures: new FailureLimiter(), oauth: { fetchClientMetadata: fetchMetadata } },
  });
});
afterAll(() => fixture.core.close());
beforeEach(() => accountMcp.mockClear());

function request(path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { host: "settle.example.com", ...(init.headers as Record<string, string>) },
  });
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeQuery(overrides: Record<string, string | undefined> = {}, challenge = "x") {
  const params: Record<string, string | undefined> = {
    response_type: "code",
    client_id: CLIENT,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-1",
    resource: MCP_URL,
    scope: "offline_access",
    ...overrides,
  };
  const defined = Object.entries(params).filter((entry): entry is [string, string] => !!entry[1]);
  return new URLSearchParams(defined);
}

/** Clicks Allow (or Cancel) as a browser logged in with `cookie` does. */
function allow(params: URLSearchParams, cookie?: string, decision = "allow") {
  const form = new URLSearchParams(params);
  form.set("decision", decision);
  return request("/authorize", {
    method: "POST",
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: form,
  });
}

function token(form: Record<string, string>) {
  return request("/token", { method: "POST", body: new URLSearchParams(form) });
}

/** The whole flow for `who`: Allow, then the code for tokens. */
async function connect(
  who: CallContext = fixture.web,
  client = CLIENT,
  redirect = CLAUDE_CALLBACK,
) {
  const { verifier, challenge } = pkce();
  const query = authorizeQuery({ client_id: client, redirect_uri: redirect }, challenge);
  const allowed = await allow(query, loginCookie(fixture.core, who));
  expect(allowed.status).toBe(303);
  const back = new URL(allowed.headers.get("location") ?? "");
  const code = back.searchParams.get("code") ?? "";
  const answer = await token({
    grant_type: "authorization_code",
    code,
    client_id: client,
    redirect_uri: redirect,
    code_verifier: verifier,
    resource: MCP_URL,
  });
  expect(answer.status).toBe(200);
  const tokens = (await answer.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };
  return { ...tokens, code, verifier, back };
}

function mcp(accessToken?: string) {
  return request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

describe("the 401 at /mcp", () => {
  const header = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`;

  it("answers a request with no token 401, pointing at the resource metadata", async () => {
    const response = await mcp();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(header);
    expect(accountMcp).not.toHaveBeenCalled();
  });

  it("answers a token that isn't a Connection's the same, marked invalid_token", async () => {
    const response = await mcp("not-a-token");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`${header}, error="invalid_token"`);
  });

  it("opens to neither a Home's key nor a Login", async () => {
    const homeKey = fixture.core.homeToken(fixture.home) as string;
    expect((await mcp(homeKey)).status).toBe(401);
    const cookie = loginCookie(fixture.core, fixture.web);
    const response = await request("/mcp", { method: "POST", headers: { cookie } });
    expect(response.status).toBe(401);
  });

  it("leaves a Home's own MCP endpoint taking its key, as before", async () => {
    const homeKey = fixture.core.homeToken(fixture.home) as string;
    const { access_token } = await connect();
    const byConnection = await request(`/mcp/homes/${fixture.home}`, {
      method: "POST",
      headers: { authorization: `Bearer ${access_token}` },
    });
    expect(byConnection.status).toBe(401);
    const byKey = await request(`/mcp/homes/${fixture.home}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${homeKey}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(byKey.status).toBe(200);
  });
});

describe("the discovery documents", () => {
  it("serves the protected resource metadata (RFC 9728) for /mcp, needing no Login", async () => {
    const response = await request("/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as Record<string, unknown>;
    expect(metadata.resource).toBe(MCP_URL);
    expect(metadata.authorization_servers).toEqual([ORIGIN]);
  });

  it("serves the authorization server metadata (RFC 8414) that keeps Claude on CIMD", async () => {
    const response = await request("/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: expect.arrayContaining(["none"]),
      client_id_metadata_document_supported: true,
      scopes_supported: expect.arrayContaining(["offline_access"]),
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe("/authorize and the Allow page", () => {
  it("names the client by its client id's host, never the name it gives itself", async () => {
    const response = await request(`/authorize?${authorizeQuery()}`);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain("<strong>claude.ai</strong> wants to use your Settle Account");
    expect(page).toContain("Allow");
    expect(page).toContain("Cancel");
    expect(page).not.toMatch(/<select|<input type="checkbox"/);
    // The form may lead on to Claude's callback, where the Allow sends the browser.
    expect(response.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://claude.ai",
    );

    const evil = await request(
      `/authorize?${authorizeQuery({ client_id: "https://evil.example/client" })}`,
    );
    expect(await evil.text()).toContain("<strong>evil.example</strong> wants");
  });

  it("says who is logged in when someone is", async () => {
    const response = await request(`/authorize?${authorizeQuery()}`, {
      headers: { cookie: loginCookie(fixture.core, kim) },
    });
    expect(await response.text()).toContain("logged in as kim@example.com");
  });

  it("refuses, as a page and never a redirect, a redirect_uri the CIMD document doesn't list", async () => {
    for (const redirect of ["https://claude.ai/api/mcp/other", "https://evil.example/callback"]) {
      const response = await request(`/authorize?${authorizeQuery({ redirect_uri: redirect })}`);
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("refuses a CIMD document whose client_id isn't its own URL", async () => {
    const response = await request(
      `/authorize?${authorizeQuery({ client_id: "https://liar.example/client" })}`,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("different client_id");
  });

  it("refuses a CIMD URL at a private address, with the real fetcher", async () => {
    const real = createApp({ core: fixture.core, port: 4391, publicOrigin: ORIGIN });
    const response = await real.request(
      `/authorize?${authorizeQuery({ client_id: "https://127.0.0.1/client" })}`,
      { headers: { host: "settle.example.com" } },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("private address");
  });

  it("sends a request with no PKCE, or another resource, back to the client with its error", async () => {
    const noPkce = await request(`/authorize?${authorizeQuery({ code_challenge: undefined })}`);
    expect(noPkce.status).toBe(302);
    const back = new URL(noPkce.headers.get("location") ?? "");
    expect(back.origin + back.pathname).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(back.searchParams.get("state")).toBe("state-1");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);

    const plain = await request(`/authorize?${authorizeQuery({ code_challenge_method: "plain" })}`);
    expect(new URL(plain.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "invalid_request",
    );

    const elsewhere = await request(
      `/authorize?${authorizeQuery({ resource: "https://other.example/mcp" })}`,
    );
    expect(new URL(elsewhere.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "invalid_target",
    );
  });

  it("returns the code with the state and iss (RFC 9207) on Allow", async () => {
    const { back } = await connect();
    expect(back.origin + back.pathname).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get("state")).toBe("state-1");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("returns access_denied on Cancel, and makes no Connection", async () => {
    const before = fixture.core.accounts.connections(
      kim.caller.kind === "web" ? kim.caller.account : 0,
    );
    const response = await allow(authorizeQuery(), loginCookie(fixture.core, kim), "cancel");
    expect(response.status).toBe(303);
    const back = new URL(response.headers.get("location") ?? "");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
    const after = fixture.core.accounts.connections(
      kim.caller.kind === "web" ? kim.caller.account : 0,
    );
    expect(after).toHaveLength(before.length);
  });

  it("asks for the login after the Allow, then sends the code from the same browser only", async () => {
    const { verifier, challenge } = pkce();
    const query = authorizeQuery({}, challenge);
    const allowed = await allow(query);
    expect(allowed.status).toBe(303);
    expect(allowed.headers.get("location")).toBe("/login?next=%2Fauthorize%2Fresume");
    const allowCookie = (allowed.headers.get("set-cookie") ?? "").split(";")[0] as string;
    expect(allowCookie).toMatch(/^settle_allow=/);

    const loggedIn = await request("/login", {
      method: "POST",
      headers: { origin: ORIGIN, cookie: allowCookie },
      body: new URLSearchParams({
        email: "kim@example.com",
        password: TEST_PASSWORD,
        next: "/authorize/resume",
      }),
    });
    expect(loggedIn.status).toBe(303);
    expect(loggedIn.headers.get("location")).toBe("/authorize/resume");
    const login = (loggedIn.headers.get("set-cookie") ?? "").split(";")[0] as string;

    // Another browser logged in, without the Allow's cookie, gets nothing.
    const other = await request("/authorize/resume", { headers: { cookie: login } });
    expect(other.status).toBe(400);

    // Allow again, this time carried through: the page leads back to Claude with the code.
    const again = await allow(query);
    const cookie = (again.headers.get("set-cookie") ?? "").split(";")[0] as string;
    const resumed = await request("/authorize/resume", {
      headers: { cookie: `${cookie}; ${login}` },
    });
    expect(resumed.status).toBe(200);
    const to = /url=([^"]+)"/.exec(await resumed.text())?.[1]?.replaceAll("&amp;", "&") ?? "";
    const code = new URL(to).searchParams.get("code") ?? "";
    const answer = await token({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT,
      redirect_uri: CLAUDE_CALLBACK,
      code_verifier: verifier,
    });
    expect(answer.status).toBe(200);
    const { access_token } = (await answer.json()) as { access_token: string };
    await mcp(access_token);
    expect(accountMcp.mock.calls[0]?.[1].account).toBe(
      kim.caller.kind === "web" ? kim.caller.account : -1,
    );

    // The Allow's cookie works once.
    const twice = await request("/authorize/resume", {
      headers: { cookie: `${cookie}; ${login}` },
    });
    expect(twice.status).toBe(400);
  });
});

describe("/token", () => {
  it("gives tokens for the code with the right PKCE verifier, and refuses a wrong one", async () => {
    const tokens = await connect();
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.refresh_token).toBeTruthy();

    const { challenge } = pkce();
    const allowed = await allow(
      authorizeQuery({}, challenge),
      loginCookie(fixture.core, fixture.web),
    );
    const code = new URL(allowed.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const wrong = await token({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT,
      redirect_uri: CLAUDE_CALLBACK,
      code_verifier: pkce().verifier,
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("takes only a form, and refuses another audience", async () => {
    const json = await request("/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token" }),
    });
    expect(json.status).toBe(400);
    const { refresh_token } = await connect();
    const elsewhere = await token({
      grant_type: "refresh_token",
      refresh_token,
      client_id: CLIENT,
      resource: "https://other.example/mcp",
    });
    expect(await elsewhere.json()).toMatchObject({ error: "invalid_target" });
  });

  it("refuses a code used twice, and ends the tokens its first use gave", async () => {
    const tokens = await connect();
    expect((await mcp(tokens.access_token)).status).toBe(200);
    const again = await token({
      grant_type: "authorization_code",
      code: tokens.code,
      client_id: CLIENT,
      redirect_uri: CLAUDE_CALLBACK,
      code_verifier: tokens.verifier,
    });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });
    expect((await mcp(tokens.access_token)).status).toBe(401);
  });

  it("rotates the refresh token on every refresh, and refuses the old one", async () => {
    const first = await connect();
    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: CLIENT,
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await mcp(second.access_token)).status).toBe(200);

    const reused = await token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: CLIENT,
    });
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ error: "invalid_grant" });
    const wrongClient = await token({
      grant_type: "refresh_token",
      refresh_token: second.refresh_token,
      client_id: CODE_CLIENT,
    });
    expect(await wrongClient.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("lets an access token go after an hour, and a Connection lapse after 90 days unused", async () => {
    const start = now;
    try {
      const tokens = await connect();
      now = start + 61 * 60 * 1000;
      expect((await mcp(tokens.access_token)).status).toBe(401);
      const refreshed = await token({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: CLIENT,
      });
      expect(refreshed.status).toBe(200);
      const { refresh_token } = (await refreshed.json()) as { refresh_token: string };
      now += 91 * DAY;
      const lapsed = await token({ grant_type: "refresh_token", refresh_token, client_id: CLIENT });
      expect(await lapsed.json()).toMatchObject({ error: "invalid_grant" });
    } finally {
      now = start;
    }
  });

  it("keeps a Connection used now and then from lapsing", async () => {
    const start = now;
    try {
      let { access_token, refresh_token } = await connect();
      for (let month = 0; month < 4; month++) {
        now += 50 * DAY;
        const answer = await token({
          grant_type: "refresh_token",
          refresh_token,
          client_id: CLIENT,
        });
        expect(answer.status).toBe(200);
        ({ access_token, refresh_token } = (await answer.json()) as {
          access_token: string;
          refresh_token: string;
        });
        expect((await mcp(access_token)).status).toBe(200);
      }
    } finally {
      now = start;
    }
  });
});

describe("/mcp", () => {
  it("reaches the Account's MCP handler as the Connection's Account", async () => {
    const { access_token } = await connect(kim);
    const response = await mcp(access_token);
    expect(response.status).toBe(200);
    expect(accountMcp).toHaveBeenCalledOnce();
    const [forwarded, options] = accountMcp.mock.calls[0] as [Request, { account: number }];
    expect(options.account).toBe(kim.caller.kind === "web" ? kim.caller.account : -1);
    expect(forwarded.url).toBe("http://localhost/mcp");
  });

  it("ends every Connection of an Account the Admin disables, at once", async () => {
    const lee = await addAccount(fixture.core, "lee@example.com");
    const { access_token, refresh_token } = await connect(lee);
    expect((await mcp(access_token)).status).toBe(200);
    const leeId = lee.caller.kind === "web" ? lee.caller.account : -1;
    await fixture.core.run("disable_account", fixture.web, { account: leeId });
    expect((await mcp(access_token)).status).toBe(401);
    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token,
      client_id: CLIENT,
    });
    expect(await refreshed.json()).toMatchObject({ error: "invalid_grant" });
    await fixture.core.run("enable_account", fixture.web, { account: leeId });
    expect((await mcp(access_token)).status).toBe(401);
    expect(fixture.core.accounts.connections(leeId)).toEqual([]);
  });

  it("ends them with the Account when it is deleted", async () => {
    const ash = await addAccount(fixture.core, "ash@example.com");
    const { access_token } = await connect(ash);
    const ashId = ash.caller.kind === "web" ? ash.caller.account : -1;
    await fixture.core.run("admin_delete_account", fixture.web, {
      account: ashId,
      email: "ash@example.com",
    });
    expect((await mcp(access_token)).status).toBe(401);
  });
});

describe("Claude Code's loopback callback and DCR", () => {
  it("matches a CIMD loopback redirect with the port ignored", async () => {
    const { access_token } = await connect(
      fixture.web,
      CODE_CLIENT,
      "http://localhost:53682/callback",
    );
    expect((await mcp(access_token)).status).toBe(200);
    const page = await request(
      `/authorize?${authorizeQuery({ client_id: CODE_CLIENT, redirect_uri: "http://localhost:9/other" })}`,
    );
    expect(page.status).toBe(400);
  });

  it("registers a client (RFC 7591) with no secret, and connects it", async () => {
    const registered = await request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as Record<string, unknown>;
    expect(client.token_endpoint_auth_method).toBe("none");
    expect(client.client_secret).toBeUndefined();
    const clientId = client.client_id as string;

    const page = await request(
      `/authorize?${authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:4000/callback" })}`,
    );
    const text = await page.text();
    expect(text).toContain("<strong>A program on this computer</strong>");
    expect(text).not.toContain("<strong>Claude</strong>");

    const { access_token } = await connect(fixture.web, clientId, "http://127.0.0.1:4000/callback");
    expect((await mcp(access_token)).status).toBe(200);
  });

  it("refuses to register a redirect URI that is neither Claude's nor loopback", async () => {
    const registered = await request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://evil.example/callback"] }),
    });
    expect(registered.status).toBe(400);
    expect(await registered.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });
});

describe("the Account page's Connections", () => {
  it("lists the Account's own Connections, and Disconnect ends one at once", async () => {
    const jo = await addAccount(fixture.core, "jo@example.com");
    const cookie = loginCookie(fixture.core, jo);
    const { access_token } = await connect(jo);
    const call = (name: string, input: unknown, as = cookie) =>
      request(`/api/${name}`, {
        method: "POST",
        headers: { cookie: as, origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(input),
      });

    const listed = (await (await call("list_connections", {})).json()) as {
      connections: { id: number; client: string; createdAt: string; lastUsedAt: string }[];
    };
    expect(listed.connections).toEqual([
      {
        id: expect.any(Number),
        client: "claude.ai",
        createdAt: expect.any(String),
        lastUsedAt: expect.any(String),
      },
    ]);
    const id = listed.connections[0]?.id as number;

    // Another Account can neither see nor end it.
    const other = loginCookie(fixture.core, kim);
    const theirs = (await (await call("list_connections", {}, other)).json()) as {
      connections: { id: number }[];
    };
    expect(theirs.connections.map((each) => each.id)).not.toContain(id);
    expect((await call("end_connection", { connection: id }, other)).status).toBe(404);

    expect((await call("end_connection", { connection: id })).status).toBe(200);
    expect((await mcp(access_token)).status).toBe(401);
    const after = (await (await call("list_connections", {})).json()) as { connections: [] };
    expect(after.connections).toEqual([]);
  });

  it("gives the Connect to Claude block its links, from the server's own origin", async () => {
    const response = await request("/api/claude_connect", {
      method: "POST",
      headers: {
        cookie: loginCookie(fixture.core, kim),
        origin: ORIGIN,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(await response.json()).toEqual({
      mcpUrl: MCP_URL,
      addConnectorUrl:
        "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Settle" +
        "&connectorUrl=https%3A%2F%2Fsettle.example.com%2Fmcp",
      claudeCodeCommand:
        `claude mcp add --transport http --scope user settle ${MCP_URL} && ` +
        "claude plugin marketplace add alexzfe/settle && " +
        "claude plugin install settle@settle --scope user",
    });
  });
});

describe("the CIMD fetch", () => {
  it("refuses anything but https, and private, loopback and link-local addresses", async () => {
    for (const url of [
      "http://example.com/client",
      "https://localhost/client",
      "https://127.0.0.1/client",
      "https://10.1.2.3/client",
      "https://192.168.1.1/client",
      "https://169.254.169.254/latest",
      "https://[::1]/client",
      "https://[::ffff:127.0.0.1]/client",
      "not a url",
    ]) {
      await expect(fetchClientMetadata(url), url).rejects.toThrow();
    }
  });

  it("counts every private range as blocked, and a public address as not", () => {
    for (const address of [
      "10.0.0.1",
      "172.16.5.4",
      "100.64.0.1",
      "0.0.0.0",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(addressBlocked(address), address).toBe(true);
    }
    for (const address of ["160.79.104.10", "2606:4700::1111"]) {
      expect(addressBlocked(address), address).toBe(false);
    }
  });
});
