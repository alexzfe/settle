import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type AnyOperation, type Caller, type Core, CoreError } from "@settle/core";
import type { AgentActivity } from "./agent-activity.js";

/**
 * The server's instructions: the core rules the Skills teach, repeated for Claude Code in case
 * compaction drops the Skill text. claude.ai drops a server's instructions, so they are no
 * backstop there: open_session's result carries the rules instead. Kept under 512 characters.
 */
export const SERVER_INSTRUCTIONS =
  "Interior design platform for the user's Homes. Call open_session first and pass its session " +
  "id on every call. Say plainly what you changed. Before a Reopen, rejecting a Settled " +
  "Decision, reviving a Rejected one, or adding or removing a Constraint, ask the user and quote " +
  "their permission as the reason. Never re-propose a Rejected Decision. A Note alone never " +
  "changes a Decision. A refused write says what to fix.";

/** The tools the Agent calls before it has a Session, so they alone take none. */
const BEFORE_A_SESSION = new Set(["list_homes", "open_session"]);

/**
 * The operations the Agent gets as tools. Every tool but those before a Session must take the
 * Session as an argument, since the Session decides the Home: it is never an MCP session, since
 * the endpoint is stateless.
 */
export function mcpTools(core: Core): AnyOperation[] {
  const tools = core.operations.filter((operation) => operation.surface !== "web");
  for (const tool of tools) {
    if (!BEFORE_A_SESSION.has(tool.name) && !("session" in tool.input.shape)) {
      throw new Error(`The tool ${tool.name} must take a session`);
    }
  }
  return tools;
}

interface McpOptions {
  core: Core;
  tools: AnyOperation[];
  activity: AgentActivity;
  port: number;
  publicOrigin?: string;
}

/** Answers one MCP request for an Account's Connection: every Home of the Account, one per Session. */
export async function handleAccountMcpRequest(
  request: Request,
  { account, ...options }: McpOptions & { account: number },
): Promise<Response> {
  const caller: Caller = { kind: "session", account };
  return answer(request, options, caller, undefined, (session) =>
    options.core.sessionHome(account, session),
  );
}

/**
 * Answers one MCP request for a Home Folder, bound to the Home the URL names. A Session of another
 * Home is refused as unknown.
 */
export async function handleMcpRequest(
  request: Request,
  { home, ...options }: McpOptions & { home: string },
): Promise<Response> {
  return answer(request, options, { kind: "session" }, home, () => home);
}

/**
 * Answers one MCP request statelessly: a fresh server and transport per request. The SDK's
 * DNS-rebinding protection accepts only this machine's names and, when hosted, the public origin's.
 * `homeOf` names the Home a call's Session works on, for the activity signal.
 */
async function answer(
  request: Request,
  { core, tools, activity, port, publicOrigin }: McpOptions,
  caller: Caller,
  home: string | undefined,
  homeOf: (session: string) => string | undefined,
): Promise<Response> {
  if (request.method !== "POST") {
    // Stateless: there is no standalone SSE stream to open and no MCP session to delete.
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  const server = buildServer(core, tools, caller, home, (session, tool) => {
    const called = session === undefined ? home : homeOf(session);
    if (called !== undefined) activity.record(called, tool);
    return called !== undefined;
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      ...(publicOrigin ? [new URL(publicOrigin).host] : []),
    ],
    allowedOrigins: [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      ...(publicOrigin ? [publicOrigin] : []),
    ],
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

function buildServer(
  core: Core,
  tools: AnyOperation[],
  caller: Caller,
  home: string | undefined,
  /** Notes the call for its Session's Home, when that is known; says whether it was. */
  record: (session: string | undefined, tool: string) => boolean,
): McpServer {
  const server = new McpServer(
    { name: "settle", version: "0.0.1" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  /** One tool call: core validates the arguments, so a refusal of them is worded as core's are. */
  const call = async (tool: AnyOperation, args: unknown): Promise<CallToolResult> => {
    // A valid call counts before it runs, so its agent event comes before its change events; one
    // whose input core will refuse counts not at all, as when the SDK refused it.
    const named = (args as { session?: unknown } | undefined)?.session;
    const recorded =
      tool.input.safeParse(args).success &&
      record(typeof named === "string" ? named : undefined, tool.name);
    try {
      // Core reads the Session from the tool's `session` argument, and from it the Home.
      const output = await core.run(tool.name, { caller, ...(home ? { home } : {}) }, args);
      // Through a Connection, a new Session's Home is known once open_session returns.
      const opened = (output as { session?: unknown } | undefined)?.session;
      if (!recorded && typeof opened === "string") record(opened, tool.name);
      const text = tool.text ? tool.text(output) : JSON.stringify(output);
      // The text block first, naming what the images show; never structuredContent, which
      // makes Codex drop the images.
      const images = (tool.images?.(output) ?? []).map(({ data, mimeType }) => ({
        type: "image" as const,
        data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64"),
        mimeType,
      }));
      return { content: [{ type: "text" as const, text }, ...images] };
    } catch (error) {
      if (!(error instanceof CoreError)) throw error;
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  };
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: titleOf(tool.name),
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.readOnly, openWorldHint: tool.openWorld === true },
      },
      // Never called: the tools/call handler below replaces the SDK's, which would have called it.
      () => {
        throw new Error(`${tool.name} is answered by Settle's tools/call handler`);
      },
    );
  }
  // The SDK lists the tools from their schemas, but its own tools/call would refuse an input its
  // schema rejects with bare Zod paths and nothing about what to do. This one hands the raw
  // arguments to core, whose refusal says what to fix (ADR 0004). It must come after the
  // registerTool calls above, which install the SDK's handler it replaces; "refusals of a tool's
  // input come from Core" in mcp.test.ts fails if an SDK upgrade changes that.
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((each) => each.name === request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `There is no tool "${request.params.name}". tools/list names the tools there are.`,
          },
        ],
      };
    }
    return call(tool, request.params.arguments ?? {});
  });
  return server;
}

/** "open_session" → "Open session". */
function titleOf(name: string): string {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
