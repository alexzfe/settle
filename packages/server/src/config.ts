import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 4380;

export interface Config {
  port: number;
  /** Holds the database, and later uploads/ and rendered/. */
  dataDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataHome = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return {
    port: parsePort(env.IDH_PORT),
    dataDir: env.IDH_DATA_DIR || join(dataHome, "int-design-harness"),
  };
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`IDH_PORT must be a port number from 0 to 65535, not "${value}"`);
  }
  return port;
}
