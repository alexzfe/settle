import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Core,
  createCore,
  FIXTURE_FILES,
  type GetDecisionResult,
  type GetRoomResult,
  type ListDecisionsResult,
} from "@idh/core";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { SERVER_INSTRUCTIONS } from "./mcp.js";
import { listTools, TOOLS_JSON } from "./tools-list.js";

const PORT = 4380;

let core: Core;
let app: Hono;
beforeEach(() => {
  core = createCore();
  app = createApp({ core, port: PORT });
});
afterEach(() => core.close());

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "idh-app-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function api(operation: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mcp(home: string, method: string, params: unknown, headers: Record<string, string> = {}) {
  return app.request(`/mcp/homes/${home}`, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${PORT}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function callTool(home: string, name: string, args: unknown): Promise<ToolResult> {
  const response = await mcp(home, "tools/call", { name, arguments: args });
  return ((await response.json()) as { result: ToolResult }).result;
}

it("answers /health", async () => {
  const response = await app.request("/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

describe("the web UI", () => {
  it("is a placeholder page at / when it has not been built", async () => {
    const response = await app.request("/");
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(await response.text()).toContain("Interior Design Harness");
  });

  it("is served from its build, with a history fallback that leaves the server's paths alone", async () => {
    const dist = tempDir();
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>The UI</title>");
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "assets", "app.js"), "console.log('ui')");
    const withUi = createApp({ core, port: PORT, webDist: dist });

    expect(await (await withUi.request("/assets/app.js")).text()).toBe("console.log('ui')");
    expect(await (await withUi.request("/")).text()).toContain("The UI");
    expect(await (await withUi.request("/homes/my-flat/sessions")).text()).toContain("The UI");
    expect((await withUi.request("/api/list_homes")).status).toBe(404);
  });
});

describe("the web API", () => {
  it("runs an operation: JSON in, JSON out", async () => {
    const created = await api("create_home", { name: "My flat", country: "GB", city: "London" });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({
      home: { slug: "my-flat", name: "My flat", country: "GB", city: "London", latitude: 51.5 },
    });
    const listed = await api("list_homes", {});
    expect(((await listed.json()) as { homes: unknown[] }).homes).toHaveLength(1);
  });

  it("answers a refusal with { error: { code, message } }: 400, 404, or 409", async () => {
    const invalid = await api("create_home", { name: "My flat", country: "GB" });
    const noCity = await api("create_home", { name: "x", country: "GB", city: "Nowhere-on-Sea" });
    const missing = await api("get_home", { home: "nowhere" });
    await api("create_home", { name: "Mine", country: "GB", city: "London" });
    await api("create_home", { name: "Theirs", country: "GB", city: "London" });
    const folder = tempDir();
    await api("set_up_home_folder", { home: "theirs", path: folder });
    const taken = await api("set_up_home_folder", { home: "mine", path: folder });

    expect([invalid.status, noCity.status, missing.status, taken.status]).toEqual([
      400, 400, 404, 409,
    ]);
    expect(await taken.json()).toEqual({
      error: { code: "folder_belongs_to_other_home", message: expect.stringContaining("Theirs") },
    });
    expect(((await noCity.json()) as { error: { code: string } }).error.code).toBe(
      "city_not_found",
    );
  });

  it("offers the Home model's read views: get_room, list_items, list_constraints, list_notes, get_change_log", async () => {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });
    const opened = await callTool("my-flat", "open_session", { skill: "home-intake" });
    const session = /^Session: (\S+)$/m.exec(opened.content[0]?.text ?? "")?.[1];
    await callTool("my-flat", "save_room", {
      session,
      name: "Kitchen",
      walls: [{ position: 1, length: { mm: 3400, provenance: "measured" } }],
    });
    await callTool("my-flat", "save_items", {
      session,
      items: [{ name: "Kettle", category: "appliances", room: "kitchen" }],
    });
    await callTool("my-flat", "set_constraints", { session, add: ["Two cats"] });
    await callTool("my-flat", "save_note", { session, text: "We might get a dog" });
    const read = async (operation: string, body: unknown) =>
      (await (await api(operation, { home: "my-flat", ...(body as object) })).json()) as Record<
        string,
        unknown
      >;

    expect(await read("get_room", { room: "kitchen" })).toMatchObject({
      room: {
        slug: "kitchen",
        walls: [{ slug: "kitchen/wall-1", length: { mm: 3400, provenance: "measured" } }],
        items: [{ slug: "kettle" }],
        gaps: expect.arrayContaining(["ceiling height"]),
      },
    });
    expect(await read("list_items", {})).toMatchObject({ items: [{ slug: "kettle" }] });
    expect(await read("list_constraints", {})).toEqual({
      constraints: [{ slug: "two-cats", text: "Two cats" }],
    });
    expect(await read("list_notes", {})).toMatchObject({ notes: [{ text: "We might get a dog" }] });
    expect(await read("get_home", {})).toMatchObject({ unplacedItems: 0 });
    const { changes } = (await read("get_change_log", {})) as { changes: { recordKind: string }[] };
    expect(changes[0]).toMatchObject({ origin: session, recordKind: "note" });
    expect(changes.at(-1)).toMatchObject({ origin: "web", recordKind: "home", record: "my-flat" });
  });

  it("does not offer the Agent's tools, or anything but JSON", async () => {
    const tool = await api("open_session", { skill: "home-intake" });
    const unknown = await api("drop_tables", {});
    const form = await app.request("/api/list_homes", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect([tool.status, unknown.status, form.status]).toEqual([404, 404, 415]);
  });
});

describe("the MCP endpoint", () => {
  it("answers initialize with the server's name and its instructions under 512 characters", async () => {
    const response = await mcp("any", "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { serverInfo: unknown; instructions: string };
    };
    expect(body.result.serverInfo).toEqual({ name: "int-design-harness", version: "0.0.1" });
    expect(body.result.instructions).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
  });

  it("lists the Agent tools, read tools marked readOnlyHint, every write taking session", async () => {
    const { tools } = (await listTools(app, PORT)) as {
      tools: {
        name: string;
        description: string;
        inputSchema: { required?: string[]; properties?: Record<string, unknown> };
        annotations: { readOnlyHint: boolean };
      }[];
    };
    expect(tools.map((tool) => [tool.name, tool.annotations.readOnlyHint])).toEqual([
      // It records a Session, so it is a write, though it never changes the Home.
      ["open_session", false],
      ["get_room_sheet", true],
      ["find_items", true],
      ["find_decisions", true],
      ["get_decision", true],
      ["search_notes", true],
      ["view_images", true],
      ["save_home", false],
      ["save_room", false],
      ["save_items", false],
      ["set_constraints", false],
      ["save_note", false],
      ["save_decision", false],
      ["set_decision_state", false],
      ["save_guides", false],
      ["record_listing", false],
      ["record_fulfilment", false],
      ["flag_conflict", false],
      ["close_session", false],
    ]);
    for (const tool of tools.filter((each) => !each.annotations.readOnlyHint)) {
      // open_session takes a Session only to join one; without it, it opens a new one.
      if (tool.name === "open_session") {
        expect(Object.keys(tool.inputSchema.properties ?? {})).toContain("session");
        continue;
      }
      expect(tool.inputSchema.required).toContain("session");
    }
    for (const tool of tools) expect(tool.description.length).toBeGreaterThan(200);
  });

  it("returns a refusal as an isError result with core's message", async () => {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });
    const result = await callTool("my-flat", "save_room", { session: "nope", name: "Kitchen" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("open_session");
  });

  it("refuses a weaker value as an isError result stating both values and their Provenance", async () => {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });
    const opened = await callTool("my-flat", "open_session", { skill: "home-intake" });
    const session = /^Session: (\S+)$/m.exec(opened.content[0]?.text ?? "")?.[1];
    const kitchen = { session, name: "Kitchen" };
    await callTool("my-flat", "save_room", {
      ...kitchen,
      ceilingHeight: { mm: 2500, provenance: "measured" },
    });

    const refused = await callTool("my-flat", "save_room", {
      ...kitchen,
      ceilingHeight: { mm: 2400, provenance: "estimated" },
    });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("~2.40 m (Estimated)");
    expect(refused.content[0]?.text).toContain("2.50 m (Measured)");
    expect(refused.content[0]?.text).toContain("overrideProvenance");
  });

  it("matches the eval mocks' _tools.json (rewrite it with pnpm --filter @idh/server tools:json)", async () => {
    const saved = JSON.parse(readFileSync(TOOLS_JSON, "utf8")) as unknown;
    expect(await listTools(app, PORT)).toEqual(saved);
  });
});

