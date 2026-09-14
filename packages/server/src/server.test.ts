import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type RunningServer, startServer } from "./server.js";

// Over real HTTP, as the Agent and the browser reach the server.

let root: string;
let server: RunningServer;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "idh-server-"));
  server = await startServer({ port: 0, dataDir: join(root, "data") });
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

async function callTool(home: string, name: string, args: unknown): Promise<string> {
  const response = await fetch(`${server.url}/mcp/homes/${home}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = (await response.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  if (body.result.isError) throw new Error(body.result.content[0]?.text);
  return body.result.content[0]?.text ?? "";
}

it("creates the data dir and database, listens, and answers /health", async () => {
  const response = await fetch(`${server.url}/health`);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(existsSync(join(root, "data", "harness.sqlite"))).toBe(true);
});

it("runs MCP tool calls end to end: open_session, then save_room", async () => {
  await api("create_home", { name: "Tool home", country: "GB", city: "London" });

  const opening = await callTool("tool-home", "open_session", { skill: "home-intake" });
  const session = /^Session: (\S+)$/m.exec(opening)?.[1] ?? "";
  const receipt = await callTool("tool-home", "save_room", { session, name: "Kitchen" });

  expect(session).toMatch(/^home-intake-/);
  expect(opening).toContain("Home: Tool home");
  expect(receipt).toBe("Kitchen (kitchen): created on Ground");
  expect(await api("get_home", { home: "tool-home" })).toMatchObject({
    rooms: [{ slug: "kitchen", name: "Kitchen", level: "ground" }],
  });
});

it("sends a change event on /events after a write to that Home", async () => {
  const controller = new AbortController();
  const response = await fetch(`${server.url}/events?home=live-home`, {
    signal: controller.signal,
  });
  expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  try {
    await api("create_home", { name: "Other home", country: "GB", city: "London" });
    await api("create_home", { name: "Live home", country: "GB", city: "London" });
    expect(await nextChange(reader)).toEqual({
      home: "live-home",
      recordKind: "home",
      recordSlug: "live-home",
    });
  } finally {
    controller.abort();
  }
});

async function nextChange(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const data = /event: change\ndata: (.*)\n/.exec(text)?.[1];
    if (data !== undefined) return JSON.parse(data);
    const { value, done } = await reader.read();
    if (done) throw new Error(`The event stream ended after: ${text}`);
    text += decoder.decode(value, { stream: true });
  }
}
