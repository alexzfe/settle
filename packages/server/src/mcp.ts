import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type AnyOperation, type Core, CoreError } from "@settle/core";
import type { AgentActivity } from "./agent-activity.js";

/**
 * The server's instructions: the core rules the Skills teach, repeated as a backstop in case
 * compaction drops the Skill text. Kept under 512 characters.
 */
export const SERVER_INSTRUCTIONS =
  "Interior design platform for one Home. Call open_session first and pass its session id on " +
  "every write. Say plainly what you changed. Before a Reopen, rejecting a Settled Decision, " +
  "reviving a Rejected one, or adding or removing a Constraint, ask the user and quote their " +
  "permission as the reason. Never re-propose a Rejected Decision. A Note alone never changes a " +
  "Decision. A refused write says what to fix.";

/**
 * The operations the Agent gets as tools. Every write must take the Session as an argument: the
 * Session is never an MCP session, since the endpoint is stateless.
 */
export function mcpTools(core: Core): AnyOperation[] {
  const tools = core.operations.filter((operation) => operation.surface !== "web");
  for (const tool of tools) {
    if (!tool.readOnly && !("session" in tool.input.shape)) {
      throw new Error(`The tool ${tool.name} writes, so its input must take a session`);
    }
  }
  return tools;
}

/**
 * Answers one MCP request statelessly: a fresh server and transport per request, bound to the
 * Home the URL names. The SDK's DNS-rebinding protection accepts only this machine's names and,
 * when hosted, the public origin's.
 */
export async function handleMcpRequest(
  request: Request,
  {
    core,
    tools,
    home,
    activity,
    port,
    publicOrigin,
  }: {
    core: Core;
    tools: AnyOperation[];
    home: string;
    activity: AgentActivity;
    port: number;
    publicOrigin?: string;
  },
): Promise<Response> {
  if (request.method !== "POST") {
    // Stateless: there is no standalone SSE stream to open and no MCP session to delete.
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  const server = buildServer(core, tools, home, activity);
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
  home: string,
  activity: AgentActivity,
): McpServer {
  const server = new McpServer(
    { name: "settle", version: "0.0.1" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: titleOf(tool.name),
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.readOnly, openWorldHint: false },
      },
      async (args) => {
        // The SDK calls this only once the tool is found and its input is valid.
        activity.record(home, tool.name);
        try {
          // Core reads the Session from the tool's `session` argument.
          const output = await core.run(tool.name, { caller: { kind: "session" }, home }, args);
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
      },
    );
  }
  return server;
}

/** "open_session" → "Open session". */
function titleOf(name: string): string {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