describe("Purchases", () => {
  it("saves the Guides of a Purchase over MCP, and refuses save_guides on a closed Session", async () => {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });
    const opened = await callTool("my-flat", "open_session", { skill: "purchase" });
    const session = /^Session: (\S+)$/m.exec(opened.content[0]?.text ?? "")?.[1] ?? "";
    const tool = (name: string, args: Record<string, unknown>) =>
      callTool("my-flat", name, { session, ...args });
    await tool("save_room", { name: "Living room" });
    await tool("save_decision", {
      kind: "purchase",
      room: "living-room",
      title: "Wool rug",
      statement: "A wool rug.",
      requirements: [
        { text: "Wool", strength: "must", reason: { kind: "room", id: "living-room" } },
      ],
    });

    const saved = await tool("save_guides", {
      decision: "wool-rug",
      quickLines: ["Avoid loop pile"],
      fullGuide: "## Material\n\nWool.",
    });
    expect(saved.isError).toBeUndefined();
    expect(saved.content[0]?.text).toContain("Full Guide written");
    const got = await tool("get_decision", { decision: "wool-rug" });
    expect(got.content[0]?.text).toContain("Full Guide: written");

    await tool("close_session", { summary: { changed: "A rug.", open: "Nothing", next: "None" } });
    const refused = await tool("save_guides", { decision: "wool-rug", fullGuide: "# Again" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("is closed");
  });
});

