import { mkdirSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { type Core, type CoreOptions, createCore } from "@settle/core";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { createLanApp, lanAddress, NoLanAddressError } from "./lan.js";
import { WEB_DIST } from "./web.js";

// The main listener, on config.host (loopback unless hosted): the web app, the API, the events,
// and the MCP endpoint. LAN mode adds a second listener on the LAN address that serves only the
// Quick Guide pages (lan.ts).

export interface RunningServer {
  /** The main listener's address. */
  url: string;
  /** The origin the app names itself by: the public origin when hosted, else `url` on loopback. */
  origin: string;
  /** In LAN mode: the LAN listener's address, which serves only the Quick Guide pages. */
  lanUrl?: string;
  /**
   * While there is no Account: a new one-time setup link, which makes the Admin and claims every
   * Home. Each start makes a new one and voids the last.
   */
  setupUrl?: string;
  close(): Promise<void>;
}

export interface ServerOptions {
  /** The built web UI to serve; packages/web/dist by default. */
  webDist?: string;
  /** Internal seam: scrypt's cost; a test gives a cheap one. */
  passwordCost?: CoreOptions["passwordCost"];
  /** Internal seam: how long a stop waits for requests in flight; a test gives a short one. */
  stopGraceMs?: number;
}

type Fetch = Parameters<typeof serve>[0]["fetch"];

/**
 * Listens, then opens and migrates the database in the data dir. Port 0 picks a free port. In
 * LAN mode the LAN listener takes the same port on the LAN address.
 */
export async function startServer(
  config: Config,
  { webDist = WEB_DIST, passwordCost, stopGraceMs = STOP_GRACE_MS }: ServerOptions = {},
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
  const streams = new Set<Socket>();
  // The handlers still running, so a stop closes the database only once they have ended.
  const handling = new Set<Promise<unknown>>();
  const track = (answer: Response | Promise<Response>): Response | Promise<Response> => {
    if (!(answer instanceof Promise)) return answer;
    const settled = answer.catch(() => {});
    handling.add(settled);
    void settled.finally(() => handling.delete(settled));
    return answer;
  };
  let closing: Promise<void> | undefined;
  try {
    const main = await listen(config.host, config.port, (request, env) =>
      app ? track(app.fetch(request, env)) : unavailable(),
    );
    servers.push(main);
    // The /events streams never finish by themselves, so a stop ends them rather than waiting.
    main.on("request", (request: IncomingMessage) => {
      if (!request.url?.startsWith("/events")) return;
      streams.add(request.socket);
      request.socket.once("close", () => streams.delete(request.socket));
    });
    const { port } = main.address() as AddressInfo;
    const lanUrl = lanHost && `http://${urlHost(lanHost)}:${port}`;
    if (lanHost) {
      servers.push(
        await listen(lanHost, port, (request, env) =>
          lanApp ? track(lanApp.fetch(request, env)) : unavailable(),
        ),
      );
    }
    const open = createCore({
      database: join(config.dataDir, "settle.sqlite"),
      dataDir: config.dataDir,
      // The bound port, not config.port: with port 0 only the listener knows which it is.
      port,
      ...(config.publicOrigin ? { publicOrigin: config.publicOrigin } : {}),
      ...(lanUrl ? { lanUrl } : {}),
      ...(passwordCost ? { passwordCost } : {}),
      googleSignIn: config.google !== undefined,
    });
    core = open;
    app = createApp({
      core: open,
      port,
      webDist,
      ...(config.publicOrigin ? { publicOrigin: config.publicOrigin } : {}),
      auth: {
        ...(config.trustedProxy ? { trustedProxy: config.trustedProxy } : {}),
        ...(config.google ? { google: { client: config.google } } : {}),
      },
    });
    if (lanHost) lanApp = createLanApp({ core: open });
    const setupUrl = open.accounts.makeSetupLink();
    return {
      url: `http://${urlHost(config.host)}:${port}`,
      origin: config.publicOrigin ?? `http://127.0.0.1:${port}`,
      ...(lanUrl ? { lanUrl } : {}),
      ...(setupUrl ? { setupUrl } : {}),
      close: () => {
        // Once, though SIGINT and SIGTERM may both ask.
        closing ??= closeAll(servers, streams, stopGraceMs)
          .then(() => handlersEnded(handling))
          .finally(() => open.close());
        return closing;
      },
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

/** An IPv6 address goes in brackets in a URL. */
function urlHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function unavailable(): Response {
  return new Response(null, { status: 503 });
}

/**
 * How long a stop waits for requests in flight (an upload, a Blueprint render) before cutting
 * them. With HANDLER_END_MS after it, a stop stays well inside the 10 s Docker gives between
 * SIGTERM and SIGKILL.
 */
const STOP_GRACE_MS = 7000;

/**
 * How long a stop then waits for the handlers of cut requests to end. A cut request's body ends
 * early, so its handler usually ends at once; one that does not is not waited on past this.
 */
const HANDLER_END_MS = 1000;

/** Resolves once every handler still running has ended, or after HANDLER_END_MS. */
async function handlersEnded(handling: Set<Promise<unknown>>): Promise<void> {
  if (handling.size === 0) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.all(handling),
    new Promise((resolve) => {
      timer = setTimeout(resolve, HANDLER_END_MS);
    }),
  ]);
  clearTimeout(timer);
}

/**
 * Stops accepting, ends the /events streams, and lets the requests in flight finish, closing each
 * connection once its answer is sent; whatever is still open after the grace is cut. The caller
 * then waits for the handlers to end and only then closes the database, so no handler writes to
 * a closed one.
 */
async function closeAll(
  servers: Server[],
  streams: Set<Socket> = new Set(),
  graceMs = STOP_GRACE_MS,
): Promise<void> {
  const closed = Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  for (const socket of streams) socket.destroy();
  // A kept-alive connection goes idle once its request is answered; close it then.
  const sweep = setInterval(() => {
    for (const server of servers) server.closeIdleConnections();
  }, 50);
  const cut = setTimeout(() => {
    for (const server of servers) server.closeAllConnections();
  }, graceMs);
  try {
    await closed;
  } finally {
    clearInterval(sweep);
    clearTimeout(cut);
  }
}
