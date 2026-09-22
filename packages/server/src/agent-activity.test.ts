import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AgentActivity } from "./agent-activity.js";
import { type RunningServer, startServer } from "./server.js";

// The Agent's last tool call per Home, as /events passes it on. Over real HTTP, as the Agent and
// the browser reach the server.

let root: string;
let server: RunningServer;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "settle-activity-"));
  server = await startServer({ host: "127.0.0.1", port: 0, dataDir: join(root, "data") });
});
afterAll(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

async function api(operation: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${server.url}/api/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function mcp(home: string, method: string, params: unknown): Promise<unknown> {
  const response = await fetch(`${server.url}/mcp/homes/${home}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return response.json();
}

const callTool = (home: string, name: string, args: unknown) =>
  mcp(home, "tools/call", { name, arguments: args });

interface Event {
  event: string;
  data: Record<string, unknown>;
}

/** Opens /events for the Home, returning a reader of its next events and a way to close it. */
async function listen(home: string) {
  const controller = new AbortController();
  const response = await fetch(`${server.url}/events?home=${home}`, {
    signal: controller.signal,
  });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  let taken = 0;
  return {
    /** The next `count` events, of either kind. */
    async next(count: number): Promise<Event[]> {
      for (;;) {
        const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((match) => ({
          event: match[1] as string,
          data: JSON.parse(match[2] as string) as Record<string, unknown>,
        }));
        if (events.length >= taken + count) {
          const found = events.slice(taken, taken + count);
          taken += count;
          return found;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error(`The event stream ended after: ${text}`);
        text += decoder.decode(value, { stream: true });
      }
    },
    close: () => controller.abort(),
  };
}

it("sends an agent event with the Home and time on each MCP tool call for that Home", async () => {
  await api("create_home", { name: "Busy home", country: "GB", city: "London" });
  await api("create_home", { name: "Quiet home", country: "GB", city: "London" });
  const events = await listen("busy-home");
  try {
    const before = Date.now();
    await callTool("quiet-home", "open_session", { skill: "home-intake" });
    await callTool("busy-home", "open_session", { skill: "home-intake" });
    const [agent] = await events.next(1);
    expect(agent?.event).toBe("agent");
    expect(agent?.data).toEqual({ home: "busy-home", at: expect.any(String) });
    const at = Date.parse(agent?.data.at as string);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now());
  } finally {
    events.close();
  }
});

it("sends an agent event before the change events of a writing tool call", async () => {
  await api("create_home", { name: "Session home", country: "GB", city: "London" });
  const events = await listen("session-home");
  try {
    await callTool("session-home", "open_session", { skill: "home-intake" });
    expect((await events.next(2)).map((each) => each.event)).toEqual(["agent", "change"]);
  } finally {
    events.close();
  }
});

it("sends the last call once on connect, so a page opened mid-Session knows at once", async () => {
  await api("create_home", { name: "Mid home", country: "GB", city: "London" });
  await callTool("mid-home", "open_session", { skill: "home-intake" });
  const events = await listen("mid-home");
  try {
    const [first] = await events.next(1);
    expect(first?.event).toBe("agent");
    expect(first?.data.home).toBe("mid-home");
  } finally {
    events.close();
  }
});

it("counts neither the web's own calls, nor tools/list, nor a call refused before the tool runs", async () => {
  await api("create_home", { name: "Web home", country: "GB", city: "London" });
  await api("get_home", { home: "web-home" });
  await mcp("web-home", "tools/list", {});
  await callTool("web-home", "no_such_tool", {});
  await callTool("web-home", "open_session", { skill: 42 });
  const events = await listen("web-home");
  try {
    // Nothing was recorded, so nothing stale is sent on connect: the first event is this call's.
    const since = new Date().toISOString();
    await callTool("web-home", "open_session", { skill: "home-intake" });
    const [first] = await events.next(1);
    expect(first?.event).toBe("agent");
    expect(String(first?.data.at) >= since).toBe(true);
  } finally {
    events.close();
  }
});

it("remembers the last call per Home and tells its listeners until they stop", () => {
  let now = new Date("2026-09-21T10:00:00Z");
  const activity = new AgentActivity(() => now);
  const heard: unknown[] = [];
  const stop = activity.subscribe((event) => heard.push(event));
  expect(activity.last("flat")).toBeUndefined();
  activity.record("flat", "open_session");
  now = new Date("2026-09-21T10:05:00Z");
  activity.record("flat", "save_room");
  stop();
  activity.record("house", "list_decisions");
  expect(activity.last("flat")).toEqual({ at: "2026-09-21T10:05:00.000Z", tool: "save_room" });
  expect(activity.last("house")?.tool).toBe("list_decisions");
  expect(heard).toEqual([
    { home: "flat", at: "2026-09-21T10:00:00.000Z" },
    { home: "flat", at: "2026-09-21T10:05:00.000Z" },
  ]);
});
