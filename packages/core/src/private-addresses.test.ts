// The addresses a fetch made for a caller must never reach, shared by the CIMD fetch and the
// Listing picture fetch.
import { describe, expect, it } from "vitest";
import { addressBlocked, hostBlocked } from "./private-addresses.js";

describe("the private address guard", () => {
  it("counts every private range as blocked, and a public address as not", () => {
    for (const address of [
      "10.0.0.1",
      "172.16.5.4",
      "100.64.0.1",
      "0.0.0.0",
      "169.254.169.254",
      "::ffff:127.0.0.1",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(addressBlocked(address), address).toBe(true);
    }
    for (const address of ["160.79.104.10", "2606:4700::1111"]) {
      expect(addressBlocked(address), address).toBe(false);
    }
  });

  it("counts IPv6 forms that carry an IPv4 address inside them as blocked", () => {
    // IPv4-compatible, 6to4 and local-use NAT64: on a network that routes them, each reaches the
    // IPv4 address inside, loopback here.
    for (const address of ["::7f00:1", "::127.0.0.1", "2002:7f00:1::", "64:ff9b:1::7f00:1"]) {
      expect(addressBlocked(address), address).toBe(true);
    }
  });

  it("checks a URL's host when it is an address literal, and leaves a name to the lookup", () => {
    expect(hostBlocked(new URL("http://[::1]/"))).toBe(true);
    expect(hostBlocked(new URL("http://0x7f000001/"))).toBe(true);
    expect(hostBlocked(new URL("https://160.79.104.10/"))).toBe(false);
    expect(hostBlocked(new URL("https://shop.example/"))).toBe(false);
  });
});
