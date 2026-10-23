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
 * one IP trying many emails.
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

  fail(ip: string, key: string): void {
    const now = this.#now();
    this.#count(this.#pairs, pairKey(ip, key), this.#limits.perPair, now);
    this.#count(this.#ips, ip, this.#limits.perIp, now);
  }

  /** A success clears the pair's failures; the IP's stay, so many emails still count. */
  succeed(ip: string, key: string): void {
    this.#pairs.delete(pairKey(ip, key));
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

/** "in 12 minutes", "in 3 hours": how long until `at`, in words, rounded up. */
export function inWords(at: number, now: number = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((at - now) / MINUTE));
  if (minutes < 90) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `in ${hours} hours`;
}

/** Where the client IP comes from: Cloudflare's header, or the socket. */
export type TrustedProxy = "cloudflare" | undefined;

/**
 * The visitor's IP. Behind Cloudflare (SETTLE_TRUSTED_PROXY=cloudflare), from CF-Connecting-IP,
 * since every request arrives from the proxy's address; otherwise the socket's, and the header is
 * ignored, since anyone could send it.
 */
export function clientIp(c: Context, trustedProxy: TrustedProxy): string {
  if (trustedProxy === "cloudflare") {
    const header = c.req.header("cf-connecting-ip")?.trim();
    if (header) return header;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // A request made in a test, with no socket.
    return "unknown";
  }
}
