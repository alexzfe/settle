import { Hono } from "hono";
import { handleMcpRequest } from "./mcp.js";

const PLACEHOLDER_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Interior Design Harness</title>
  </head>
  <body>
    <h1>Interior Design Harness</h1>
    <p>The server is running. It does not serve the web UI yet: run <code>pnpm dev</code> and open the Vite URL.</p>
  </body>
</html>
`;

export function createApp(): Hono {
  const app = new Hono();
  app.get("/", (c) => c.html(PLACEHOLDER_PAGE));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.all("/mcp/homes/:home", (c) => handleMcpRequest(c.req.raw));
  return app;
}
