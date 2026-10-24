// Sign in with Google, with Google's token endpoint faked: off unless configured, and then a
// second way to log in or use an invite that never makes an Account by itself, trusts only an
// email Google verified, matches on Google's `sub` first, refuses a disabled Account, and keeps
// `next` through the round trip so a login after Claude's Allow page ends back at the Allow.
import { createHash } from "node:crypto";
import { addAccount, type CallContext, createFixtureHome, type FixtureHome } from "@settle/core";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { FailureLimiter } from "./limits.js";

const ORIGIN = "https://settle.example.com";
const CLIENT_ID = "123-test.apps.googleusercontent.com";
const SECRET = "GOCSPX-test-secret";

interface Identity {
  sub: string;
  email?: string;
  email_verified?: boolean;
  aud?: string;
}

let fixture: FixtureHome;
let kim: CallContext;
let kimId: number;
/** Who the fake Google says signed in, at the next code exchange. */
let identity: Identity;
/** Each request the fake token endpoint got, as its form. */
let exchanges: URLSearchParams[];
/** The nonce Google was given, which its ID token carries back. */
let nonces: Map<string, string>;

beforeEach(async () => {
  fixture = await createFixtureHome({ publicOrigin: ORIGIN });
  kim = await addAccount(fixture.core, "kim@example.com");
  kimId = (kim.caller as { account: number }).account;
  identity = { sub: "google-kim", email: "kim@example.com", email_verified: true };
  exchanges = [];
  nonces = new Map();
});
afterEach(() => fixture.core.close());

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Google's token endpoint: the code it gave for a nonce, swapped for an ID token naming `identity`. */
const fakeGoogle: typeof fetch = async (input, init) => {
  expect(String(input)).toBe("https://oauth2.googleapis.com/token");
  const form = new URLSearchParams(String(init?.body));
  exchanges.push(form);
  const nonce = nonces.get(form.get("code") ?? "");
  if (!nonce) return Response.json({ error: "invalid_grant" }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  const { aud = CLIENT_ID, ...claims } = identity;
  const idToken = [
    base64url({ alg: "RS256", kid: "test", typ: "JWT" }),
    base64url({
      iss: "https://accounts.google.com",
      aud,
      azp: aud,
      iat: now,
      exp: now + 3600,
      nonce,
      ...claims,
    }),
    "c2lnbmF0dXJl",
  ].join(".");
  return Response.json({
    access_token: "ya29.google-access-token",
    expires_in: 3599,
    scope: "openid email profile",
    token_type: "Bearer",
    id_token: idToken,
  });
};

function app({ google = true }: { google?: boolean } = {}): Hono {
  return createApp({
    core: fixture.core,
    port: 4380,
    publicOrigin: ORIGIN,
    auth: {
      failures: new FailureLimiter(),
      ...(google
        ? { google: { client: { clientId: CLIENT_ID, clientSecret: SECRET }, fetch: fakeGoogle } }
        : {}),
    },
  });
}

function get(to: Hono, path: string, cookie?: string) {
  return to.request(path, {
    headers: { host: "settle.example.com", ...(cookie ? { cookie } : {}) },
  });
}

const cookieOf = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${name}=`))
    ?.split(";")[0];

/**
 * The whole round trip: Settle sends the browser to Google, the person picks an account, and
 * Google sends them back with a code. Returns the callback's answer and Google's sign-in URL.
 */
async function signIn(to: Hono, start: string, back: (url: URL) => string = codeBack) {
  const started = await get(to, start);
  expect(started.status).toBe(302);
  const google = new URL(started.headers.get("location") ?? "");
  const cookie = cookieOf(started, "settle_google");
  const callback = new URL(back(google));
  const response = await get(to, callback.pathname + callback.search, cookie);
  return { response, google, started };
}

/** Google's answer when the person signs in: a code for the trip's nonce, its state, and its iss. */
function codeBack(google: URL): string {
  const code = `code-${nonces.size}`;
  nonces.set(code, google.searchParams.get("nonce") ?? "");
  const state = google.searchParams.get("state") ?? "";
  return `${ORIGIN}/auth/google/callback?code=${code}&state=${state}&scope=openid+email+profile&iss=https%3A%2F%2Faccounts.google.com`;
}

async function inviteToken(): Promise<string> {
  const { invite } = await fixture.core.run("create_invite", fixture.web, {});
  return invite.url.slice(invite.url.lastIndexOf("/") + 1);
}

describe("off, as it is unless the server's owner sets the Google client", () => {
  it("shows no Google button and has no Google routes", async () => {
    const off = app({ google: false });
    expect(await (await get(off, "/login")).text()).not.toContain("Google");
    expect(await (await get(off, `/invite/${await inviteToken()}`)).text()).not.toContain("Google");
    for (const path of ["/auth/google", "/auth/google/callback?code=x&state=y"]) {
      const response = await get(off, path);
      // Not an open route: the door sends a stranger to log in, as for any page.
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toMatch(/^\/login\?next=/);
    }
  });
});

describe("on", () => {
  it("offers Log in with Google on the login page, keeping next", async () => {
    const page = await (await get(app(), "/login?next=%2Fauthorize%2Fresume")).text();
    expect(page).toContain('href="/auth/google?next=%2Fauthorize%2Fresume">Log in with Google</a>');
    // The password stays.
    expect(page).toContain('name="password"');
  });

  it("asks Google for openid email profile only, with PKCE S256, and a short cookie for the trip", async () => {
    const started = await get(app(), "/auth/google?next=/");
    const google = new URL(started.headers.get("location") ?? "");
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(google.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: `${ORIGIN}/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    expect(google.searchParams.get("client_secret")).toBeNull();
    const line = started.headers.getSetCookie().find((l) => l.startsWith("settle_google=")) ?? "";
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Lax/);
    expect(line).toMatch(/Path=\/auth\/google/);
  });

  it("links a password Account by Google's verified email and logs it in, back to next", async () => {
    const { response, google } = await signIn(app(), "/auth/google?next=%2Fauthorize%2Fresume");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/authorize/resume");
    const login = cookieOf(response, "settle_login");
    expect(
      fixture.core.accounts.current((login ?? "").slice("settle_login=".length)),
    ).toMatchObject({ account: { id: kimId, googleSub: "google-kim" } });
    // The exchange carried the secret, the redirect URI and the PKCE verifier of the challenge.
    const [form] = exchanges;
    expect(form?.get("client_secret")).toBe(SECRET);
    expect(form?.get("redirect_uri")).toBe(`${ORIGIN}/auth/google/callback`);
    const verifier = form?.get("code_verifier") ?? "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      google.searchParams.get("code_challenge"),
    );
  });

  it("matches on the sub after that, whatever the Google email has become", async () => {
    await signIn(app(), "/auth/google?next=/");
    identity = { sub: "google-kim", email: "kim.renamed@gmail.com", email_verified: true };
    const { response } = await signIn(app(), "/auth/google?next=/");
    expect(response.status).toBe(303);
  });

  it("refuses an email Google hasn't verified, and links nothing", async () => {
    identity = { sub: "google-kim", email: "kim@example.com", email_verified: false };
    const { response } = await signIn(app(), "/auth/google?next=/");
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("This Google account has no account here");
    expect(cookieOf(response, "settle_login")).toBeUndefined();
    expect(fixture.core.accounts.googleLogIn({ sub: "google-kim", emailVerified: false })).toEqual({
      outcome: "unknown",
    });
  });

  it("refuses an unknown email, saying to ask for an invite, and makes no Account", async () => {
    identity = { sub: "google-stranger", email: "stranger@gmail.com", email_verified: true };
    const before = fixture.core.accounts.count();
    const { response } = await signIn(app(), "/auth/google?next=%2Fauthorize%2Fresume");
    expect(response.status).toBe(403);
    const page = await response.text();
    expect(page).toContain("stranger@gmail.com has no account here");
    expect(page).toContain("ask whoever runs this server for an invite");
    // Still on the way back to the Allow, should they log in with a password instead.
    expect(page).toContain('value="/authorize/resume"');
    expect(fixture.core.accounts.count()).toBe(before);
  });

  it("refuses a disabled Account", async () => {
    await fixture.core.run("disable_account", fixture.web, { account: kimId });
    const { response } = await signIn(app(), "/auth/google?next=/");
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("This account is disabled");
    expect(cookieOf(response, "settle_login")).toBeUndefined();
  });

  it("refuses an ID token meant for another client", async () => {
    identity = { ...identity, aud: "someone-else.apps.googleusercontent.com" };
    const { response } = await signIn(app(), "/auth/google?next=/");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Google sign-in didn't work");
    expect(cookieOf(response, "settle_login")).toBeUndefined();
  });

  it("refuses a callback whose state isn't this browser's trip, without asking Google", async () => {
    const forged = await signIn(app(), "/auth/google?next=/", (google) =>
      codeBack(google).replace(/state=[^&]+/, "state=forged"),
    );
    expect(forged.response.status).toBe(400);
    expect(cookieOf(forged.response, "settle_login")).toBeUndefined();
    // A callback in a browser that never began the trip.
    const stray = await get(app(), "/auth/google/callback?code=code-0&state=x");
    expect(stray.status).toBe(400);
    expect(await stray.text()).toContain("began in another browser");
    expect(exchanges).toEqual([]);
  });

  it("says so when the person cancels at Google", async () => {
    const { response } = await signIn(app(), "/auth/google?next=/", (google) => {
      const state = google.searchParams.get("state") ?? "";
      return `${ORIGIN}/auth/google/callback?error=access_denied&state=${state}`;
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Google sign-in was cancelled.");
  });

  it("never sends a login off the site", async () => {
    const { response } = await signIn(app(), "/auth/google?next=%2F%2Fevil.example");
    expect(response.headers.get("location")).toBe("/");
  });
});

