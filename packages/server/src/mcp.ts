import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/**
 * Answers one MCP request statelessly: a fresh server and transport per request, and no MCP
 * session (the Session id will be an explicit tool argument). No tools are registered yet.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const server = new McpServer({ name: "int-design-harness", version: "0.0.1" });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
