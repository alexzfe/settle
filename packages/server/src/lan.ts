import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import { type Core, CoreError } from "@settle/core";
import { type Context, Hono } from "hono";
import { FILE_HEADERS, fileResponse, messagePage } from "./pages.js";

const web = { caller: { kind: "web" } } as const;

/**
 * The LAN listener's app (SETTLE_LAN=1): each Quick Guide's phone page by its unguessable token,
 * and nothing else. The web app, the API, the events, and the MCP endpoint stay on the loopback
 * listener, so a phone on the user's network reaches only these pages. The pages carry their
 * styles inline, so there are no static assets to serve. Every miss, a wrong token included, gets
 * the same 404.
 */
export function createLanApp({ core }: { core: Core }): Hono {
  const app = new Hono();
  app.get("/guide/:token", async (c) => {
    try {
      const token = c.req.param("token");
      return fileResponse(c, await core.run("get_guide_page", web, { token }));
    } catch (error) {
      if (!(error instanceof CoreError)) throw error;
      return notFound(c);
    }
  });
  app.notFound(notFound);
  return app;
}

function notFound(c: Context) {
  return c.html(
    messagePage("There is nothing here. Scan the Quick Guide's QR code again."),
    404,
    FILE_HEADERS,
  );
}

/** LAN mode without an address on a local network to listen on. */
export class NoLanAddressError extends Error {
  constructor() {
    super(
      "SETTLE_LAN=1, but this computer has no address on a local network (192.168.x.x, " +
        "10.x.x.x, or 172.16.x.x to 172.31.x.x) to listen on. Join the network, or name the " +
        "address with SETTLE_LAN_HOST.",
    );
    this.name = "NoLanAddressError";
  }
}

// Container bridges, virtual machines, and VPNs: never the network a phone in the house is on.
const NOT_THE_LAN = /^(docker|br-|veth|virbr|vmnet|vboxnet|tailscale|zt|utun|tun|tap|wg)/;
// Private IPv4 ranges, the likeliest home network first.
const PRIVATE_RANGES = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** This computer's address on the local network, for the LAN listener; undefined without one. */
export function lanAddress(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string | undefined {
  let best: { address: string; rank: number } | undefined;
  for (const [name, infos] of Object.entries(interfaces)) {
    if (NOT_THE_LAN.test(name)) continue;
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      const rank = PRIVATE_RANGES.findIndex((range) => range.test(info.address));
      if (rank >= 0 && (!best || rank < best.rank)) best = { address: info.address, rank };
    }
  }
  return best?.address;
}
