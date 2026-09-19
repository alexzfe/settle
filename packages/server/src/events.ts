import type { Core } from "@settle/core";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

// Well under the idle timeouts of proxies and of Node's own server.
const KEEP_ALIVE_MS = 25_000;

/**
 * GET /events?home=<slug>: Server-Sent Events, one "change" event with data
 * { home, recordKind, recordSlug } for each record a committed write changed in that Home.
 */
export function streamChanges(core: Core, c: Context): Response {
  const home = c.req.query("home");
  if (!home) {
    const message = "Pass the Home's slug, as /events?home=<slug>.";
    return c.json({ error: { code: "validation", message } }, 400);
  }
  return streamSSE(c, async (stream) => {
    // Writes go out one after another; a failed write means the client left, and onAbort ends it.
    let writing: Promise<unknown> = Promise.resolve();
    const send = (write: () => Promise<unknown>) => {
      writing = writing.then(write).catch(() => {});
    };
    // A comment first, so the response and its headers reach the client straight away.
    send(() => stream.write(": connected\n\n"));
    const stop = core.subscribe((event) => {
      if (event.home !== home) return;
      send(() => stream.writeSSE({ event: "change", data: JSON.stringify(event) }));
    });
    const keepAlive = setInterval(
      () => send(() => stream.write(": keep-alive\n\n")),
      KEEP_ALIVE_MS,
    );
    await new Promise<void>((resolve) => stream.onAbort(resolve));
    clearInterval(keepAlive);
    stop();
  });
}
