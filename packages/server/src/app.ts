import { type Core, CoreError } from "@settle/core";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AgentActivity } from "./agent-activity.js";
import {
  handleAccountExport,
  handleApi,
  handleBlueprintPage,
  handleDocument,
  handleDocumentUpload,
  handleHomeFolderScript,
  handleListingPhoto,
  handleListingPhotoUpload,
  handlePhoto,
  handlePhotoUpload,
  handleUpload,
  JSON_CAP,
  UPLOAD_CAPS,
  uploadGuard,
} from "./api.js";
import { type AuthOptions, useAuth } from "./auth.js";
import { callerOf } from "./caller.js";
import { streamChanges } from "./events.js";
import { handleGuideByToken } from "./lan.js";
import { UploadLimiter } from "./limits.js";
import { handleAccountMcpRequest, handleMcpRequest, mcpTools } from "./mcp.js";
import { connectionOf } from "./oauth.js";
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
  /** The login's options (auth.ts): where the client IP comes from, and the failure limits. */
  auth?: AuthOptions;
  /** The upload limits per Account; a test gives its own. */
  uploads?: UploadLimiter;
}

/** The most an MCP request may send: the Agent's longest writes are a few pages of Markdown. */
const MCP_CAP = 4 * 1024 * 1024;

export function createApp({
  core,
  port,
  webDist,
  publicOrigin,
  auth,
  uploads = new UploadLimiter(),
}: AppOptions): Hono {
  const tools = mcpTools(core);
  // The Agent's last tool call per Home, which /events passes on. The web's /api calls don't count.
  const activity = new AgentActivity();
  const app = new Hono();
  app.use("*", frontDoor(publicOrigin));
  // The login, with the OAuth server Claude connects through (oauth.ts).
  useAuth(app, { core, ...(auth ? { auth } : {}), ...(publicOrigin ? { publicOrigin } : {}) });
  app.get("/health", (c) => c.json({ status: "ok" }));
  // Every upload: its cap before the body is read, then the Account's upload limits.
  for (const [path, cap] of Object.entries(UPLOAD_CAPS)) app.post(path, uploadGuard(cap, uploads));
  // Blueprints: a multipart upload in, and each rendered page out as a PNG.
  app.post("/api/upload_blueprint", (c) => handleUpload(core, c));
  app.get("/api/get_blueprint_page", (c) => handleBlueprintPage(core, c));
  // A Listing's picture: pasted or fetched in through a multipart form, served back as its bytes.
  app.post("/api/set_listing_photo", (c) => handleListingPhotoUpload(core, c));
  app.get("/api/get_listing_photo", (c) => handleListingPhoto(core, c));
  // An Item's Photos: the photo and its thumbnail in through a multipart form, each served back.
  app.post("/api/add_photo", (c) => handlePhotoUpload(core, c));
  app.get("/api/get_photo", (c) => handlePhoto(core, c));
  // An Item's Documents: a PDF or an image in through a multipart form, served back inline.
  app.post("/api/add_document", (c) => handleDocumentUpload(core, c));
  app.get("/api/get_document", (c) => handleDocument(core, c));
  // The exports as files, for a link to open; POST gives the same as JSON.
  app.get("/api/export_shopping_list", (c) => handleExport(core, c, "export_shopping_list"));
  app.get("/api/export_guides", (c) => handleExport(core, c, "export_guides"));
  // The Home Folder command fetches this and pipes it into sh, inside the folder.
  app.get("/api/home_folder_script", (c) => handleHomeFolderScript(core, c));
  // Everything in the Account's Homes, as one .zip.
  app.get("/api/export_account", (c) => handleAccountExport(core, c));
  app.post("/api/:operation", bodyLimit({ maxSize: JSON_CAP, onError: tooBig }), (c) =>
    handleApi(core, c),
  );
  // The Quick Guide's phone page: by its token, which needs no login, or by its slug with
  // ?home=, for the web UI. In LAN mode the LAN listener serves it by token too (lan.ts).
  app.get("/guide/:slug", (c) =>
    c.req.query("home") === undefined
      ? handleGuideByToken(core, c, c.req.param("slug"))
      : handleGuidePage(core, c),
  );
  app.get("/events", (c) => streamChanges(core, activity, c));
  // The Account's MCP endpoint, for a Connection: the login check let only its access token in.
  app.all("/mcp", bodyLimit({ maxSize: MCP_CAP, onError: tooBig }), (c) =>
    handleAccountMcpRequest(c.req.raw, {
      core,
      tools,
      account: connectionOf(c).account.id,
      activity,
      port,
      ...(publicOrigin ? { publicOrigin } : {}),
    }),
  );
  app.all("/mcp/homes/:home", bodyLimit({ maxSize: MCP_CAP, onError: tooBig }), async (c) => {
    const home = c.req.param("home");
    // Without the key, a Login opens the MCP endpoint of its own Account's Homes alone.
    if (c.get("keyed") !== home) {
      try {
        core.checkHome(callerOf(c), home);
      } catch (error) {
        if (!(error instanceof CoreError)) throw error;
        return c.json({ error: { code: error.code, message: error.message } }, 404);
      }
    }
    return handleMcpRequest(c.req.raw, {
      core,
      tools,
      home,
      activity,
      port,
      ...(publicOrigin ? { publicOrigin } : {}),
    });
  });
  serveWeb(app, webDist);
  return app;
}

function tooBig(c: Context): Response {
  const message = "That request is far larger than anything this route takes.";
  return c.json({ error: { code: "validation", message } }, 413);
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
