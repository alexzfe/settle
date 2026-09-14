import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { migrate } from "@idh/core";
import { createApp } from "./app.js";
import type { Config } from "./config.js";

// Localhost only; LAN mode (slice 6) adds the LAN address.
const HOST = "127.0.0.1";

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

/** Opens and migrates the database in the data dir, then listens. Port 0 picks a free port. */
export async function startServer(config: Config): Promise<RunningServer> {
  mkdirSync(config.dataDir, { recursive: true });
  const db = migrate(join(config.dataDir, "harness.sqlite"));

  const server = serve({ fetch: createApp().fetch, port: config.port, hostname: HOST });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  }).catch((error: unknown) => {
    db.close();
    throw error;
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${HOST}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          db.close();
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
