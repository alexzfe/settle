import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { homeFolderFiles, homeFolderScript } from "./home-folder.js";

const ORIGIN = "https://settle.example.com";

const dirs: string[] = [];
const tempFolder = () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-home-folder-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the script as `curl … | sh` does: the script is sh's stdin, in the folder. */
function runScript(folder: string, home: string) {
  const run = spawnSync("sh", [], {
    cwd: folder,
    input: homeFolderScript(ORIGIN, home),
    encoding: "utf8",
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

const read = (folder: string, path: string) => readFileSync(join(folder, path), "utf8");
const expected = (home: string, path: string) =>
  homeFolderFiles(ORIGIN, home).find((file) => file.path === path)?.content;

describe("the Home Folder script", () => {
  it("writes both files into a fresh folder and says what to do next", () => {
    const folder = tempFolder();

    const run = runScript(folder, "my-flat");

    expect(run.status).toBe(0);
    expect(read(folder, ".mcp.json")).toBe(expected("my-flat", ".mcp.json"));
    expect(JSON.parse(read(folder, ".mcp.json"))).toEqual({
      mcpServers: { settle: { type: "http", url: `${ORIGIN}/mcp/homes/my-flat` } },
    });
    expect(read(folder, ".claude/settings.json")).toBe(
      expected("my-flat", ".claude/settings.json"),
    );
    expect(run.stdout).toContain("Wrote .mcp.json .claude/settings.json.");
    expect(run.stdout).toContain(
      "claude plugin marketplace add alexzfe/settle && claude plugin install settle@settle",
    );
    expect(run.stdout.trimEnd().endsWith("Run `claude` here.")).toBe(true);
    expect(existsSync(join(folder, ".mcp.json.before-settle"))).toBe(false);
  });

  it("can run again, changing nothing and keeping no copies", () => {
    const folder = tempFolder();
    runScript(folder, "my-flat");

    const again = runScript(folder, "my-flat");

    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Already up to date: .mcp.json .claude/settings.json.");
    expect(existsSync(join(folder, ".mcp.json.before-settle"))).toBe(false);
    expect(existsSync(join(folder, ".claude/settings.json.before-settle"))).toBe(false);
  });

  it("refuses a folder bound to another Home, and leaves it as it was", () => {
    const folder = tempFolder();
    runScript(folder, "holiday-cottage");
    const before = read(folder, ".mcp.json");

    const run = runScript(folder, "my-flat");

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('another Home, "holiday-cottage"');
    expect(run.stderr).toContain("~/Homes/my-flat");
    expect(read(folder, ".mcp.json")).toBe(before);
    expect(existsSync(join(folder, ".mcp.json.before-settle"))).toBe(false);
  });

  it("keeps a differing file as <file>.before-settle, and never touches settings.local.json", () => {
    const folder = tempFolder();
    const mcp = `{ "mcpServers": { "other": { "type": "stdio", "command": "other" } } }\n`;
    writeFileSync(join(folder, ".mcp.json"), mcp);
    mkdirSync(join(folder, ".claude"));
    const local = `{ "enabledMcpjsonServers": ["settle"] }\n`;
    writeFileSync(join(folder, ".claude", "settings.local.json"), local);

    const run = runScript(folder, "my-flat");

    expect(run.status).toBe(0);
    expect(read(folder, ".mcp.json.before-settle")).toBe(mcp);
    expect(read(folder, ".mcp.json")).toBe(expected("my-flat", ".mcp.json"));
    expect(run.stdout).toContain("Kept the files that were there as .mcp.json.before-settle.");
    expect(read(folder, ".claude/settings.local.json")).toBe(local);
    expect(existsSync(join(folder, ".claude/settings.json.before-settle"))).toBe(false);
  });
});
