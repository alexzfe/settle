import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startServer } from "./server.js";

it("creates the data dir and database, listens, and answers /health", async () => {
  const root = mkdtempSync(join(tmpdir(), "idh-server-"));
  const dataDir = join(root, "data");
  const server = await startServer({ port: 0, dataDir });
  try {
    const response = await fetch(`${server.url}/health`);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(existsSync(join(dataDir, "harness.sqlite"))).toBe(true);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
