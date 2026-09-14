import { parse } from "yaml";
import { z } from "zod";

/** The heading the shared protocol is inlined under, at the end of every built SKILL.md. */
export const PROTOCOL_HEADING = "## Session protocol";

// Spec-only frontmatter: nothing an Agent other than Claude Code would not understand.
const Frontmatter = z.strictObject({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be kebab-case"),
  description: z.string().min(1).max(1024),
});

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

/**
 * Turns one Skill source into its built SKILL.md: the source's frontmatter and body, then the
 * shared protocol under PROTOCOL_HEADING. `dir` is the Skill's folder name, which `name` must match.
 */
export function renderSkill(dir: string, source: string, protocol: string): string {
  const match = FRONTMATTER.exec(source);
  const yaml = match?.[1];
  if (match === null || yaml === undefined) {
    throw new Error(`${dir}/SKILL.md: must start with --- frontmatter ---`);
  }

  const frontmatter = Frontmatter.safeParse(parse(yaml));
  if (!frontmatter.success) {
    throw new Error(`${dir}/SKILL.md frontmatter:\n${z.prettifyError(frontmatter.error)}`);
  }
  if (frontmatter.data.name !== dir) {
    throw new Error(`${dir}/SKILL.md: name "${frontmatter.data.name}" must match its folder`);
  }

  const body = source.slice(match[0].length).trim();
  if (body.includes(PROTOCOL_HEADING)) {
    throw new Error(`${dir}/SKILL.md: "${PROTOCOL_HEADING}" is added by the build`);
  }

  return `---\n${yaml}\n---\n\n${body}\n\n${PROTOCOL_HEADING}\n\n${protocol.trim()}\n`;
}
