import type { Core } from "@settle/core";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AgentActivity } from "./agent-activity.js";

// Well under the idle timeouts of proxies and of Node's own server.
const KEEP_ALIVE_MS = 25_000;

/**
 * GET /events?home=<slug>: Server-Sent Events, one "change" event with data
 * { home, recordKind, recordSlug } for each record a committed write changed in that Home, and
 * one "agent" event with data { home, at } for each MCP tool call the Agent makes for it. The
 * last "agent" event, when there is one, is also sent on connect.
 */
export function streamChanges(core: Core, activity: AgentActivity, c: Context): Response {
  const home = c.req.query("home");
  if (!home) {
    const message = "Pass the Home's slug, as /events?home=<slug>.";
    return c.json({ error: { code: "validation", message } }, 400);
  }
  // A reverse proxy (nginx, as on the homeserver) would otherwise hold the stream in its buffer
  // and deliver events late or in bursts; this header tells it to pass each one through at once.
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    // Writes go out one after another; a failed write means the client left, and onAbort ends it.
    let writing: Promise<unknown> = Promise.resolve();
    const send = (write: () => Promise<unknown>) => {
      writing = writing.then(write).catch(() => {});
    };
    // A comment first, so the response and its headers reach the client straight away.
    send(() => stream.write(": connected\n\n"));
    const sendAgent = (at: string) =>
      send(() => stream.writeSSE({ event: "agent", data: JSON.stringify({ home, at }) }));
    const last = activity.last(home);
    if (last) sendAgent(last.at);
    const stop = core.subscribe((event) => {
      if (event.home !== home) return;
      send(() => stream.writeSSE({ event: "change", data: JSON.stringify(event) }));
    });
    const stopAgent = activity.subscribe((event) => {
      if (event.home === home) sendAgent(event.at);
    });
    const keepAlive = setInterval(
      () => send(() => stream.write(": keep-alive\n\n")),
      KEEP_ALIVE_MS,
    );
    await new Promise<void>((resolve) => stream.onAbort(resolve));
    clearInterval(keepAlive);
    stop();
    stopAgent();
  });
}
