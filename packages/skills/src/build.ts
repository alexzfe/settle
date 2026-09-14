// Builds plugin/skills/<name>/SKILL.md from packages/skills/<name>/SKILL.md and protocol.md.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderSkill } from "./render.js";

const sourceDir = join(import.meta.dirname, "..");
const repoRoot = join(sourceDir, "..", "..");
const outDir = join(repoRoot, "plugin", "skills");

const protocol = readFileSync(join(sourceDir, "protocol.md"), "utf8");
const skills = readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(sourceDir, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

// Render everything before touching the output, so a bad source leaves plugin/skills as it was.
const built = skills.map((name) => ({
  name,
  text: renderSkill(name, readFileSync(join(sourceDir, name, "SKILL.md"), "utf8"), protocol),
}));

rmSync(outDir, { recursive: true, force: true });
for (const { name, text } of built) {
  const file = join(outDir, name, "SKILL.md");
  mkdirSync(join(outDir, name), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${relative(repoRoot, file)}`);
}
