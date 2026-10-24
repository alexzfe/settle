import type { Core, GoogleIdentity } from "@settle/core";
import { CoreError, LINK_MISS } from "@settle/core";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as oauth from "oauth4webapi";
import type { GoogleClient } from "./config.js";

// Sign in with Google: a second way to log in, next to the password, and to use an invite. Off
// unless the server's owner sets the Google client (config.ts). Google is asked only who signed in
// (openid email profile); its ID token is read once at the code exchange and dropped, and no
// Google token is stored or reaches Claude or /mcp. Who may get in is still Settle's call: a
// Google account reaches only the Account linked to it, or one whose email is Google's verified
// email (which is linked from then on), or a new one through an invite link. A Google sign-in
// alone never makes an Account. The plumbing (PKCE, state, nonce, the ID token's checks) is
// panva's oauth4webapi.
//
// When Claude connects, Settle's Allow page (oauth.ts) comes before the login page, so before any
// trip to Google: Google's remembered consent cannot let a client past the Allow.

export const GOOGLE_PATHS = { start: "/auth/google", callback: "/auth/google/callback" } as const;

/** Only who signed in: more would bring Google's review, and its 7-day expiry for test apps. */
export const GOOGLE_SCOPES = "openid email profile";

/** Google's endpoints, as its discovery document gives them; fixed, so no fetch is needed. */
const GOOGLE: oauth.AuthorizationServer = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
};

export interface GoogleOptions {
  client: GoogleClient;
  /** How Google's token endpoint is reached; a test gives a fake. */
  fetch?: typeof fetch;
}

/** Where Google sends the browser back: the URI the owner registers on the Web client. */
export function googleRedirectUri(origin: string): string {
  return `${origin}${GOOGLE_PATHS.callback}`;
}

/** The round trip's own cookie: what the callback checks Google's answer against. */
const COOKIE = "settle_google";
const COOKIE_MINUTES = 10;

interface Trip {
  state: string;
  verifier: string;
  nonce: string;
  /** Where a login goes after; absent for an invite. */
  next?: string;
  /** The invite link's token, for an invite redeemed with Google. */
  invite?: string;
}

/** What the routes need from the login (auth.ts): starting a Login, and its pages. */
export interface GoogleLogin {
  /** Starts a Login for the Account and sends the browser to `next`. */
  logIn(c: Context, account: number, next: string): Response;
  /** The login page, with an error. */
  loginPage(c: Context, next: string, error: string, status: 400 | 403): Response;
  /** The invite page, with an error. */
  invitePage(c: Context, token: string, error: string): Response;
  /** A page with one message. */
  notice(c: Context, message: string, status: 400 | 404 | 502): Response;
  safeNext(next: string | undefined): string;
  secure: boolean;
}

