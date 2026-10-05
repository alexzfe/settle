import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("defaults to port 4380 and the XDG data dir", () => {
    expect(loadConfig({})).toEqual({
      host: "127.0.0.1",
      port: 4380,
      dataDir: join(homedir(), ".local", "share", "settle"),
    });
    expect(loadConfig({ XDG_DATA_HOME: "/xdg" }).dataDir).toBe("/xdg/settle");
  });

  it("takes SETTLE_PORT and SETTLE_DATA_DIR over the defaults", () => {
    expect(
      loadConfig({ SETTLE_PORT: "5000", SETTLE_DATA_DIR: "/data", XDG_DATA_HOME: "/xdg" }),
    ).toEqual({
      host: "127.0.0.1",
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

  it("takes SETTLE_PUBLIC_ORIGIN as an origin only, with no path or trailing slash", () => {
    const locked = { SETTLE_PASSWORD: "open sesame" };
    expect(
      loadConfig({ SETTLE_PUBLIC_ORIGIN: "https://settle.example.com", ...locked }).publicOrigin,
    ).toBe("https://settle.example.com");
    expect(loadConfig({ SETTLE_PUBLIC_ORIGIN: "http://box:8080", ...locked }).publicOrigin).toBe(
      "http://box:8080",
    );
    expect(loadConfig({}).publicOrigin).toBeUndefined();
    expect(() => loadConfig({ SETTLE_PUBLIC_ORIGIN: "https://settle.example.com/" })).toThrow(
      /did you mean "https:\/\/settle.example.com"/,
    );
    for (const value of ["settle.example.com", "https://settle.example.com/app", "ftp://box"]) {
      expect(() => loadConfig({ SETTLE_PUBLIC_ORIGIN: value })).toThrow(/SETTLE_PUBLIC_ORIGIN/);
    }
  });

  it("binds SETTLE_HOST, beyond loopback only with SETTLE_PUBLIC_ORIGIN and SETTLE_PASSWORD", () => {
    const hosted = { SETTLE_PUBLIC_ORIGIN: "https://settle.example.com" };
    expect(loadConfig({ SETTLE_HOST: "127.0.0.2" }).host).toBe("127.0.0.2");
    expect(loadConfig({ SETTLE_HOST: "::1" }).host).toBe("::1");
    expect(() => loadConfig({ SETTLE_HOST: "0.0.0.0" })).toThrow(/SETTLE_PUBLIC_ORIGIN/);
    expect(
      loadConfig({ SETTLE_HOST: "0.0.0.0", SETTLE_PASSWORD: "open sesame", ...hosted }).host,
    ).toBe("0.0.0.0");
  });

  it("refuses to listen beyond loopback without SETTLE_PASSWORD, an empty one included", () => {
    const hosted = { SETTLE_PUBLIC_ORIGIN: "https://settle.example.com" };
    for (const host of ["0.0.0.0", "::", "192.168.1.20"]) {
      expect(() => loadConfig({ SETTLE_HOST: host, ...hosted })).toThrow(
        new RegExp(`SETTLE_HOST="${host}" listens beyond this computer, so set SETTLE_PASSWORD`),
      );
      expect(() => loadConfig({ SETTLE_HOST: host, SETTLE_PASSWORD: "", ...hosted })).toThrow(
        /SETTLE_PASSWORD/,
      );
    }
  });

  it("refuses a public origin without SETTLE_PASSWORD on loopback too, behind a reverse proxy", () => {
    expect(() => loadConfig({ SETTLE_PUBLIC_ORIGIN: "https://settle.example.com" })).toThrow(
      /SETTLE_PUBLIC_ORIGIN="https:\/\/settle.example.com" means the app is reached from other computers, so set SETTLE_PASSWORD/,
    );
  });

  it("takes SETTLE_PASSWORD on any host, and none on loopback means no login", () => {
    expect(loadConfig({ SETTLE_PASSWORD: "open sesame" }).password).toBe("open sesame");
    expect(loadConfig({}).password).toBeUndefined();
    expect(loadConfig({ SETTLE_PASSWORD: "" }).password).toBeUndefined();
  });
});