describe("an invite, used with Google", () => {
  it("offers Join with Google on the invite page, and only there", async () => {
    const token = await inviteToken();
    const page = await (await get(app(), `/invite/${token}`)).text();
    expect(page).toContain(`href="/auth/google?invite=${token}">Join with Google</a>`);
    expect(page).toContain('name="password"');
    const { reset } = await fixture.core.run("create_reset_link", fixture.web, { account: kimId });
    expect(await (await get(app(), new URL(reset.url).pathname)).text()).not.toContain("Google");
  });

  it("makes the Account with Google's verified email, linked, with no password", async () => {
    identity = { sub: "google-leo", email: "leo@gmail.com", email_verified: true };
    const token = await inviteToken();
    const { response } = await signIn(app(), `/auth/google?invite=${token}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    const login = (cookieOf(response, "settle_login") ?? "").slice("settle_login=".length);
    const account = fixture.core.accounts.current(login)?.account;
    expect(account).toMatchObject({
      email: "leo@gmail.com",
      googleSub: "google-leo",
      passwordHash: "",
    });
    expect(fixture.core.accounts.linkOpen("invite", token)).toBe(false);
  });

  it("refuses an unverified email and keeps the invite for another try", async () => {
    identity = { sub: "google-leo", email: "leo@gmail.com", email_verified: false };
    const token = await inviteToken();
    const { response } = await signIn(app(), `/auth/google?invite=${token}`);
    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain("hasn't verified");
    // Back on the invite's page, which still offers both ways.
    expect(page).toContain("Join with Google");
    expect(fixture.core.accounts.linkOpen("invite", token)).toBe(true);
  });

  it("refuses an invite that was used already", async () => {
    const token = await inviteToken();
    identity = { sub: "google-leo", email: "leo@gmail.com", email_verified: true };
    await signIn(app(), `/auth/google?invite=${token}`);
    identity = { sub: "google-max", email: "max@gmail.com", email_verified: true };
    const { response } = await signIn(app(), `/auth/google?invite=${token}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("This link doesn't work");
  });
});
