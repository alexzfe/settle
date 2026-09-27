import { CoreError } from "./errors.js";

// The image port: core's only way out to the network, and deliberately so. Core otherwise binds
// loopback and makes no model calls; it fetches a Listing's product photo itself only because the
// alternatives were worse (base64 bytes in an MCP argument spend the Agent's context once per
// Listing, and hand uploads put the chore back on the user). It fetches the photo from the
// retailer's CDN and hands back validated bytes. The fetch is best-effort: a failure never fails
// record_listing, which keeps the link instead. Tests inject a fake, so no test ever touches the
// network.
//
// Measured against 8 of 8 real Amazon and Falabella images, fetched with no request headers at
// all: 13-397 KB each, at about 110 ms and no redirects. What that measurement found shapes the
// code below: the type must be sniffed from the bytes, because Falabella's image URLs have no
// extension and one path serves JPEG on one host and WebP on another; and a bot wall arrives as
// HTML behind a 200, which only the magic number catches.

/** The image types the platform stores, as their media types. */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** Validated image bytes, with the type read out of the bytes themselves. */
export interface FetchedImage {
  bytes: Uint8Array;
  type: PhotoType;
}

/**
 * Fetches one image URL. Refuses with a CoreError saying what went wrong — the paste box reports
 * it, since the user is waiting on it, while record_listing swallows it and keeps the link.
 */
export type ImageFetcher = (url: string) => Promise<FetchedImage>;

/** Nothing bigger is stored. The worst case measured across every variant probed was 624 KB. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
/**
 * Names Settle honestly, with a link to what it is. The retailers measured served byte-identical
 * images with no user-agent at all, so nothing would be gained by posing as a browser.
 */
const USER_AGENT = "Settle/1.0 (+https://github.com/alexzfe/settle)";

/** Enough bytes to tell a WebP apart: "RIFF", four of length, then "WEBP". */
const SNIFF_BYTES = 12;

/**
 * The type the bytes themselves say they are, or undefined when they are not one of the three.
 * The URL is never consulted: Falabella's image URLs carry no extension at all.
 */
export function sniffImageType(bytes: Uint8Array): PhotoType | undefined {
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (
    starts(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    starts(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  )
    return "image/webp";
  return undefined;
}

function starts(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * The real fetcher, on global fetch: a browser User-Agent, an 8 s timeout, redirects followed,
 * and the 2 MB cap enforced while reading, because content-length can lie or be absent. Validated
 * in order — status 200, an image/* content-type, a JPEG, PNG, or WebP magic number, within the
 * cap — and nothing is returned unless all four pass.
 */
export const nodeImageFetcher: ImageFetcher = async (url) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw refuse(`"${url}" is not a URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw refuse(`Only http and https images can be fetched, not ${parsed.protocol}//.`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "user-agent": USER_AGENT },
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (error) {
      const why = controller.signal.aborted ? "it timed out" : reason(error);
      throw refuse(`The image at ${url} could not be fetched: ${why}.`);
    }
    if (response.status !== 200) {
      throw refuse(`The image at ${url} answered ${response.status}, not 200.`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw refuse(
        `${url} answered ${contentType || "no content type"}, not an image. A shop that ` +
          "challenges automated requests answers a web page here.",
      );
    }
    return await read(response, url);
  } finally {
    clearTimeout(timer);
  }
};

/** Reads the body, sniffing as soon as there are bytes to sniff and stopping at the cap. */
async function read(response: Response, url: string): Promise<FetchedImage> {
  const reader = response.body?.getReader();
  if (!reader) throw refuse(`The image at ${url} answered no body.`);
  const chunks: Uint8Array[] = [];
  let length = 0;
  let type: PhotoType | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
    if (length > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw refuse(
        `The image at ${url} is over ${Math.round(MAX_IMAGE_BYTES / 1024)} KB, the most the app ` +
          "stores.",
      );
    }
    if (!type && length >= SNIFF_BYTES) {
      type = sniffImageType(join(chunks, length));
      if (!type) {
        await reader.cancel();
        throw notAnImage(url);
      }
    }
  }
  const bytes = join(chunks, length);
  type ??= sniffImageType(bytes);
  if (!type) throw notAnImage(url);
  return { bytes, type };
}

function join(chunks: Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

function notAnImage(url: string): CoreError {
  return refuse(`What ${url} answered is not a JPEG, PNG, or WebP, whatever it calls itself.`);
}

function refuse(message: string): CoreError {
  return new CoreError("validation", message);
}

function reason(error: unknown): string {
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  const message = cause instanceof Error ? cause.message : (error as Error)?.message;
  return message ? message.toLowerCase() : "the request failed";
}
