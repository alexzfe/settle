import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CoreError } from "../errors.js";
import { defineOperation } from "../registry.js";
import { requireHome, requireSession, sessionInput } from "./scope.js";
import { SKILLS, type Skill } from "./sessions.js";

/**
 * The built Skills, plugin/skills/<name>/SKILL.md, as the Skills build writes them. The Agent
 * without them as native Skills (claude.ai, through a Connection) reads them through the
 * tools: the Session protocol in open_session's result, then each Skill's own text through read_skill. The
 * Docker image carries the folder at the same place, so the server reads what the plugin ships.
 */
export const SKILLS_DIR = join(import.meta.dirname, "..", "..", "..", "..", "plugin", "skills");

/** The heading the Skills build puts the shared protocol under (packages/skills/src/render.ts). */
const PROTOCOL_HEADING = "## Session protocol";

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n+/;

export interface SkillText {
  name: Skill;
  /** The Skill's trigger line: its frontmatter's `description`. */
  trigger: string;
  /** The Skill's own text, without its frontmatter and the Session protocol. */
  body: string;
}

export interface SkillTexts {
  /** The Session protocol every Skill shares, without its heading. */
  protocol: string;
  skills: SkillText[];
}

/** Reads every Skill's built SKILL.md from `dir`. */
export function readSkillTexts(dir: string = SKILLS_DIR): SkillTexts {
  let protocol: string | undefined;
  const skills = SKILLS.map((name): SkillText => {
    const file = join(dir, name, "SKILL.md");
    if (!existsSync(file)) {
      throw new Error(`No built Skill at ${file}: run pnpm plugin:build, or copy plugin/skills`);
    }
    const text = readFileSync(file, "utf8");
    const match = FRONTMATTER.exec(text);
    const at = text.indexOf(`\n${PROTOCOL_HEADING}\n`);
    if (!match?.[1] || at < 0) throw new Error(`${file} is not a built Skill`);
    protocol ??= text.slice(at + PROTOCOL_HEADING.length + 2).trim();
    return {
      name,
      trigger: frontmatterDescription(match[1], file),
      body: text.slice(match[0].length, at).trim(),
    };
  });
  return { protocol: protocol ?? "", skills };
}

/**
 * The `description` line of a built Skill's frontmatter. The Skills build allows only a plain
 * one-line scalar or a double-quoted one, whose escapes JSON reads the same way.
 */
function frontmatterDescription(yaml: string, file: string): string {
  const line = /^description: (.+)$/m.exec(yaml)?.[1];
  if (line === undefined) throw new Error(`${file} has no description`);
  return line.startsWith('"') ? (JSON.parse(line) as string) : line;
}

export interface ReadSkillResult {
  name: Skill;
  body: string;
}

export const readSkill = defineOperation({
  name: "read_skill",
  description:
    "Returns one Skill in full: how Settle does one kind of work (home-intake, design-direction, " +
    "color, purchase), the same text as the native Skill of that name. open_session lists the " +
    "Skills with when each applies. Read a Skill before its work starts and follow it; skip one " +
    "already loaded in this conversation. Changes nothing.",
  input: z.object({
    session: sessionInput,
    name: z.enum(SKILLS).describe("The Skill's name, as open_session lists it."),
  }),
  readOnly: true,
  surface: "agent",
  handler(context, input): ReadSkillResult {
    requireSession(context, requireHome(context), { open: false });
    const skill = context.skillTexts().skills.find((each) => each.name === input.name);
    if (!skill) throw new CoreError("not_found", `There is no Skill "${input.name}".`);
    return { name: skill.name, body: skill.body };
  },
  text: ({ name, body }) =>
    [
      `Skill: ${name}. Follow it for this work, together with the Session protocol open_session ` +
        `gave you. When the Session already has skill "${name}", skip the step that opens it.`,
      "",
      body,
    ].join("\n"),
});
