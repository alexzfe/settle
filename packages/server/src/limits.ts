import { BlockList, isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

// The flood guards: failed logins per account and IP, and uploads per account. Kept in memory: one
// process serves everything, so the counts are exact while it runs, and a restart clears them,
// which is fine for a guard that is not a quota.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface FailureLimits {
  /** Failures of one key (an account, or a kind of link) from one IP that lock that pair. */
  perPair: number;
  /** Failures from one IP, whatever the key, that lock the IP. */
  perIp: number;
  /** How far back failures count, and how long a lock lasts. */
  windowMs: number;
}

export const FAILURE_LIMITS: FailureLimits = { perPair: 5, perIp: 20, windowMs: 15 * MINUTE };

interface Tally {
  failures: number[];
  lockedUntil: number;
}

/**
 * Failed logins, and failed setup, invite and reset submissions. Locking one account and IP pair
 * stops a guesser without locking the account's owner out from elsewhere; the per-IP limit stops
 * one IP trying many emails. Each try is counted as a failure when it arrives, before its password
 * is checked, and taken back when it turns out right: a parallel burst is counted as it comes, not
 * once every guess in it has been checked.
 */
export class FailureLimiter {
  readonly #limits: FailureLimits;
  readonly #now: () => number;
  readonly #pairs = new Map<string, Tally>();
  readonly #ips = new Map<string, Tally>();

  constructor(limits: FailureLimits = FAILURE_LIMITS, now: () => number = Date.now) {
    this.#limits = limits;
    this.#now = now;
  }

  /** When the pair or the IP may try again, if either is locked now. */
  lockedUntil(ip: string, key: string): number | undefined {
    const now = this.#now();
    const until = Math.max(
      this.#pairs.get(pairKey(ip, key))?.lockedUntil ?? 0,
      this.#ips.get(ip)?.lockedUntil ?? 0,
    );
    return until > now ? until : undefined;
  }

  /**
   * A try arriving: when the pair or the IP may try again, if either is locked now; otherwise the
   * try is counted as a failure until succeed or takeBack says it was not one.
   */
  attempt(ip: string, key: string): number | undefined {
    const until = this.lockedUntil(ip, key);
    if (until === undefined) this.fail(ip, key);
    return until;
  }

  /** A try that was right after all: the pair's failures are cleared, and the IP's try taken back. */
  succeed(ip: string, key: string): void {
    this.#pairs.delete(pairKey(ip, key));
    this.#ips.get(ip)?.failures.pop();
  }

  /** A try that was no guess (a form refused for what it asked, not for its token): not counted. */
  takeBack(ip: string, key: string): void {
    this.#pairs.get(pairKey(ip, key))?.failures.pop();
    this.#ips.get(ip)?.failures.pop();
  }

  fail(ip: string, key: string): void {
    const now = this.#now();
    this.#count(this.#pairs, pairKey(ip, key), this.#limits.perPair, now);
    this.#count(this.#ips, ip, this.#limits.perIp, now);
  }

  #count(tallies: Map<string, Tally>, key: string, limit: number, now: number): void {
    const since = now - this.#limits.windowMs;
    const tally = tallies.get(key) ?? { failures: [], lockedUntil: 0 };
    tally.failures = tally.failures.filter((at) => at > since);
    tally.failures.push(now);
    if (tally.failures.length >= limit) {
      tally.lockedUntil = now + this.#limits.windowMs;
      tally.failures = [];
    }
    tallies.set(key, tally);
    // A guesser trying many emails grows the map; forget what no longer counts.
    if (tallies.size > 10_000) {
      for (const [each, { failures, lockedUntil }] of tallies) {
        if (lockedUntil <= now && failures.every((at) => at <= since)) tallies.delete(each);
      }
    }
  }
}

function pairKey(ip: string, key: string): string {
  return `${key.toLowerCase()}\n${ip}`;
}

export interface PasswordLimits {
  /** Password checks one IP may have in flight at once. */
  perIp: number;
  /** Password checks the whole server may have in flight at once. */
  total: number;
}

/**
 * Each check costs about 128 MiB and a libuv thread for a fraction of a second, and Node has four
 * such threads, shared with file reads: a few at once from one IP is a person, more is a flood.
 */
export const PASSWORD_LIMITS: PasswordLimits = { perIp: 2, total: 8 };

/**
 * Password checks in flight (a login, or a setup, invite or reset form), so a burst can neither
 * hold every scrypt thread nor fill memory: what is over the limit is refused at once.
 */
export class PasswordGate {
  readonly #limits: PasswordLimits;
  readonly #inFlight = new Map<string, number>();
  #total = 0;

  constructor(limits: PasswordLimits = PASSWORD_LIMITS) {
    this.#limits = limits;
  }

