import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_FILES } from "@settle/core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type RunningServer, startServer } from "./server.js";

// Over real HTTP, as the Agent and the browser reach the server.

let root: string;
let server: RunningServer;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "settle-server-"));
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
  expect(existsSync(join(root, "data", "settle.sqlite"))).toBe(true);
});

it("runs MCP tool calls end to end: open_session, then save_room", async () => {
  await api("create_home", { name: "Tool home", country: "GB", city: "London" });

  const opening = await callTool("tool-home", "open_session", { skill: "home-intake" });
  const session = /^Session: (\S+)$/m.exec(opening)?.[1] ?? "";
  const receipt = await callTool("tool-home", "save_room", { session, name: "Kitchen" });

  expect(session).toMatch(/^home-intake-/);
  expect(opening).toContain("Home: Tool home");
  expect(receipt.split("\n")[0]).toBe("Kitchen (kitchen): created on Ground");
  expect(receipt).toContain("Gaps left in Kitchen (kitchen): wall lengths, ceiling height");
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

it("sends one change event per record a save_room writes, with the record's kind", async () => {
  await api("create_home", { name: "Parts home", country: "GB", city: "London" });
  const controller = new AbortController();
  const response = await fetch(`${server.url}/events?home=parts-home`, {
    signal: controller.signal,
  });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  try {
    const opening = await callTool("parts-home", "open_session", { skill: "home-intake" });
    const session = /^Session: (\S+)$/m.exec(opening)?.[1] ?? "";
    await callTool("parts-home", "save_room", {
      session,
      name: "Kitchen",
      walls: [{ position: 1 }, { position: 2 }],
      surfaces: { floor: { finish: "oiled" } },
      windows: [{ wall: 1 }],
    });
    const home = "parts-home";
    expect(await nextChanges(reader, 6)).toEqual([
      { home, recordKind: "session", recordSlug: session },
      { home, recordKind: "room", recordSlug: "kitchen" },
      { home, recordKind: "wall", recordSlug: "kitchen/wall-1" },
      { home, recordKind: "wall", recordSlug: "kitchen/wall-2" },
      { home, recordKind: "surface", recordSlug: "kitchen/floor" },
      { home, recordKind: "window", recordSlug: "kitchen-window" },
    ]);
  } finally {
    controller.abort();
  }
});

it("sends decision, flag, and conflict events when a Reopen flags a Decision", async () => {
  const home = "decision-home";
  await api("create_home", { name: "Decision home", country: "GB", city: "London" });
  const opening = await callTool(home, "open_session", { skill: "design-direction" });
  const session = /^Session: (\S+)$/m.exec(opening)?.[1] ?? "";
  const tool = (name: string, args: Record<string, unknown>) =>
    callTool(home, name, { session, ...args });
  const reason = 'The user: "yes"';
  await tool("save_room", { name: "Living room" });
  await tool("save_decision", {
    kind: "design-direction",
    title: "Warm minimalism",
    statement: "Calm, warm rooms.",
  });
  await tool("set_decision_state", { decision: "warm-minimalism", to: "locked", reason });
  await tool("save_decision", {
    kind: "room-direction",
    room: "living-room",
    title: "Calm evenings",
    statement: "Low and warm.",
    content: { direction: "Lamplight and wool." },
  });
  await tool("set_decision_state", { decision: "calm-evenings", to: "locked", reason });

  const controller = new AbortController();
  const response = await fetch(`${server.url}/events?home=${home}`, {
    signal: controller.signal,
  });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  try {
    await api("set_decision_state", { home, decision: "warm-minimalism", to: "leaning" });
    await tool("flag_conflict", { decision: "calm-evenings", description: "It should be bright." });
    expect(await nextChanges(reader, 3)).toEqual([
      { home, recordKind: "decision", recordSlug: "warm-minimalism" },
      { home, recordKind: "flag", recordSlug: "calm-evenings/flag-1" },
      { home, recordKind: "conflict", recordSlug: "calm-evenings/conflict-1" },
    ]);
  } finally {
    controller.abort();
  }
});

it("keeps an uploaded Blueprint and its rendered pages in the data dir", async () => {
  await api("create_home", { name: "Plan home", country: "GB", city: "London" });
  const form = new FormData();
  form.set("home", "plan-home");
  form.set("label", "Agent plan");
  form.set(
    "file",
    new File([readFileSync(join(FIXTURE_FILES, "blueprint-a3.pdf"))], "plan.pdf", {
      type: "application/pdf",
    }),
  );

  const response = await fetch(`${server.url}/api/upload_blueprint`, {
    method: "POST",
    body: form,
  });
  const page = await fetch(
    `${server.url}/api/get_blueprint_page?home=plan-home&blueprint=agent-plan&page=1`,
  );

  expect(response.status).toBe(200);
  expect(existsSync(join(root, "data", "uploads", "plan-home", "agent-plan.pdf"))).toBe(true);
  expect(existsSync(join(root, "data", "rendered", "plan-home", "agent-plan", "page-1.png"))).toBe(
    true,
  );
  expect(page.headers.get("content-type")).toBe("image/png");
});

it("writes the port it listens on into a Home Folder's .mcp.json when started on port 0", async () => {
  await api("create_home", { name: "Folder home", country: "GB", city: "London" });
  const folder = join(root, "folder-home");

  await api("set_up_home_folder", { home: "folder-home", path: folder });

  const mcp = JSON.parse(readFileSync(join(folder, ".mcp.json"), "utf8"));
  expect(mcp.mcpServers["settle"].url).toBe(`${server.url}/mcp/homes/folder-home`);
});

async function nextChange(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  return (await nextChanges(reader, 1))[0];
}

/** The next `count` change events on the stream. */
async function nextChanges(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<unknown[]> {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const events = [...text.matchAll(/event: change\ndata: (.*)\n/g)].map((match) =>
      JSON.parse(match[1] as string),
    );
    if (events.length >= count) return events.slice(0, count);
    const { value, done } = await reader.read();
    if (done) throw new Error(`The event stream ended after: ${text}`);
    text += decoder.decode(value, { stream: true });
  }
}