describe("Decisions", () => {
  const reason = 'The user: "yes"';

  /** A Home with a living room, and a Design Direction Session's tool caller. */
  async function setUp() {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });
    const opened = await callTool("my-flat", "open_session", { skill: "design-direction" });
    const session = /^Session: (\S+)$/m.exec(opened.content[0]?.text ?? "")?.[1] ?? "";
    const tool = (name: string, args: Record<string, unknown>) =>
      callTool("my-flat", name, { session, ...args });
    await tool("save_room", { name: "Living room" });
    return { session, tool };
  }

  const direction = {
    kind: "design-direction",
    title: "Warm minimalism",
    statement: "Calm, warm rooms.",
    content: { mood: "calm", temperature: "warm" },
  };

  it("runs the six Decision tools over MCP, refusing a state change without a reason", async () => {
    const { session, tool } = await setUp();

    const saved = await tool("save_decision", direction);
    const noReason = await tool("set_decision_state", {
      decision: "warm-minimalism",
      to: "locked",
      reason: " ",
    });
    const locked = await tool("set_decision_state", {
      decision: "warm-minimalism",
      to: "locked",
      reason,
    });
    await tool("save_decision", {
      kind: "room-use",
      room: "living-room",
      title: "Living and dining",
      statement: "One room for both.",
      content: { functions: ["living", "dining"] },
    });
    await tool("set_decision_state", { decision: "living-and-dining", to: "locked", reason });
    const fulfilled = await tool("record_fulfilment", { decision: "living-and-dining" });
    const conflict = await tool("flag_conflict", {
      decision: "warm-minimalism",
      description: "The user now loves chrome.",
    });
    const found = await tool("find_decisions", { homeWide: true });
    const detail = await tool("get_decision", { decision: "warm-minimalism" });
    const opening = await tool("open_session", { skill: "design-direction", resend: true });

    expect(saved.content[0]?.text).toContain("created as a Candidate Design Direction");
    expect(noReason.isError).toBe(true);
    expect(noReason.content[0]?.text).toContain("reason");
    expect(locked.content[0]?.text).toBe(
      "Warm minimalism (warm-minimalism): Locked, was Candidate",
    );
    expect(fulfilled.content[0]?.text).toContain("Living room (living-room): functions living");
    expect(conflict.content[0]?.text).toContain("warm-minimalism/conflict-1");
    expect(found.content[0]?.text).toContain(
      "Warm minimalism (warm-minimalism): Design Direction, Locked; Home-wide; 1 open Conflict",
    );
    expect(detail.content[0]?.text).toContain("- Mood: calm");
    expect(opening.content[0]?.text).toContain(
      "Design Direction: Warm minimalism (warm-minimalism), Locked",
    );
    expect(opening.content[0]?.text).toContain("Open flags and Conflicts:");
    expect(session).toMatch(/^design-direction-/);
  });

  it("offers the web list_decisions, get_decision, set_decision_state without a Session, and resolve_flag", async () => {
    const { tool } = await setUp();
    await tool("save_decision", direction);
    await tool("set_decision_state", { decision: "warm-minimalism", to: "locked", reason });
    await tool("save_decision", {
      kind: "room-direction",
      room: "living-room",
      title: "Calm evenings",
      statement: "Low and warm.",
      content: { direction: "Lamplight and wool." },
    });
    await tool("set_decision_state", { decision: "calm-evenings", to: "locked", reason });

    const reopen = await api("set_decision_state", {
      home: "my-flat",
      decision: "warm-minimalism",
      to: "leaning",
    });
    const reopened = (await reopen.json()) as { receipt: string; decision: { state: string } };
    const listed = (await (
      await api("list_decisions", { home: "my-flat", room: "living-room" })
    ).json()) as { decisions: { slug: string; openFlags: { slug: string }[] }[] };
    const flag = listed.decisions[0]?.openFlags[0]?.slug;
    const illegal = await api("set_decision_state", {
      home: "my-flat",
      decision: "calm-evenings",
      to: "candidate",
    });
    const kept = await api("resolve_flag", {
      home: "my-flat",
      flag,
      resolution: "keep",
      reason: "",
    });
    const detail = await api("get_decision", { home: "my-flat", decision: "calm-evenings" });
    const agentOnly = await api("save_decision", { home: "my-flat", ...direction });

    expect(reopen.status).toBe(200);
    expect(reopened.decision.state).toBe("leaning");
    expect(reopened.receipt).toContain("Flagged for review: Calm evenings (calm-evenings)");
    expect(flag).toBe("calm-evenings/flag-1");
    expect(illegal.status).toBe(409);
    expect(await illegal.json()).toEqual({
      error: { code: "illegal_transition", message: expect.stringContaining("Locked") },
    });
    expect(kept.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      decision: {
        kind: "room-direction",
        state: "locked",
        content: { direction: "Lamplight and wool." },
        basis: [{ slug: "warm-minimalism", state: "leaning", automatic: true }],
        openFlags: [],
        flags: [{ slug: "calm-evenings/flag-1", resolution: "keep" }],
      },
    });
    expect(agentOnly.status).toBe(404);
  });

  it("runs Color over MCP: a Palette, a refused color, a Room color, and its Fulfilment painting the Surface", async () => {
    const { tool } = await setUp();
    const jitney = {
      name: "Jitney",
      brand: "Farrow & Ball",
      code: "No. 293",
      hex: "#bba68a",
      provenance: "measured",
    };
    await tool("save_decision", direction);
    await tool("set_decision_state", { decision: "warm-minimalism", to: "locked", reason });
    await tool("save_decision", {
      kind: "palette",
      title: "Warm clay",
      statement: "Clay tones.",
      content: { colors: [{ ...jitney, role: "base" }] },
    });
    await tool("set_decision_state", { decision: "warm-clay", to: "locked", reason });
    const wall = { kind: "room-color", room: "living-room", statement: "Matt walls." };
    const refused = await tool("save_decision", {
      ...wall,
      title: "Blue walls",
      content: { surface: "walls", color: "Hague Blue", finish: "matt" },
    });
    await tool("save_decision", {
      ...wall,
      title: "Jitney walls",
      content: { surface: "walls", color: "Jitney", finish: "matt" },
    });
    await tool("set_decision_state", { decision: "jitney-walls", to: "locked", reason });
    const fulfilled = await tool("record_fulfilment", {
      decision: "jitney-walls",
      finish: "eggshell",
    });
    const detail = (await (
      await api("get_decision", { home: "my-flat", decision: "jitney-walls" })
    ).json()) as GetDecisionResult;
    const { room } = (await (
      await api("get_room", { home: "my-flat", room: "living-room" })
    ).json()) as GetRoomResult;
    const { decisions } = (await (
      await api("list_decisions", { home: "my-flat", kind: "palette" })
    ).json()) as ListDecisionsResult;

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain("Its colors are Jitney (base)");
    expect(fulfilled.content[0]?.text).toContain(
      "Living room walls Surface (living-room/walls): recorded; color Jitney (Farrow & Ball " +
        "No. 293) (Measured); finish eggshell",
    );
    expect(detail.decision.basis.map((entry) => [entry.slug, entry.automatic])).toEqual([
      ["warm-minimalism", true],
      ["warm-clay", true],
    ]);
    expect(detail.decision).toMatchObject({
      paletteColor: { ...jitney, role: "base" },
      fulfilment: { surface: "living-room/walls", color: jitney, finish: "eggshell" },
    });
    expect(room.surfaces).toEqual([
      { slug: "living-room/walls", part: "walls", color: jitney, finish: "eggshell" },
    ]);
    expect(decisions[0]?.colors).toEqual([{ ...jitney, role: "base" }]);
  });
});

