import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 4380;
export const DEFAULT_HOST = "127.0.0.1";

export interface Config {
  /** The address the main listener binds (SETTLE_HOST): loopback unless a public origin is set. */
  host: string;
  port: number;
  /**
   * SETTLE_PUBLIC_ORIGIN: the origin the app is reached at when hosted, e.g.
   * "https://settle.example.com". The front door accepts it, and the Home Folder command and each
   * Quick Guide's phone URL name it. Absent, the app is local: http://127.0.0.1:<port>.
   */
  publicOrigin?: string;
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
  const publicOrigin = parsePublicOrigin(env.SETTLE_PUBLIC_ORIGIN);
  return {
    host: parseHost(env.SETTLE_HOST, publicOrigin),
    port: parsePort(env.SETTLE_PORT),
    dataDir: env.SETTLE_DATA_DIR || join(dataHome, "settle"),
    ...(publicOrigin ? { publicOrigin } : {}),
    ...(lan ? { lan } : {}),
  };
}

function parsePublicOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let origin: string | undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") origin = url.origin;
  } catch {
    // Reported below.
  }
  if (origin === value) return value;
  throw new Error(
    "SETTLE_PUBLIC_ORIGIN must be the origin the app is reached at, scheme://host[:port] with " +
      `no path and no trailing slash, such as https://settle.example.com, not "${value}"` +
      (origin ? ` (did you mean "${origin}"?)` : ""),
  );
}

/** Loopback unless a public origin says where the app is reached, since the host guard needs it. */
function parseHost(value: string | undefined, publicOrigin: string | undefined): string {
  if (!value) return DEFAULT_HOST;
  if (!isLoopback(value) && !publicOrigin) {
    throw new Error(
      `SETTLE_HOST="${value}" listens beyond this computer, so set SETTLE_PUBLIC_ORIGIN to the ` +
        "address the app is reached at, such as https://settle.example.com; the server accepts " +
        "requests only for that address and this computer's own names",
    );
  }
  return value;
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
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
