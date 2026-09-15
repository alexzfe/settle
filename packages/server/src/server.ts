import { mkdirSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { type Core, createCore } from "@idh/core";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { createLanApp, lanAddress, NoLanAddressError } from "./lan.js";
import { WEB_DIST } from "./web.js";

// The loopback listener: the web app, the API, the events, and the MCP endpoint. LAN mode adds a
// second listener on the LAN address that serves only the Quick Guide pages (lan.ts).
const HOST = "127.0.0.1";

export interface RunningServer {
  url: string;
  /** In LAN mode: the LAN listener's address, which serves only the Quick Guide pages. */
  lanUrl?: string;
  close(): Promise<void>;
}

export interface ServerOptions {
  /** The built web UI to serve; packages/web/dist by default. */
  webDist?: string;
}

type Fetch = Parameters<typeof serve>[0]["fetch"];

/**
 * Listens, then opens and migrates the database in the data dir. Port 0 picks a free port. In
 * LAN mode the LAN listener takes the same port on the LAN address.
 */
export async function startServer(
  config: Config,
  { webDist = WEB_DIST }: ServerOptions = {},
): Promise<RunningServer> {
  mkdirSync(config.dataDir, { recursive: true });
  const lanHost = config.lan && (config.lan.host ?? lanAddress());
  if (config.lan && !lanHost) throw new NoLanAddressError();

  // The MCP endpoint accepts only Host headers naming the port it listens on, each Quick Guide's
  // LAN URL names the LAN listener's, and port 0 picks the port only at listen time; so core and
  // the apps are built once the listeners listen. Until then a request is answered 503; requests
  // are handled on a later turn of the event loop, after the apps are set.
  let app: Hono | undefined;
  let lanApp: Hono | undefined;
  let core: Core | undefined;
  const servers: Server[] = [];
  try {
    const loopback = await listen(HOST, config.port, (request, env) =>
      app ? app.fetch(request, env) : unavailable(),
    );
    servers.push(loopback);
    const { port } = loopback.address() as AddressInfo;
    const lanUrl = lanHost && `http://${lanHost.includes(":") ? `[${lanHost}]` : lanHost}:${port}`;
    if (lanHost) {
      servers.push(
        await listen(lanHost, port, (request, env) =>
          lanApp ? lanApp.fetch(request, env) : unavailable(),
        ),
      );
    }
    const open = createCore({
      database: join(config.dataDir, "harness.sqlite"),
      dataDir: config.dataDir,
      port: config.port,
      ...(lanUrl ? { lanUrl } : {}),
    });
    core = open;
    app = createApp({ core: open, port, webDist });
    if (lanHost) lanApp = createLanApp({ core: open });
    return {
      url: `http://${HOST}:${port}`,
      ...(lanUrl ? { lanUrl } : {}),
      close: () => closeAll(servers).finally(() => open.close()),
    };
  } catch (error) {
    core?.close();
    await closeAll(servers).catch(() => {});
    throw error;
  }
}

async function listen(hostname: string, port: number, fetch: Fetch): Promise<Server> {
  const server = serve({ fetch, port, hostname }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

function unavailable(): Response {
  return new Response(null, { status: 503 });
}

async function closeAll(servers: Server[]): Promise<void> {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          // Open /events streams would otherwise keep close() waiting forever.
          server.closeAllConnections();
        }),
    ),
  );
}
