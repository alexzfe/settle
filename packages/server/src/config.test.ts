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
    expect(loadConfig({ SETTLE_PUBLIC_ORIGIN: "https://settle.example.com" }).publicOrigin).toBe(
      "https://settle.example.com",
    );
    expect(loadConfig({ SETTLE_PUBLIC_ORIGIN: "https://box:8443" }).publicOrigin).toBe(
      "https://box:8443",
    );
    expect(loadConfig({}).publicOrigin).toBeUndefined();
    expect(() => loadConfig({ SETTLE_PUBLIC_ORIGIN: "https://settle.example.com/" })).toThrow(
      /did you mean "https:\/\/settle.example.com"/,
    );
    for (const value of ["settle.example.com", "https://settle.example.com/app", "ftp://box"]) {
      expect(() => loadConfig({ SETTLE_PUBLIC_ORIGIN: value })).toThrow(/SETTLE_PUBLIC_ORIGIN/);
    }
  });

  it("refuses a plain http public origin, but on localhost and 127.x", () => {
    for (const value of ["http://box:8080", "http://settle.example.com", "http://192.168.1.20"]) {
      expect(() => loadConfig({ SETTLE_PUBLIC_ORIGIN: value })).toThrow(
        new RegExp(`SETTLE_PUBLIC_ORIGIN="${value}" is plain http, so passwords would cross`),
      );
    }
    for (const value of ["http://localhost:4380", "http://127.0.0.1:4380", "http://127.1.2.3"]) {
      expect(loadConfig({ SETTLE_PUBLIC_ORIGIN: value }).publicOrigin).toBe(value);
    }
  });

  it("binds SETTLE_HOST, beyond loopback only with SETTLE_PUBLIC_ORIGIN", () => {
    const hosted = { SETTLE_PUBLIC_ORIGIN: "https://settle.example.com" };
    expect(loadConfig({ SETTLE_HOST: "127.0.0.2" }).host).toBe("127.0.0.2");
    expect(loadConfig({ SETTLE_HOST: "::1" }).host).toBe("::1");
    expect(() => loadConfig({ SETTLE_HOST: "0.0.0.0" })).toThrow(/SETTLE_PUBLIC_ORIGIN/);
    expect(loadConfig({ SETTLE_HOST: "0.0.0.0", ...hosted }).host).toBe("0.0.0.0");
  });

  it("ignores SETTLE_PASSWORD, which accounts replaced", () => {
    expect(loadConfig({ SETTLE_PASSWORD: "open sesame" })).toEqual(loadConfig({}));
  });

  it("takes the client IP from Cloudflare only with SETTLE_TRUSTED_PROXY=cloudflare", () => {
    expect(loadConfig({ SETTLE_TRUSTED_PROXY: "cloudflare" }).trustedProxy).toBe("cloudflare");
    expect(loadConfig({}).trustedProxy).toBeUndefined();
    for (const value of ["nginx", "Cloudflare", "1"]) {
      expect(() => loadConfig({ SETTLE_TRUSTED_PROXY: value })).toThrow(
        new RegExp(`SETTLE_TRUSTED_PROXY must be "cloudflare".*not "${value}"`),
      );
    }
  });
  it("turns Sign in with Google on only with both its client id and secret", () => {
    const clientId = "123-abc.apps.googleusercontent.com";
    expect(loadConfig({}).google).toBeUndefined();
    expect(
      loadConfig({ SETTLE_GOOGLE_CLIENT_ID: clientId, SETTLE_GOOGLE_CLIENT_SECRET: "GOCSPX-x" })
        .google,
    ).toEqual({ clientId, clientSecret: "GOCSPX-x" });
    expect(() => loadConfig({ SETTLE_GOOGLE_CLIENT_ID: clientId })).toThrow(
      /needs both.*only the id is set/,
    );
    expect(() => loadConfig({ SETTLE_GOOGLE_CLIENT_SECRET: "GOCSPX-x" })).toThrow(
      /only the secret is set/,
    );
    expect(() =>
      loadConfig({ SETTLE_GOOGLE_CLIENT_ID: "123-abc", SETTLE_GOOGLE_CLIENT_SECRET: "GOCSPX-x" }),
    ).toThrow(/apps\.googleusercontent\.com/);
  });
});
