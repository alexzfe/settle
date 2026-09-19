import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/** The web UI's build output: packages/web/dist, from both src/ and dist/ of this package. */
export const WEB_DIST = join(import.meta.dirname, "..", "..", "web", "dist");

// Paths the server answers itself, which the history fallback must never swallow.
const SERVER_PATHS = /^\/(api|events|mcp|health|guide)(\/|$)/;

const PLACEHOLDER_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Settle</title>
  </head>
  <body>
    <h1>Settle</h1>
    <p>The server is running, but the web UI has not been built. Run <code>pnpm build</code> and
    restart, or run <code>pnpm dev</code> and open the Vite URL.</p>
  </body>
</html>
`;

/**
 * Serves the built web UI from `webDist`, with a history fallback: any other page path is a
 * client-side route and gets index.html. Without a build, `/` shows a placeholder page.
 */
export function serveWeb(app: Hono, webDist: string | undefined): void {
  const index = webDist === undefined ? undefined : join(webDist, "index.html");
  if (webDist === undefined || index === undefined || !existsSync(index)) {
    app.get("/", (c) => c.html(PLACEHOLDER_PAGE));
    return;
  }
  app.use("*", serveStatic({ root: webDist }));
  app.get("*", async (c) => {
    if (SERVER_PATHS.test(c.req.path)) return c.notFound();
    // Read on each request, so a rebuilt UI shows without a restart.
    return c.html(await readFile(index, "utf8"));
  });
}
