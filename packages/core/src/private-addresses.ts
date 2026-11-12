import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

// The addresses a fetch the server makes for a caller must never reach: its own loopback, the
// private networks it sits on (Docker, the LAN, Tailscale's 100.64/10), link-local (the cloud
// metadata address, 169.254.169.254), and the like. Two fetches name a URL someone else chose:
// the CIMD fetch of an OAuth client's metadata, and the Listing picture fetch.

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  // Unspecified, loopback, and IPv4-compatible (::a.b.c.d, deprecated, but routed by some stacks).
  ["::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  // NAT64, well-known and local-use (RFC 8215), and 6to4: each reaches the IPv4 address inside.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2002::", 16],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

/** Whether an address is one the server must never fetch from: private, loopback, and the like. */
export function addressBlocked(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return BLOCKED.check(mapped, "ipv4");
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Whether a URL's host is an address literal that is blocked. A literal is dialled without DNS,
 * so `safeLookup` never sees it: this is the check for it. A name answers false; `safeLookup`
 * checks what it resolves to.
 */
export function hostBlocked(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return isIP(host) !== 0 && addressBlocked(host);
}

/**
 * DNS, refusing any answer that names a blocked address. Given to the socket as its `lookup`, so
 * the check is made at connect time and a DNS answer can't change between the check and the dial.
 */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 4);
    const blocked = addresses.find(({ address }) => addressBlocked(address));
    if (blocked || addresses.length === 0) {
      return callback(new Error(`${hostname} is a private address`), "", 4);
    }
    if (options.all)
      return (callback as never as (e: null, a: LookupAddress[]) => void)(null, addresses);
    const first = addresses[0] as LookupAddress;
    return callback(null, first.address, first.family);
  });
};
