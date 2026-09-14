import { join } from "node:path";
import type { Hono } from "hono";

/**
 * The eval mocks' copy of tools/list (plugin/evals/mocks/<server>/_tools.json), so the mocked
 * tools carry the real names, descriptions, and input schemas. Rewrite it with
 * `pnpm --filter @idh/server tools:json` after changing a tool.
 */
export const TOOLS_JSON = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "plugin",
  "evals",
  "mocks",
  "int-design-harness",
  "_tools.json",
);

/** The MCP endpoint's tools/list result, asked of `app` as the Agent would ask it. */
export async function listTools(app: Hono, port: number): Promise<{ tools: unknown[] }> {
  const response = await app.request("/mcp/homes/any", {
    method: "POST",
    headers: {
      host: `127.0.0.1:${port}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const body = (await response.json()) as { result?: { tools: unknown[] }; error?: unknown };
  if (!body.result) throw new Error(`tools/list failed: ${JSON.stringify(body)}`);
  return body.result;
}
