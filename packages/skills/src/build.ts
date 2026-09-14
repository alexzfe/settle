// Builds plugin/skills/<name>/SKILL.md from packages/skills/<name>/SKILL.md and protocol.md, and
// the replay evals' plugin/evals/<case>/history.jsonl from src/eval-histories.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { HISTORIES } from "./eval-histories.js";
import { renderSkill } from "./render.js";
import { encodeTranscript, SERVER } from "./transcript.js";

const sourceDir = join(import.meta.dirname, "..");
const repoRoot = join(sourceDir, "..", "..");
const outDir = join(repoRoot, "plugin", "skills");
const evalsDir = join(repoRoot, "plugin", "evals");

const protocol = readFileSync(join(sourceDir, "protocol.md"), "utf8");
const skills = readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(sourceDir, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

// Render everything before touching the output, so a bad source leaves plugin/ as it was.
const built = skills.map((name) => ({
  name,
  text: renderSkill(name, readFileSync(join(sourceDir, name, "SKILL.md"), "utf8"), protocol),
}));

const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/;
const skillBody = (name: string) => {
  const skill = built.find((each) => each.name === name);
  if (!skill) throw new Error(`eval-histories.ts: no Skill "${name}"`);
  return skill.text.replace(FRONTMATTER, "");
};

const histories = Object.entries(HISTORIES).map(([name, history]) => {
  const caseDir = join(evalsDir, name);
  if (!existsSync(caseDir)) throw new Error(`eval-histories.ts: no eval case ${name}`);
  const answer = (tool: string, input: Record<string, unknown>) =>
    mockAnswer([join(caseDir, "mocks"), join(evalsDir, "mocks")], tool, input);
  const turns = history({ skill: skillBody, answer });
  return { file: join(caseDir, "history.jsonl"), text: encodeTranscript(name, turns) };
});

rmSync(outDir, { recursive: true, force: true });
for (const { name, text } of built) {
  const file = join(outDir, name, "SKILL.md");
  mkdirSync(join(outDir, name), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${relative(repoRoot, file)}`);
}
for (const { file, text } of histories) {
  writeFileSync(file, text);
  console.log(`wrote ${relative(repoRoot, file)}`);
}

/**
 * What a `fixed` mock answers: the body of the first <dir>/<server>/<tool>.md found, with
 * {{file:<path>}} (relative to the mock, itself taking {input.<field>}) and {{input.<field>}}
 * filled in, as `claude plugin eval` does.
 */
function mockAnswer(dirs: string[], tool: string, input: Record<string, unknown>): string {
  const file = dirs.map((dir) => join(dir, SERVER, `${tool}.md`)).find(existsSync);
  if (!file) throw new Error(`eval-histories.ts: no mock for ${tool}`);
  const field = (path: string) => {
    const value = path
      .split(".")
      .reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], input);
    if (value === undefined) throw new Error(`${relative(repoRoot, file)}: no input.${path}`);
    return String(value);
  };
  const body = readFileSync(file, "utf8").replace(FRONTMATTER, "").trimEnd();
  return body
    .replace(/\{\{file:([^}]*(?:\{input\.[\w.]+\}[^}]*)*)\}\}/g, (_, path: string) => {
      const fixture = join(
        file,
        "..",
        path.replace(/\{input\.([\w.]+)\}/g, (_, p) => field(p)),
      );
      return readFileSync(fixture, "utf8").trimEnd();
    })
    .replace(/\{\{input\.([\w.]+)\}\}/g, (_, path: string) => field(path));
}
