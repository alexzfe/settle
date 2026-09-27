// LAN mode's listener, written before it: it serves each Quick Guide by its token and refuses
// every other path with 404, so a phone on the user's network reaches nothing but those pages;
// the web app, the API, and the MCP endpoint stay on loopback.
import { mkdtempSync, rmSync } from "node:fs";
import { type NetworkInterfaceInfo, tmpdir } from "node:os";
import { join } from "node:path";
import { createFixtureHome, type FixtureHome, type GetDecisionResult } from "@settle/core";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLanApp, lanAddress } from "./lan.js";
import { type RunningServer, startServer } from "./server.js";

const LAN_URL = "http://192.168.1.20:4380";

describe("the LAN listener", () => {
  let fixture: FixtureHome;
  let lan: Hono;
  let token: string;
  beforeAll(async () => {
    fixture = await createFixtureHome({ lanUrl: LAN_URL });
    lan = createLanApp({ core: fixture.core });
    const { decision } = await fixture.core.run(
      "get_decision",
      { caller: { kind: "web" } },
      { home: fixture.home, decision: "wool-rug" },
    );
    const url = decision.guides?.phoneUrl ?? "";
    expect(url.startsWith(`${LAN_URL}/guide/`)).toBe(true);
    token = url.slice(url.lastIndexOf("/") + 1);
  });
  afterAll(() => fixture.core.close());

  /** A request as a phone on the network sends it, to the LAN address. */
  function request(method: string, path: string, body?: string) {
    return lan.request(path, {
      method,
      headers: {
        host: "192.168.1.20:4380",
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", accept: "application/json, text/event-stream" }),
      },
      ...(body === undefined ? {} : { body }),
    });
  }

  it("serves a Quick Guide by its token, as a page with no JavaScript that sends no Referer", async () => {
    const response = await request("GET", `/guide/${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const page = await response.text();
    expect(page).toContain("<h1>Wool rug</h1>");
    expect(page).toContain("Measure first");
    expect(page).not.toContain("<script");
  });

  it("refuses every other path with 404: the web app, the API, the events, the MCP endpoint, and a guide by its slug", async () => {
    const mcpCall = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const refused: [string, string, string?][] = [
      ["GET", "/"],
      ["GET", "/index.html"],
      ["GET", "/assets/index.js"],
      ["GET", "/homes/fixture-home"],
      ["GET", "/health"],
      ["POST", "/api/list_homes", "{}"],
      ["POST", "/api/get_decision", JSON.stringify({ home: "fixture-home", decision: "wool-rug" })],
      ["POST", "/api/set_decision_state", JSON.stringify({ home: "fixture-home" })],
      ["GET", "/api/export_guides?home=fixture-home&format=markdown"],
      ["GET", "/api/get_blueprint_page?home=fixture-home&blueprint=agent-plan&page=1"],
      ["GET", "/events?home=fixture-home"],
      ["POST", "/mcp/homes/fixture-home", mcpCall],
      ["GET", "/guide/wool-rug?home=fixture-home"],
      ["GET", "/guide/wool-rug"],
      ["GET", `/guide/${token}x`],
      ["GET", "/guide/"],
      ["GET", `/guide/${token}/more`],
      ["POST", `/guide/${token}`, "{}"],
      ["DELETE", `/guide/${token}`],
    ];
    for (const [method, path, body] of refused) {
      const response = await request(method, path, body);
      expect(response.status, `${method} ${path}`).toBe(404);
      const text = await response.text();
      expect(text, `${method} ${path}`).not.toContain("Wool rug");
      expect(text, `${method} ${path}`).not.toContain("Fixture Home");
    }
  });

  it("answers a wrong token as it answers any other path, so a phone learns nothing from it", async () => {
    const wrong = await request("GET", "/guide/AAAAAAAAAAAAAAAAAAAAAAAA");
    const api = await request("POST", "/api/list_homes", "{}");
    expect(await wrong.text()).toBe(await api.text());
  });
});

describe("LAN mode on real listeners", () => {
  let root: string;
  let server: RunningServer;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "settle-lan-"));
    // 127.0.0.2 stands in for the LAN address: another address of this machine, which the
    // loopback listener on 127.0.0.1 does not cover.
    server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dataDir: join(root, "data"),
      lan: { host: "127.0.0.2" },
    });
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

  async function tool(name: string, args: unknown): Promise<string> {
    const response = await fetch(`${server.url}/mcp/homes/lan-home`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
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

  it("serves each Quick Guide by its token on the LAN address and nothing else there, the loopback listener unchanged", async () => {
    const lanUrl = server.lanUrl ?? "";
    expect(lanUrl).toBe(`http://127.0.0.2:${new URL(server.url).port}`);
    await api("create_home", { name: "Lan home", country: "GB", city: "London" });
    const opening = await tool("open_session", { skill: "purchase" });
    const session = /^Session: (\S+)$/m.exec(opening)?.[1] ?? "";
    await tool("save_room", { session, name: "Living room" });
    await tool("save_decision", {
      session,
      kind: "purchase",
      room: "living-room",
      title: "Wool rug",
      statement: "A wool rug.",
      requirements: [
        { text: "Wool", strength: "must", reason: { kind: "room", id: "living-room" } },
      ],
    });
    await tool("save_guides", {
      session,
      decision: "wool-rug",
      quickLines: [{ kind: "avoid", text: "Loop pile" }],
    });

    expect(await api("get_home", { home: "lan-home" })).toMatchObject({ lanUrl });
    const { decision } = (await api("get_decision", {
      home: "lan-home",
      decision: "wool-rug",
    })) as GetDecisionResult;
    const guideUrl = decision.guides?.phoneUrl ?? "";
    expect(guideUrl.startsWith(`${lanUrl}/guide/`)).toBe(true);
    const guide = await fetch(guideUrl);
    expect(guide.status).toBe(200);
    expect(await guide.text()).toContain("Loop pile");

    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/health"],
      ["POST", "/api/list_homes"],
      ["GET", "/events?home=lan-home"],
      ["POST", "/mcp/homes/lan-home"],
      ["GET", "/guide/wool-rug?home=lan-home"],
    ] as const) {
      const response = await fetch(`${lanUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect((await fetch(`${server.url}/health`)).status).toBe(200);
    expect((await fetch(`${server.url}/guide/wool-rug?home=lan-home`)).status).toBe(200);
  });
});

describe("lanAddress", () => {
  const ipv4 = (address: string, internal = false) =>
    ({ address, family: "IPv4", internal }) as NetworkInterfaceInfo;

  it("takes the machine's address on the home network, not a container bridge or a VPN", () => {
    expect(
      lanAddress({
        lo: [ipv4("127.0.0.1", true)],
        docker0: [ipv4("172.17.0.1")],
        tailscale0: [ipv4("100.64.0.2")],
        wlp0s20f3: [
          { address: "fe80::1", family: "IPv6", internal: false } as NetworkInterfaceInfo,
          ipv4("192.168.1.11"),
        ],
      }),
    ).toBe("192.168.1.11");
  });

  it("prefers 192.168 over 10 over 172.16 to 172.31, and finds none without a private address", () => {
    expect(lanAddress({ eth0: [ipv4("10.0.0.5")], eth1: [ipv4("192.168.0.9")] })).toBe(
      "192.168.0.9",
    );
    expect(lanAddress({ eth0: [ipv4("172.20.1.2")], eth1: [ipv4("10.0.0.5")] })).toBe("10.0.0.5");
    expect(lanAddress({ eth0: [ipv4("172.20.1.2")] })).toBe("172.20.1.2");
    expect(lanAddress({ eth0: [ipv4("8.8.8.8")], lo: [ipv4("127.0.0.1", true)] })).toBeUndefined();
  });
});
