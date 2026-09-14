// Encodes a scripted conversation as a Claude Code session transcript (.jsonl): the format
// `claude plugin eval` resumes from a replay case's context.history_file, as spike 2 found
// (docs/research/spikes/2-eval-harness.md). The line shapes copy a real Home Folder transcript.
import { createHash } from "node:crypto";

/** The MCP server key every Home Folder's .mcp.json uses, and so the mock directory's name. */
export const SERVER = "int-design-harness";
export const PLUGIN = "int-design-harness";

/** One step of a scripted conversation. */
export type Turn =
  /** The user types a message. */
  | { user: string }
  /** The assistant loads a Skill; `body` is the SKILL.md text Claude Code injects. */
  | { skill: string; body: string }
  /** The assistant loads the definitions of deferred MCP tools, by bare tool name. */
  | { toolSearch: readonly string[] }
  /** The assistant calls one of the server's tools, by bare name, and gets `result` back. */
  | { tool: string; input: Record<string, unknown>; result: string; error?: boolean }
  /** The assistant replies in text, ending its turn. */
  | { assistant: string };

const VERSION = "2.1.269";
const MODEL = "claude-sonnet-5";
const CWD = "/home/user/Homes/fixture-home";
const START = Date.parse("2026-09-14T10:00:00.000Z");

/**
 * The transcript of `turns`, one JSON object per line. Ids and timestamps derive from `name`,
 * so the same conversation always encodes to the same bytes.
 */
export function encodeTranscript(name: string, turns: readonly Turn[]): string {
  let counter = 0;
  const hex = (length: number) =>
    createHash("sha256").update(`${name}:${counter++}`).digest("hex").slice(0, length);
  const uuid = () => {
    const h = hex(32);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
  };
  const sessionId = uuid();

  const lines: Record<string, unknown>[] = [];
  let parentUuid: string | null = null;
  const push = (type: "user" | "assistant", fields: Record<string, unknown>) => {
    const id = uuid();
    lines.push({
      parentUuid,
      isSidechain: false,
      type,
      ...fields,
      uuid: id,
      timestamp: new Date(START + lines.length * 2000).toISOString(),
      userType: "external",
      entrypoint: "cli",
      cwd: CWD,
      sessionId,
      version: VERSION,
      gitBranch: "HEAD",
    });
    parentUuid = id;
    return id;
  };
  const assistant = (content: unknown[], stop: "tool_use" | "end_turn") =>
    push("assistant", {
      message: {
        model: MODEL,
        id: `msg_${hex(24)}`,
        type: "message",
        role: "assistant",
        content,
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      requestId: `req_${hex(24)}`,
    });
  const callTool = (name: string, input: unknown) => {
    const id = `toolu_${hex(24)}`;
    const source = assistant([{ type: "tool_use", id, name, input }], "tool_use");
    return { id, source };
  };
  const toolResult = (
    call: { id: string; source: string },
    content: unknown,
    toolUseResult: unknown,
    error = false,
  ) =>
    push("user", {
      message: {
        role: "user",
        content: [
          {
            tool_use_id: call.id,
            type: "tool_result",
            content,
            ...(error ? { is_error: true } : {}),
          },
        ],
      },
      toolUseResult,
      sourceToolAssistantUUID: call.source,
    });

  for (const turn of turns) {
    if ("user" in turn) {
      push("user", { message: { role: "user", content: turn.user } });
    } else if ("skill" in turn) {
      const command = `${PLUGIN}:${turn.skill}`;
      const call = callTool("Skill", { skill: command });
      toolResult(call, `Launching skill: ${command}`, { success: true, commandName: command });
      push("user", {
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: `Base directory for this skill: /plugin/skills/${turn.skill}\n\n${turn.body}`,
            },
          ],
        },
        isMeta: true,
        sourceToolUseID: call.id,
      });
    } else if ("toolSearch" in turn) {
      const names = turn.toolSearch.map(mcpName);
      const query = `select:${names.join(",")}`;
      const call = callTool("ToolSearch", { query, max_results: names.length });
      toolResult(
        call,
        names.map((tool_name) => ({ type: "tool_reference", tool_name })),
        { matches: names, query, total_deferred_tools: names.length },
      );
    } else if ("tool" in turn) {
      const call = callTool(mcpName(turn.tool), turn.input);
      const text = [{ type: "text", text: turn.result }];
      toolResult(call, text, turn.error ? `Error: ${turn.result}` : text, turn.error);
    } else {
      assistant([{ type: "text", text: turn.assistant }], "end_turn");
    }
  }
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

/** A tool's name as the Agent sees it when the Home Folder's .mcp.json declares the server. */
export function mcpName(tool: string): string {
  return `mcp__${SERVER}__${tool}`;
}
