import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 4380;

export interface Config {
  port: number;
  /** Holds the database, uploads/ (the Blueprint files), and rendered/ (their pages as PNGs). */
  dataDir: string;
  /**
   * LAN mode (SETTLE_LAN=1): a second listener on this computer's LAN address that serves only the
   * Quick Guide pages, by their tokens. `host` (SETTLE_LAN_HOST) names the address; otherwise it is
   * found among the network interfaces.
   */
  lan?: { host?: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataHome = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const lan = parseLan(env.SETTLE_LAN, env.SETTLE_LAN_HOST);
  return {
    port: parsePort(env.SETTLE_PORT),
    dataDir: env.SETTLE_DATA_DIR || join(dataHome, "settle"),
    ...(lan ? { lan } : {}),
  };
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`SETTLE_PORT must be a port number from 0 to 65535, not "${value}"`);
  }
  return port;
}

function parseLan(value: string | undefined, host: string | undefined): Config["lan"] {
  if (!value || value === "0") return undefined;
  if (value !== "1")
    throw new Error(`SETTLE_LAN must be 1 to turn LAN mode on, or 0, not "${value}"`);
  if (!host) return {};
  if (host === "0.0.0.0" || host === "::") {
    throw new Error(
      `SETTLE_LAN_HOST must be this computer's own address on the network, not "${host}", which ` +
        "covers every address, the loopback one included",
    );
  }
  return { host };
}
