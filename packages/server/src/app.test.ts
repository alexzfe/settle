import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("createApp", () => {
  const app = createApp();

  it("answers /health", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("serves a placeholder page at /", async () => {
    const response = await app.request("/");
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(await response.text()).toContain("Interior Design Harness");
  });

  it("answers an MCP initialize request over streamable HTTP", async () => {
    const response = await app.request("/mcp/homes/any", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { serverInfo: unknown } };
    expect(body.result.serverInfo).toEqual({ name: "int-design-harness", version: "0.0.1" });
  });
});