/** Adds GET /auth/google (sends the browser to Google) and its callback. Both need no Login. */
export function useGoogle(
  app: Hono,
  { core, google, login }: { core: Core; google: GoogleOptions; login: GoogleLogin },
): void {
  const client: oauth.Client = { client_id: google.client.clientId };
  const clientAuth = oauth.ClientSecretPost(google.client.clientSecret);
  const redirectUri = googleRedirectUri(core.accounts.origin);
  const requestOptions: oauth.TokenEndpointRequestOptions = google.fetch
    ? { [oauth.customFetch]: google.fetch }
    : {};

  // ?next= for a login, ?invite= for an invite. A link, not a form: a form's post may not lead
  // to another site under the pages' form-action 'self'.
  app.get(GOOGLE_PATHS.start, async (c) => {
    const invite = c.req.query("invite");
    const trip: Trip = {
      state: oauth.generateRandomState(),
      verifier: oauth.generateRandomCodeVerifier(),
      nonce: oauth.generateRandomNonce(),
      ...(invite ? { invite } : { next: login.safeNext(c.req.query("next")) }),
    };
    setCookie(c, COOKIE, Buffer.from(JSON.stringify(trip)).toString("base64url"), {
      httpOnly: true,
      // Lax: the browser comes back from Google as a top-level navigation, which carries it.
      sameSite: "Lax",
      path: GOOGLE_PATHS.start,
      secure: login.secure,
      maxAge: COOKIE_MINUTES * 60,
    });
    const url = new URL(GOOGLE.authorization_endpoint as string);
    url.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      state: trip.state,
      nonce: trip.nonce,
      code_challenge: await oauth.calculatePKCECodeChallenge(trip.verifier),
      code_challenge_method: "S256",
      // A shared computer: let the person pick which Google account, every time.
      prompt: "select_account",
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get(GOOGLE_PATHS.callback, async (c) => {
    const trip = readTrip(getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: GOOGLE_PATHS.start, secure: login.secure });
    if (!trip) {
      return login.notice(
        c,
        "That Google sign-in took too long, or began in another browser. Start it again.",
        400,
      );
    }
    const back = (error: string, status: 400 | 403) =>
      trip.invite === undefined
        ? login.loginPage(c, trip.next ?? "/", error, status)
        : login.invitePage(c, trip.invite, error);

    let identity: GoogleIdentity;
    try {
      const params = oauth.validateAuthResponse(GOOGLE, client, new URL(c.req.url), trip.state);
      const response = await oauth.authorizationCodeGrantRequest(
        GOOGLE,
        client,
        clientAuth,
        params,
        redirectUri,
        trip.verifier,
        requestOptions,
      );
      const result = await oauth.processAuthorizationCodeResponse(GOOGLE, client, response, {
        expectedNonce: trip.nonce,
        requireIdToken: true,
      });
      // Read once here; the tokens go no further than this function.
      const claims = oauth.getValidatedIdTokenClaims(result) as oauth.IDToken;
      identity = {
        sub: claims.sub,
        ...(typeof claims.email === "string" ? { email: claims.email } : {}),
        emailVerified: claims.email_verified === true,
      };
    } catch (error) {
      if (error instanceof oauth.AuthorizationResponseError && error.error === "access_denied") {
        return back("Google sign-in was cancelled.", 400);
      }
      console.warn(`Google sign-in failed: ${error instanceof Error ? error.message : error}`);
      return back("Google sign-in didn't work. Try again, or use your email and password.", 400);
    }

    if (trip.invite !== undefined) {
      try {
        const account = core.accounts.redeemWithGoogle(trip.invite, identity);
        return login.logIn(c, account.id, "/");
      } catch (error) {
        if (!(error instanceof CoreError)) throw error;
        if (error.code === "validation") return login.invitePage(c, trip.invite, error.message);
        return login.notice(c, LINK_MISS, 404);
      }
    }

    const result = core.accounts.googleLogIn(identity);
    const next = trip.next ?? "/";
    switch (result.outcome) {
      case "ok":
        return login.logIn(c, result.account.id, next);
      case "disabled":
        return back("This account is disabled. Ask whoever runs this server.", 403);
      case "linked_elsewhere":
        return back(
          "The account with this email is linked to a different Google account. Log in with " +
            "that one, or with your email and password.",
          403,
        );
      case "unknown":
        console.warn(`Google sign-in with no Account for ${JSON.stringify(identity.email)}`);
        return back(noInvite(identity), 403);
    }
  });
}

/** An unknown or unverified Google account: there is no way in but an invite. */
function noInvite({ email, emailVerified }: GoogleIdentity): string {
  const who =
    email && emailVerified
      ? `${email} has no account here`
      : "This Google account has no account here";
  return (
    `${who}. To join, ask whoever runs this server for an invite, open its link, and choose ` +
    "Join with Google there."
  );
}

function readTrip(cookie: string | undefined): Trip | undefined {
  if (!cookie) return undefined;
  try {
    const trip = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8")) as Partial<Trip>;
    const text = (value: unknown) => typeof value === "string" && value !== "";
    if (!text(trip.state) || !text(trip.verifier) || !text(trip.nonce)) return undefined;
    if (trip.invite !== undefined && !text(trip.invite)) return undefined;
    return trip as Trip;
  } catch {
    return undefined;
  }
}
