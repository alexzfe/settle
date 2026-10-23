import { type CallContext, type Core, TEST_PASSWORD } from "@settle/core";
import type { Hono } from "hono";

// For the tests: an app whose every request carries a Login's cookie, as a browser logged in
// sends it.

/** A new Login for the web caller's Account, as the Cookie header a browser sends with it. */
export function loginCookie(core: Core, web: CallContext): string {
  if (web.caller.kind !== "web") throw new Error("Only a web caller logs in");
  return `settle_login=${core.accounts.startLogin(web.caller.account, "test")}`;
}

/** `app`, with the cookie on every request that doesn't send its own. */
export function asLoggedIn(app: Hono, cookie: string): Hono {
  return new Proxy(app, {
    get(target, property, receiver) {
      if (property !== "request") return Reflect.get(target, property, receiver);
      return (input: string | Request | URL, init: RequestInit = {}, ...rest: unknown[]) => {
        const headers = new Headers(init.headers);
        if (!headers.has("cookie")) headers.set("cookie", cookie);
        return (target.request as (...args: unknown[]) => unknown)(
          input,
          { ...init, headers },
          ...rest,
        );
      };
    },
  });
}

/**
 * Makes the Admin through a running server's setup link, as a browser does: returns its Login's
 * Cookie header.
 */
export async function setUp(url: string, email = "sam@example.com"): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { origin: new URL(url).origin },
    body: new URLSearchParams({ email, password: TEST_PASSWORD, again: TEST_PASSWORD }),
    redirect: "manual",
  });
  if (response.status !== 303) {
    throw new Error(`The setup link answered ${response.status}: ${await response.text()}`);
  }
  return (response.headers.get("set-cookie") ?? "").split(";")[0] as string;
}
