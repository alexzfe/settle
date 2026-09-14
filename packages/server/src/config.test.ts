import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("defaults to port 4380 and the XDG data dir", () => {
    expect(loadConfig({})).toEqual({
      port: 4380,
      dataDir: join(homedir(), ".local", "share", "int-design-harness"),
    });
    expect(loadConfig({ XDG_DATA_HOME: "/xdg" }).dataDir).toBe("/xdg/int-design-harness");
  });

  it("takes IDH_PORT and IDH_DATA_DIR over the defaults", () => {
    expect(loadConfig({ IDH_PORT: "5000", IDH_DATA_DIR: "/data", XDG_DATA_HOME: "/xdg" })).toEqual({
      port: 5000,
      dataDir: "/data",
    });
  });

  it("refuses an IDH_PORT that is not a port", () => {
    expect(() => loadConfig({ IDH_PORT: "http" })).toThrow(/IDH_PORT/);
  });
});