  /** Takes a place for a check from `ip`, or false when the IP or the server has none free. */
  enter(ip: string): boolean {
    const mine = this.#inFlight.get(ip) ?? 0;
    if (mine >= this.#limits.perIp || this.#total >= this.#limits.total) return false;
    this.#inFlight.set(ip, mine + 1);
    this.#total++;
    return true;
  }

  /** Gives back the place a check from `ip` took. */
  leave(ip: string): void {
    const mine = (this.#inFlight.get(ip) ?? 0) - 1;
    if (mine > 0) this.#inFlight.set(ip, mine);
    else this.#inFlight.delete(ip);
    this.#total = Math.max(0, this.#total - 1);
  }
}

export interface UploadLimits {
  perHour: number;
  bytesPerDay: number;
}

/** Generous: a whole home photographed in an evening is 100–200 photos, well under 1 GB. */
export const UPLOAD_LIMITS: UploadLimits = { perHour: 300, bytesPerDay: 5 * 1024 ** 3 };

/** Uploads per Account, across every upload route. */
export class UploadLimiter {
  readonly #limits: UploadLimits;
  readonly #now: () => number;
  readonly #uploads = new Map<number, { at: number; bytes: number }[]>();

  constructor(limits: UploadLimits = UPLOAD_LIMITS, now: () => number = Date.now) {
    this.#limits = limits;
    this.#now = now;
  }

  /**
   * Takes one upload of `bytes` for the Account, or, when it would go over a limit, takes nothing
   * and returns when the Account may try again.
   */
  take(account: number, bytes: number): { retryAt: number } | undefined {
    const now = this.#now();
    const uploads = (this.#uploads.get(account) ?? []).filter((each) => each.at > now - DAY);
    const lastHour = uploads.filter((each) => each.at > now - HOUR);
    if (lastHour.length >= this.#limits.perHour) {
      return { retryAt: (lastHour[lastHour.length - this.#limits.perHour]?.at ?? now) + HOUR };
    }
    let total = uploads.reduce((sum, each) => sum + each.bytes, 0) + bytes;
    if (total > this.#limits.bytesPerDay) {
      // When enough of the day's uploads have aged out for this one to fit.
      for (const each of uploads) {
        total -= each.bytes;
        if (total <= this.#limits.bytesPerDay) return { retryAt: each.at + DAY };
      }
      return { retryAt: now + DAY };
    }
    uploads.push({ at: now, bytes });
    this.#uploads.set(account, uploads);
    return undefined;
  }
}

export interface RegisterLimits {
  /** Clients one IP may register in an hour. */
  perHour: number;
}

/**
 * Claude registers one client per connect, so a person connecting a few apps, and retrying, stays
 * far under this; a loop from one IP is stopped long before it could push out the
 * UNUSED_CLIENTS (500) a real connect, still at its Allow, needs to stay among.
 */
export const REGISTER_LIMITS: RegisterLimits = { perHour: 20 };

/** Client registrations (/register) per IP: anyone may register, so each IP gets a few an hour. */
export class RegisterLimiter {
  readonly #limits: RegisterLimits;
  readonly #now: () => number;
  readonly #registered = new Map<string, number[]>();

  constructor(limits: RegisterLimits = REGISTER_LIMITS, now: () => number = Date.now) {
    this.#limits = limits;
    this.#now = now;
  }

  /** Takes one registration for `ip`, or, over the limit, takes none and says how long to wait. */
  take(ip: string): { waitMs: number } | undefined {
    const now = this.#now();
    const recent = (this.#registered.get(ip) ?? []).filter((at) => at > now - HOUR);
    if (recent.length >= this.#limits.perHour) {
      return { waitMs: (recent[recent.length - this.#limits.perHour] ?? now) + HOUR - now };
    }
    recent.push(now);
    this.#registered.set(ip, recent);
    // Many IPs grow the map; forget the ones with nothing left in the hour.
    if (this.#registered.size > 10_000) {
      for (const [each, times] of this.#registered) {
        if (times.every((at) => at <= now - HOUR)) this.#registered.delete(each);
      }
    }
    return undefined;
  }
}

/** "in 12 minutes", "in 3 hours": how long until `at`, in words, rounded up. */
export function inWords(at: number, now: number = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((at - now) / MINUTE));
  if (minutes < 90) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `in ${hours} hours`;
}

/** Where the client IP comes from: Cloudflare's header, a local proxy's X-Forwarded-For, or the socket. */
export type TrustedProxy = "cloudflare" | "forwarded";

/**
 * The visitor's IP. Behind Cloudflare (SETTLE_TRUSTED_PROXY=cloudflare), from CF-Connecting-IP,
 * since every request arrives from the proxy's address. Behind a reverse proxy on this machine
 * (=forwarded), from the right-most X-Forwarded-For hop, the one the proxy added, but only when
 * the request comes from a loopback or private address, where that proxy is; the hops before it
 * are the visitor's to make up. Otherwise the socket's, and the headers are ignored, since anyone
 * could send them.
 */
export function clientIp(c: Context, trustedProxy: TrustedProxy | undefined): string {
  if (trustedProxy === "cloudflare") {
    const header = c.req.header("cf-connecting-ip")?.trim();
    if (header) return header;
  }
  const peer = peerAddress(c);
  if (trustedProxy === "forwarded" && peer !== undefined && isLocalPeer(peer)) {
    const hop = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (hop) return hop;
  }
  return peer ?? "unknown";
}

function peerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // A request made in a test, with no socket.
    return undefined;
  }
}

/** Loopback and the private ranges, where a reverse proxy on this machine or its Docker host is. */
const LOCAL = new BlockList();
LOCAL.addSubnet("127.0.0.0", 8, "ipv4");
LOCAL.addSubnet("10.0.0.0", 8, "ipv4");
LOCAL.addSubnet("172.16.0.0", 12, "ipv4");
LOCAL.addSubnet("192.168.0.0", 16, "ipv4");
LOCAL.addAddress("::1", "ipv6");
LOCAL.addSubnet("fc00::", 7, "ipv6");

function isLocalPeer(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return LOCAL.check(mapped, "ipv4");
  return isIP(address) === 4 ? LOCAL.check(address, "ipv4") : LOCAL.check(address, "ipv6");
}
