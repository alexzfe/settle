// The rules of Connections, as core keeps them for the OAuth server: every token and code stored
// as its SHA-256; a code works once, for its client, redirect URI and PKCE verifier; a refresh
// token is replaced on every use; an access token lasts an hour; a Connection lapses 90 days after
// its last use, and ends at once when its Account is disabled, deleted, reset, logs out
// everywhere, or disconnects it.
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type GrantResult, pkceMatches, type TokenGrant, tokenHash } from "./accounts.js";
import { type CallContext, type Core, createCore } from "./core.js";
import { addAccount, TEST_PASSWORD, TEST_PASSWORD_COST } from "./fixture/fixture-home.js";
import { openStore, type Store } from "./store.js";

const ORIGIN = "https://settle.example.com";
const CLIENT = "https://claude.ai/oauth/claude-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const DAY = 24 * 60 * 60 * 1000;

let now: number;
let store: Store;
let core: Core;
let admin: CallContext;
let kim: CallContext;
let kimId: number;

beforeEach(async () => {
  now = Date.parse("2026-10-24T10:00:00Z");
  store = openStore(":memory:");
  core = createCore({
    store,
    publicOrigin: ORIGIN,
    clock: () => new Date(now),
    passwordCost: TEST_PASSWORD_COST,
  });
  admin = await addAccount(core, "sam@example.com");
  kim = await addAccount(core, "kim@example.com");
  kimId = (kim.caller as { account: number }).account;
});
afterEach(() => core.close());

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function granted(result: GrantResult): TokenGrant {
  if (result.outcome !== "ok") throw new Error(`Refused: ${result.why}`);
  return result.grant;
}

function connect(accountId = kimId) {
  const { verifier, challenge } = pkce();
  const code = core.accounts.connect(accountId, {
    clientId: CLIENT,
    clientHost: "claude.ai",
    redirectUri: CALLBACK,
    codeChallenge: challenge,
  });
  return { code, verifier };
}

function exchange(code: string, verifier: string, overrides: Partial<{ clientId: string }> = {}) {
  return core.accounts.exchangeCode({
    code,
    clientId: CLIENT,
    redirectUri: CALLBACK,
    verifier,
    ...overrides,
  });
}

