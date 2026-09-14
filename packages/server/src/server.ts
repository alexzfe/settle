import { mkdirSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createCore } from "@idh/core";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { WEB_DIST } from "./web.js";

// Localhost only; LAN mode (slice 6) adds the LAN address.
const HOST = "127.0.0.1";

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

export interface ServerOptions {
  /** The built web UI to serve; packages/web/dist by default. */
  webDist?: string;
}

/**
 * Opens and migrates the database in the data dir, then listens. Port 0 picks a free port.
 */
export async function startServer(
  config: Config,
  { webDist = WEB_DIST }: ServerOptions = {},
): Promise<RunningServer> {
  mkdirSync(config.dataDir, { recursive: true });
  const core = createCore({ database: join(config.dataDir, "harness.sqlite"), port: config.port });

  // The MCP endpoint accepts only Host headers naming the port it listens on, and port 0 picks
  // that port only at listen time, so the app is built once the server listens. Requests are
  // handled on a later turn of the event loop, after `app` is set.
  let app: Hono | undefined;
  const server = serve({
    fetch: (request, env) => app?.fetch(request, env) ?? new Response(null, { status: 503 }),
    port: config.port,
    hostname: HOST,
  }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  }).catch((error: unknown) => {
    core.close();
    throw error;
  });

  const { port } = server.address() as AddressInfo;
  app = createApp({ core, port, webDist });
  return {
    url: `http://${HOST}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          core.close();
          if (error) reject(error);
          else resolve();
        });
        // Open /events streams would otherwise keep close() waiting forever.
        server.closeAllConnections();
      }),
  };
}
