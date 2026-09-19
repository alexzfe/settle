import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("defaults to port 4380 and the XDG data dir", () => {
    expect(loadConfig({})).toEqual({
      port: 4380,
      dataDir: join(homedir(), ".local", "share", "settle"),
    });
    expect(loadConfig({ XDG_DATA_HOME: "/xdg" }).dataDir).toBe("/xdg/settle");
  });

  it("takes SETTLE_PORT and SETTLE_DATA_DIR over the defaults", () => {
    expect(
      loadConfig({ SETTLE_PORT: "5000", SETTLE_DATA_DIR: "/data", XDG_DATA_HOME: "/xdg" }),
    ).toEqual({
      port: 5000,
      dataDir: "/data",
    });
  });

  it("refuses an SETTLE_PORT that is not a port", () => {
    expect(() => loadConfig({ SETTLE_PORT: "http" })).toThrow(/SETTLE_PORT/);
  });

  it("turns LAN mode on with SETTLE_LAN=1, on the address SETTLE_LAN_HOST names or one found by itself", () => {
    expect(loadConfig({ SETTLE_LAN: "1" }).lan).toEqual({});
    expect(loadConfig({ SETTLE_LAN: "1", SETTLE_LAN_HOST: "192.168.1.20" }).lan).toEqual({
      host: "192.168.1.20",
    });
    expect(loadConfig({ SETTLE_LAN: "0", SETTLE_LAN_HOST: "192.168.1.20" }).lan).toBeUndefined();
    expect(loadConfig({ SETTLE_LAN_HOST: "192.168.1.20" }).lan).toBeUndefined();
  });

  it("refuses an SETTLE_LAN that is not 1 or 0, and an SETTLE_LAN_HOST covering every address", () => {
    expect(() => loadConfig({ SETTLE_LAN: "yes" })).toThrow(/SETTLE_LAN/);
    expect(() => loadConfig({ SETTLE_LAN: "1", SETTLE_LAN_HOST: "0.0.0.0" })).toThrow(
      /SETTLE_LAN_HOST/,
    );
  });
});