describe("Connections", () => {
  it("names the MCP URL every token is bound to", () => {
    expect(core.accounts.mcpUrl).toBe(`${ORIGIN}/mcp`);
  });

  it("store every code and token as its SHA-256, never as given", () => {
    const { code, verifier } = connect();
    const grant = granted(exchange(code, verifier));
    const [connection] = store.connections(kimId);
    expect(connection?.refreshHash).toBe(tokenHash(grant.refreshToken));
    expect(store.accessToken(tokenHash(grant.accessToken))).toBeDefined();
    expect(store.authorizationCode(tokenHash(code))).toBeDefined();
    const everything = JSON.stringify([
      connection,
      store.accessToken(tokenHash(grant.accessToken)),
      store.authorizationCode(tokenHash(code)),
    ]);
    for (const secret of [code, grant.accessToken, grant.refreshToken]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("are not listed until their code is exchanged, then are, with the client's host", () => {
    const { code, verifier } = connect();
    expect(core.accounts.connections(kimId)).toEqual([]);
    granted(exchange(code, verifier));
    expect(core.accounts.connections(kimId)).toEqual([
      expect.objectContaining({ accountId: kimId, clientId: CLIENT, clientHost: "claude.ai" }),
    ]);
  });

  it("open /mcp as their Account while the access token lasts an hour", () => {
    const { code, verifier } = connect();
    const { accessToken, expiresIn } = granted(exchange(code, verifier));
    expect(expiresIn).toBe(3600);
    expect(core.accounts.connected(accessToken)?.account.id).toBe(kimId);
    expect(core.accounts.connected(`${accessToken}x`)).toBeUndefined();
    now += 3601 * 1000;
    expect(core.accounts.connected(accessToken)).toBeUndefined();
  });

  it("refuse a code for another client, a wrong verifier, or a late exchange, and end with it", () => {
    for (const spoil of [
      (code: string, verifier: string) =>
        exchange(code, verifier, { clientId: "https://x.example" }),
      (code: string) => exchange(code, pkce().verifier),
      (code: string, verifier: string) => {
        now += 6 * 60 * 1000;
        return exchange(code, verifier);
      },
    ]) {
      const { code, verifier } = connect();
      expect(spoil(code, verifier).outcome).toBe("refused");
      expect(exchange(code, verifier).outcome).toBe("refused");
    }
    expect(store.connections(kimId)).toEqual([]);
  });

  it("refresh into a new pair, the old refresh token void", () => {
    const { code, verifier } = connect();
    const first = granted(exchange(code, verifier));
    const second = granted(
      core.accounts.refresh({ refreshToken: first.refreshToken, clientId: CLIENT }),
    );
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(
      core.accounts.refresh({ refreshToken: first.refreshToken, clientId: CLIENT }).outcome,
    ).toBe("refused");
    expect(core.accounts.connected(second.accessToken)?.connection).toBeDefined();
  });

  it("lapse 90 days after their last use, and a use a minute apart puts that off", () => {
    const { code, verifier } = connect();
    const grant = granted(exchange(code, verifier));
    now += 89 * DAY;
    const refreshed = granted(
      core.accounts.refresh({ refreshToken: grant.refreshToken, clientId: CLIENT }),
    );
    // A tool call, 89 more days on, is a use too.
    now += 30 * 60 * 1000;
    expect(core.accounts.connected(refreshed.accessToken)).toBeDefined();
    now += 89 * DAY;
    const again = granted(
      core.accounts.refresh({ refreshToken: refreshed.refreshToken, clientId: CLIENT }),
    );
    now += 91 * DAY;
    expect(core.accounts.connections(kimId)).toEqual([]);
    expect(
      core.accounts.refresh({ refreshToken: again.refreshToken, clientId: CLIENT }).outcome,
    ).toBe("refused");
  });

  it("end at once when the Account is disabled, and stay ended when it is enabled again", async () => {
    const { code, verifier } = connect();
    const grant = granted(exchange(code, verifier));
    await core.run("disable_account", admin, { account: kimId });
    expect(core.accounts.connected(grant.accessToken)).toBeUndefined();
    expect(store.connections(kimId)).toEqual([]);
    await core.run("enable_account", admin, { account: kimId });
    expect(core.accounts.connected(grant.accessToken)).toBeUndefined();
  });

  it("end with their Account when it is deleted", async () => {
    const { code, verifier } = connect();
    const grant = granted(exchange(code, verifier));
    await core.run("delete_account", kim, { email: "kim@example.com" });
    expect(core.accounts.connected(grant.accessToken)).toBeUndefined();
    expect(store.connections(kimId)).toEqual([]);
  });

  it("end when the Account logs out everywhere", async () => {
    const { code, verifier } = connect();
    const grant = granted(exchange(code, verifier));
    await core.run("end_logins", kim, {});
    expect(core.accounts.connected(grant.accessToken)).toBeUndefined();
    expect(store.connections(kimId)).toEqual([]);
  });

  it("end when a reset link sets a new password", async () => {
    const { code, verifier } = connect();
    const grant = granted(exchange(code, verifier));
    const { reset } = await core.run("create_reset_link", admin, { account: kimId });
    const token = reset.url.slice(reset.url.lastIndexOf("/") + 1);
    await core.accounts.redeem("reset", token, { password: `${TEST_PASSWORD} again` });
    expect(core.accounts.connected(grant.accessToken)).toBeUndefined();
    expect(store.connections(kimId)).toEqual([]);
  });

  it("end one at a time by Disconnect, the Account's own only", () => {
    const { code, verifier } = connect();
    const grant = granted(exchange(code, verifier));
    const [connection] = core.accounts.connections(kimId);
    const adminId = (admin.caller as { account: number }).account;
    expect(core.accounts.disconnect(adminId, connection?.id as number)).toBe(false);
    expect(core.accounts.disconnect(kimId, connection?.id as number)).toBe(true);
    expect(core.accounts.connected(grant.accessToken)).toBeUndefined();
  });
});

describe("registered clients", () => {
  it("get a new id each, and are pruned a day on when no Connection uses them", () => {
    const client = core.accounts.registerClient({ redirectUris: [CALLBACK], clientName: "Claude" });
    expect(core.accounts.registeredClient(client.clientId)?.redirectUris).toEqual([CALLBACK]);
    now += 2 * DAY;
    core.accounts.registerClient({ redirectUris: [CALLBACK] });
    expect(core.accounts.registeredClient(client.clientId)).toBeUndefined();
  });
});

describe("PKCE", () => {
  it("matches a verifier whose S256 is the challenge, and nothing shorter than 43 characters", () => {
    const { verifier, challenge } = pkce();
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches(pkce().verifier, challenge)).toBe(false);
    const short = "abc";
    expect(pkceMatches(short, createHash("sha256").update(short).digest("base64url"))).toBe(false);
  });
});
