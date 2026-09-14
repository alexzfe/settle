import type { Core } from "@idh/core";
import { Hono, type MiddlewareHandler } from "hono";
import { handleApi, handleBlueprintPage, handleUpload } from "./api.js";
import { streamChanges } from "./events.js";
import { handleMcpRequest, mcpTools } from "./mcp.js";
import { serveWeb } from "./web.js";

export interface AppOptions {
  core: Core;
  /** The port the server listens on: the MCP endpoint accepts only Host headers naming it. */
  port: number;
  /** The built web UI; without one, `/` is a placeholder page. */
  webDist?: string;
}

export function createApp({ core, port, webDist }: AppOptions): Hono {
  const tools = mcpTools(core);
  const app = new Hono();
  app.use("*", localOnly);
  app.get("/health", (c) => c.json({ status: "ok" }));
  // Blueprints: a multipart upload in, and each rendered page out as a PNG.
  app.post("/api/upload_blueprint", (c) => handleUpload(core, c));
  app.get("/api/get_blueprint_page", (c) => handleBlueprintPage(core, c));
  app.post("/api/:operation", (c) => handleApi(core, c));
  app.get("/events", (c) => streamChanges(core, c));
  app.all("/mcp/homes/:home", (c) =>
    handleMcpRequest(c.req.raw, { core, tools, home: c.req.param("home"), port }),
  );
  serveWeb(app, webDist);
  return app;
}

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

/**
 * DNS-rebinding and cross-site protection for every route, since any web page can reach a
 * localhost server: the Host must name this machine, and a browser's Origin, when sent, must be
 * a page on this machine too (the Vite dev server included).
 */
const localOnly: MiddlewareHandler = async (c, next) => {
  const host = c.req.header("host") ?? new URL(c.req.url).host;
  const origin = c.req.header("origin");
  if (!isLocal(`http://${host}`) || (origin !== undefined && !isLocal(origin))) {
    const message = "Only pages and tools on this computer may use this server.";
    return c.json({ error: { code: "forbidden", message } }, 403);
  }
  await next();
};

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
