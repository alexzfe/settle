// Saves the MCP tools/list result as the eval mocks' _tools.json. Run after changing a tool:
//   pnpm --filter @settle/server tools:json
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createCore } from "@settle/core";
import { createApp } from "../src/app.js";
import { listTools, TOOLS_JSON } from "../src/tools-list.js";

const core = createCore();
try {
  const tools = await listTools(createApp({ core, port: 4380 }), 4380);
  writeFileSync(TOOLS_JSON, `${JSON.stringify(tools, null, 2)}\n`);
  // In Biome's layout, so pnpm lint stays clean.
  execFileSync("pnpm", ["exec", "biome", "format", "--write", TOOLS_JSON], { stdio: "inherit" });
  console.log(`Wrote ${tools.tools.length} tools to ${TOOLS_JSON}`);
} finally {
  core.close();
}