describe("Blueprints", () => {
  const A3 = readFileSync(join(FIXTURE_FILES, "blueprint-a3.pdf"));
  const THREE_PAGES = readFileSync(join(FIXTURE_FILES, "blueprint-3-pages.pdf"));
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function pngSize(png: Uint8Array): [number, number] {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    return [view.getUint32(16), view.getUint32(20)];
  }

  function upload(fields: Record<string, string | File>, headers: Record<string, string> = {}) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    return app.request("/api/upload_blueprint", { method: "POST", body: form, headers });
  }

  const pdf = (bytes: Uint8Array, name: string) =>
    new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

  it("takes an upload as a multipart form, and serves each rendered page as a PNG", async () => {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });

    const uploaded = await upload({
      home: "my-flat",
      file: pdf(A3, "plan.pdf"),
      label: "Agent plan",
    });
    const page = await app.request(
      "/api/get_blueprint_page?home=my-flat&blueprint=agent-plan&page=1",
    );
    const listed = await api("list_blueprints", { home: "my-flat" });

    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toMatchObject({
      blueprint: {
        slug: "agent-plan",
        label: "Agent plan",
        fileName: "plan.pdf",
        pageCount: 1,
        pages: [{ page: 1, width: 2000, height: 1414, hasText: true }],
      },
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("image/png");
    const png = new Uint8Array(await page.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(png)).toEqual([2000, 1414]);
    expect(await listed.json()).toMatchObject({ blueprints: [{ slug: "agent-plan" }] });
  });

  it("answers a refused upload with 400 and a message for the user", async () => {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });
    const text = new File(["rooms: 3"], "notes.txt", { type: "text/plain" });

    const truncated = await upload({ home: "my-flat", file: pdf(A3.subarray(0, 600), "cut.pdf") });
    const unsupported = await upload({ home: "my-flat", file: text });
    const noFile = await upload({ home: "my-flat" });
    const json = await api("upload_blueprint", { home: "my-flat" });
    const evil = await upload(
      { home: "my-flat", file: pdf(A3, "plan.pdf") },
      { origin: "https://evil.example" },
    );

    expect([truncated.status, unsupported.status, noFile.status]).toEqual([400, 400, 400]);
    expect(await truncated.json()).toEqual({
      error: { code: "no_pages", message: expect.stringContaining("no pages") },
    });
    expect(await unsupported.json()).toEqual({
      error: { code: "unsupported_file", message: expect.stringContaining("PDF, PNG, or JPEG") },
    });
    expect([json.status, evil.status]).toEqual([415, 403]);
    const listed = await api("list_blueprints", { home: "my-flat" });
    expect(await listed.json()).toEqual({ blueprints: [] });
  });

  it("answers a page that does not exist with 404, and a JSON call for the PNG with 405", async () => {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });
    await upload({ home: "my-flat", file: pdf(A3, "plan.pdf"), label: "Plan" });

    const missing = await app.request("/api/get_blueprint_page?home=my-flat&blueprint=plan&page=2");
    const asJson = await api("get_blueprint_page", { home: "my-flat", blueprint: "plan", page: 1 });

    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { message: string } }).error.message).toContain(
      "has no page 2",
    );
    expect(asJson.status).toBe(405);
  });

  it("view_images returns the text block, then two image blocks, under the 25K-token cap", async () => {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });
    await upload({ home: "my-flat", file: pdf(THREE_PAGES, "plan.pdf"), label: "Plan" });
    const opened = await callTool("my-flat", "open_session", { skill: "home-intake" });
    const session = /^Session: (\S+)$/m.exec(opened.content[0]?.text ?? "")?.[1];

    const response = await mcp("my-flat", "tools/call", {
      name: "view_images",
      arguments: { session, blueprint: "plan", pages: [1, 2] },
    });
    const raw = await response.text();
    const { result } = JSON.parse(raw) as {
      result: {
        content: { type: string; text?: string; data?: string; mimeType?: string }[];
        structuredContent?: unknown;
        isError?: boolean;
      };
    };

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content.map((block) => block.type)).toEqual(["text", "image", "image"]);
    const [text, ...images] = result.content;
    expect(text?.text).toMatch(/^Blueprint: Plan \(plan\), 3 pages/);
    expect(text?.text).toContain("- Page 1:");
    expect(text?.text).toContain("- Page 2:");
    const decoded = images.map((image) => Buffer.from(image.data ?? "", "base64"));
    expect(images.map((image) => image.mimeType)).toEqual(["image/png", "image/png"]);
    expect(decoded.map(pngSize)).toEqual([
      [1414, 2000],
      [2000, 1414],
    ]);
    // Claude's image tokens are about width × height / 750 (spike 4 measured 3,904 for a
    // 2000 × 1500 page); text is at most one token per character.
    const tokens =
      decoded.map(pngSize).reduce((sum, [width, height]) => sum + (width * height) / 750, 0) +
      (text?.text?.length ?? 0);
    expect(tokens).toBeLessThan(25_000);
    // One tool result is one SSE event, which Claude Code refuses past 16 MB.
    expect(raw.length).toBeLessThan(16 * 1024 * 1024);
    for (const png of decoded) expect(png.length).toBeLessThan(1024 * 1024);
  });

  it("refuses more than 6 pages in one view_images call", async () => {
    await api("create_home", { name: "My flat", country: "GB", city: "London" });
    await upload({ home: "my-flat", file: pdf(THREE_PAGES, "plan.pdf"), label: "Plan" });
    const opened = await callTool("my-flat", "open_session", { skill: "home-intake" });
    const session = /^Session: (\S+)$/m.exec(opened.content[0]?.text ?? "")?.[1];

    const result = await callTool("my-flat", "view_images", {
      session,
      blueprint: "plan",
      pages: [1, 2, 3, 1, 2, 3, 1],
    });

    expect(result.isError).toBe(true);
  });
});

describe("DNS-rebinding protection", () => {
  it("refuses a Host that is not this machine, on every route", async () => {
    const evil = { host: `evil.example:${PORT}` };
    expect((await api("list_homes", {}, evil)).status).toBe(403);
    expect((await app.request("/events?home=x", { headers: evil })).status).toBe(403);
    expect((await mcp("any", "tools/list", {}, evil)).status).toBe(403);
  });

  it("refuses a browser Origin that is not a page on this machine", async () => {
    const origin = { origin: "https://evil.example" };
    expect((await api("list_homes", {}, origin)).status).toBe(403);
    expect((await api("list_homes", {}, { origin: "http://localhost:5173" })).status).toBe(200);
  });

  it("has the SDK check the MCP endpoint's Host down to the port", async () => {
    const response = await mcp("any", "tools/list", {}, { host: "localhost:9999" });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Invalid Host header");
  });
});
