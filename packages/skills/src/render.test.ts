import { describe, expect, it } from "vitest";
import { PROTOCOL_HEADING, renderSkill } from "./render.js";

const source =
  "---\nname: home-intake\ndescription: Records the Home.\n---\n\n# Home Intake\n\nBody.\n";

describe("renderSkill", () => {
  it("keeps the frontmatter and body and inlines the protocol under its heading", () => {
    expect(renderSkill("home-intake", source, "Protocol text.\n")).toBe(
      "---\nname: home-intake\ndescription: Records the Home.\n---\n\n" +
        `# Home Intake\n\nBody.\n\n${PROTOCOL_HEADING}\n\nProtocol text.\n`,
    );
  });

  it("refuses a name that does not match the folder", () => {
    expect(() => renderSkill("color", source, "")).toThrow(/must match its folder/);
  });

  it("refuses frontmatter fields outside the spec", () => {
    const extra = source.replace("---\n\n", "allowed-tools: Read\n---\n\n");
    expect(() => renderSkill("home-intake", extra, "")).toThrow(/allowed-tools/);
  });
});
