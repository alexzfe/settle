import { describe, expect, it } from "vitest";
import { encodeTranscript, type Turn } from "./transcript.js";

const turns: Turn[] = [
  { user: "add the spare bedroom" },
  { skill: "home-intake", body: "# Home Intake\n\nBody." },
  { toolSearch: ["open_session", "save_room"] },
  { tool: "open_session", input: { skill: "home-intake" }, result: "Session: s-1" },
  { tool: "save_room", input: { session: "s-1" }, result: "Refused.", error: true },
  { assistant: "Working on Fixture Home." },
];

interface Block {
  type: string;
  id?: string;
  name?: string;
  text?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

interface Line {
  type: string;
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  isMeta?: boolean;
  message: { content: string | Block[]; stop_reason?: string };
}

function parse(text: string): Line[] {
  return text
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Line);
}

function blocks(lines: Line[], type: string): Block[] {
  return lines.flatMap((line) =>
    Array.isArray(line.message.content)
      ? line.message.content.filter((block) => block.type === type)
      : [],
  );
}

describe("encodeTranscript", () => {
  it("chains every line to the one before it, in one session", () => {
    const lines = parse(encodeTranscript("case", turns));
    expect(lines[0]?.parentUuid).toBeNull();
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]?.parentUuid).toBe(lines[i - 1]?.uuid);
    }
    expect(new Set(lines.map((line) => line.sessionId)).size).toBe(1);
    expect(new Set(lines.map((line) => line.uuid)).size).toBe(lines.length);
  });

  it("answers every tool call with a result that names it", () => {
    const lines = parse(encodeTranscript("case", turns));
    const calls = blocks(lines, "tool_use");
    const results = blocks(lines, "tool_result");
    expect(calls.map((call) => call.name)).toEqual([
      "Skill",
      "ToolSearch",
      "mcp__int-design-harness__open_session",
      "mcp__int-design-harness__save_room",
    ]);
    expect(results.map((result) => result.tool_use_id)).toEqual(calls.map((call) => call.id));
    expect(results.at(-1)?.is_error).toBe(true);
  });

  it("injects the Skill body after it launches, and ends on the assistant's reply", () => {
    const lines = parse(encodeTranscript("case", turns));
    const body = lines.find((line) => line.isMeta === true);
    expect(body && blocks([body], "text")[0]?.text).toMatch(
      /^Base directory for this skill: .*\n\n# Home/,
    );
    expect(lines.at(-1)?.message.content).toEqual([
      { type: "text", text: "Working on Fixture Home." },
    ]);
    expect(lines.at(-1)?.message.stop_reason).toBe("end_turn");
  });

  it("encodes the same conversation to the same bytes, and another name differently", () => {
    expect(encodeTranscript("case", turns)).toBe(encodeTranscript("case", turns));
    expect(encodeTranscript("other", turns)).not.toBe(encodeTranscript("case", turns));
  });
});
