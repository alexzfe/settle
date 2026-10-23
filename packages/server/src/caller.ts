import type { CallContext, Caller } from "@settle/core";
import type { Context } from "hono";

// Who a request is from, as the login check (auth.ts) found it.

declare module "hono" {
  interface ContextVariableMap {
    /** The web caller, when a Login's cookie let the request through. */
    caller: Caller;
    /** The Home whose key let the request through, when one did. */
    keyed: string;
  }
}

/**
 * The web caller for this request: the Account of the Login the cookie named. Only a route the
 * check let through by its cookie has one; a route reached by a Home's key has none.
 */
export function callerOf(c: Context): CallContext {
  const caller = c.get("caller") as Caller | undefined;
  if (!caller) throw new Error(`${c.req.path} was reached without a Login`);
  return { caller };
}

/** The Home whose key let this request through, if it came in by one. */
export function keyedHomeOf(c: Context): string | undefined {
  return c.get("keyed") as string | undefined;
}
