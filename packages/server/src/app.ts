import type { Core } from "@settle/core";
import { Hono, type MiddlewareHandler } from "hono";
import { AgentActivity } from "./agent-activity.js";
import {
  handleApi,
  handleBlueprintPage,
  handleHomeFolderScript,
  handleListingPhoto,
  handleListingPhotoUpload,
  handleUpload,
} from "./api.js";
import { streamChanges } from "./events.js";
import { handleMcpRequest, mcpTools } from "./mcp.js";
import { handleExport, handleGuidePage } from "./pages.js";
import { serveWeb } from "./web.js";

export interface AppOptions {
  core: Core;
  /** The port the server listens on: the MCP endpoint accepts only Host headers naming it. */
  port: number;
  /** The built web UI; without one, `/` is a placeholder page. */
  webDist?: string;
  /** When hosted: the origin the app is reached at, which the front door accepts too. */
  publicOrigin?: string;
}

export function createApp({ core, port, webDist, publicOrigin }: AppOptions): Hono {
  const tools = mcpTools(core);
  // The Agent's last tool call per Home, which /events passes on. The web's /api calls don't count.
  const activity = new AgentActivity();
  const app = new Hono();
  app.use("*", frontDoor(publicOrigin));
  app.get("/health", (c) => c.json({ status: "ok" }));
  // Blueprints: a multipart upload in, and each rendered page out as a PNG.
  app.post("/api/upload_blueprint", (c) => handleUpload(core, c));
  app.get("/api/get_blueprint_page", (c) => handleBlueprintPage(core, c));
  // A Listing's picture: pasted or fetched in through a multipart form, served back as its bytes.
  app.post("/api/set_listing_photo", (c) => handleListingPhotoUpload(core, c));
  app.get("/api/get_listing_photo", (c) => handleListingPhoto(core, c));
  // The exports as files, for a link to open; POST gives the same as JSON.
  app.get("/api/export_shopping_list", (c) => handleExport(core, c, "export_shopping_list"));
  app.get("/api/export_guides", (c) => handleExport(core, c, "export_guides"));
  // The Home Folder command fetches this and pipes it into sh, inside the folder.
  app.get("/api/home_folder_script", (c) => handleHomeFolderScript(core, c));
  app.post("/api/:operation", (c) => handleApi(core, c));
  // The Quick Guide's phone page. In LAN mode the LAN listener serves it by token (lan.ts).
  app.get("/guide/:slug", (c) => handleGuidePage(core, c));
  app.get("/events", (c) => streamChanges(core, activity, c));
  app.all("/mcp/homes/:home", (c) =>
    handleMcpRequest(c.req.raw, {
      core,
      tools,
      home: c.req.param("home"),
      activity,
      port,
      ...(publicOrigin ? { publicOrigin } : {}),
    }),
  );
  serveWeb(app, webDist);
  return app;
}

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

/**
 * DNS-rebinding and cross-site protection for every route, since any web page can reach a
 * localhost server: the Host must name this machine or the public origin's host, and a browser's
 * Origin, when sent, must be a page on this machine (the Vite dev server included) or exactly
 * the public origin.
 */
function frontDoor(publicOrigin: string | undefined): MiddlewareHandler {
  const publicHost = publicOrigin && new URL(publicOrigin).host;
  const message = publicOrigin
    ? `Only pages and tools at ${publicOrigin} or on this computer may use this server.`
    : "Only pages and tools on this computer may use this server.";
  return async (c, next) => {
    const host = (c.req.header("host") ?? new URL(c.req.url).host).toLowerCase();
    const origin = c.req.header("origin");
    const hostAllowed = host === publicHost || isLocal(`http://${host}`);
    const originAllowed = origin === undefined || origin === publicOrigin || isLocal(origin);
    if (!hostAllowed || !originAllowed) {
      return c.json({ error: { code: "forbidden", message } }, 403);
    }
    await next();
  };
}

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
