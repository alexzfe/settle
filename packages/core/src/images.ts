import { createHash } from "node:crypto";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import type { LookupFunction } from "node:net";
import { CoreError } from "./errors.js";
import { hostBlocked, safeLookup } from "./private-addresses.js";

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

/** The extension a stored image is saved under, by its sniffed type. */
export const PHOTO_EXTENSIONS: Record<PhotoType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Changes exactly when the bytes do, which is all the browser cache needs of it. */
export function imageVersion(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/**
 * Uploaded image bytes, validated by the bytes themselves exactly as a fetched image is. `name`
 * says what was too big. With `heic`, HEIF bytes are refused by name, as Blueprints refuse them.
 */
export function uploadedImage(
  file: Uint8Array,
  { name = "That picture", heic = false }: { name?: string; heic?: boolean } = {},
): FetchedImage {
  if (file.length > MAX_IMAGE_BYTES) {
    throw new CoreError(
      "validation",
      `${name} is over ${Math.round(MAX_IMAGE_BYTES / 1024)} KB, the most the app stores.`,
    );
  }
  const type = sniffImageType(file);
  if (!type) {
    if (heic && isHeif(file)) throw new CoreError("unsupported_file", heicMessage(name));
    throw new CoreError(
      "unsupported_file",
      "That file is not a JPEG, PNG, or WebP, whatever it is called.",
    );
  }
  return { bytes: file, type };
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** Whether the bytes are a HEIF image, as an iPhone saves its photos: "ftyp" and a HEIF brand. */
export function isHeif(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(4, 12));
  return head.slice(0, 4) === "ftyp" && HEIF_BRANDS.has(head.slice(4, 8));
}

/**
 * A PNG's or JPEG's size in pixels, read from its header without decoding it: the PNG's IHDR, or
 * the JPEG's first frame header. Undefined for anything else, or a header too short to say.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (sniffImageType(bytes) === "image/png") {
    if (bytes.length < 24) return undefined;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (sniffImageType(bytes) !== "image/jpeg") return undefined;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] as number;
    if (marker === 0xff) {
      at++; // fill byte
      continue;
    }
    // Standalone markers: TEM and RST0-7 carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return undefined; // scan or end before any frame
    const length = view.getUint16(at + 2);
    // SOF0-15, less DHT (C4), JPG (C8) and DAC (CC): precision, then height and width.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (at + 9 > bytes.length) return undefined;
      return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
    }
    at += 2 + length;
  }
  return undefined;
}

/**
 * Whether the bytes are a PDF: "%PDF-" at the start, after any whitespace. Anything else before it
 * is refused, so a page that only mentions "%PDF-" (an HTML file in a comment, say) is never
 * stored and served back as a PDF.
 */
export function isPdf(bytes: Uint8Array): boolean {
  return /^\s*%PDF-/.test(new TextDecoder("latin1").decode(bytes.subarray(0, 1024)));
}

/** The refusal of a HEIC image, which `name` is; `otherwise` offers another way, after a comma. */
export function heicMessage(name: string, otherwise?: string): string {
  return (
    `${name} is a HEIC image, which the app can't read yet. Export it as a JPEG (most photo ` +
    `apps can)${otherwise ? `, or ${otherwise}` : ""}.`
  );
}

function starts(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * The most redirects followed. Measured shops answered with none; a CDN that hops through a
 * tracking link or two still fits.
 */
const MAX_REDIRECTS = 5;

/**
 * What the user can do instead, at the paste box. A caller speaking to someone else, as
 * record_listing's receipt speaks to the Agent, swaps it for its own.
 */
export const PASTE_INSTEAD =
  "Save the picture from the shop's page, then paste it or choose the file instead.";

/**
 * The one refusal for anything that goes wrong once a request is sent. It never says what
 * answered, or whether anything did: a status, a content type or "connection refused" would map
 * the server's own network for whoever chose the URL. The reason goes to the server's log.
 */
const COULD_NOT_FETCH = `Couldn't fetch an image from that address. ${PASTE_INSTEAD}`;

/** Why the fetch stopped: logged for the operator, never put in the refusal. */
class FetchFailed extends Error {}

/**
 * The real fetcher, on node:http and node:https as the CIMD fetch in the server's oauth.ts is,
 * with every connection dialled through `lookup`, which refuses private, loopback, link-local and
 * metadata addresses: a URL any user or a product page the Agent read names must never reach
 * inside the server's own network. The check is made as each connection is dialled, so a DNS
 * answer can't change between it and the dial. An address literal is refused before dialling,
 * since it needs no lookup, and redirects are followed by hand, each hop checked the same way.
 * Then an 8 s timeout over every hop, and the 2 MB cap enforced while reading, because
 * content-length can lie or be absent. Validated in order — status 200, an image/* content-type,
 * a JPEG, PNG, or WebP magic number, within the cap — and nothing is returned unless all four
 * pass. `lookup` is a seam for the tests, which send every name to a server on loopback.
 */
export function createImageFetcher({
  lookup = safeLookup,
}: {
  lookup?: LookupFunction;
} = {}): ImageFetcher {
  return async (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw refuse(`"${url}" is not a URL.`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw refuse(`Only http and https images can be fetched, not ${parsed.protocol}//.`);
    }
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      return await read(await follow(parsed, lookup, signal));
    } catch (error) {
      if (error instanceof CoreError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Couldn't fetch a Listing picture from ${url}: ${reason}`);
      throw refuse(COULD_NOT_FETCH);
    }
  };
}

export const nodeImageFetcher: ImageFetcher = createImageFetcher();

/** The final answer at `url`, following redirects by hand and checking each hop's address. */
async function follow(
  url: URL,
  lookup: LookupFunction,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  let next = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new FetchFailed(`a redirect to ${next.protocol}//`);
    }
    if (hostBlocked(next)) throw new FetchFailed(`${next.hostname} is a private address`);
    const response = await get(next, lookup, signal);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status < 300 || status > 399 || location === undefined) {
      if (status !== 200) {
        response.destroy();
        throw new FetchFailed(`it answered ${status}`);
      }
      const contentType = response.headers["content-type"] ?? "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        response.destroy();
        throw new FetchFailed(`it answered ${contentType || "no content-type"}`);
      }
      return response;
    }
    response.destroy();
    next = new URL(location, next);
  }
  throw new FetchFailed(`more than ${MAX_REDIRECTS} redirects`);
}

/** One GET, dialled through `lookup`, answering once the headers have arrived. */
function get(url: URL, lookup: LookupFunction, signal: AbortSignal): Promise<IncomingMessage> {
  const request = url.protocol === "https:" ? httpsGet : httpGet;
  return new Promise((resolve, reject) => {
    request(url, { lookup, signal, headers: { "user-agent": USER_AGENT } }, resolve).on(
      "error",
      reject,
    );
  });
}

/** Reads the body, sniffing as soon as there are bytes to sniff and stopping at the cap. */
async function read(response: IncomingMessage): Promise<FetchedImage> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  let type: PhotoType | undefined;
  try {
    for await (const chunk of response as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      length += chunk.length;
      if (length > MAX_IMAGE_BYTES) throw new FetchFailed("it is over the cap");
      if (!type && length >= SNIFF_BYTES) {
        type = sniffImageType(join(chunks, length));
        if (!type) throw new FetchFailed("it is not a JPEG, PNG, or WebP");
      }
    }
  } finally {
    response.destroy();
  }
  const bytes = join(chunks, length);
  type ??= sniffImageType(bytes);
  if (!type) throw new FetchFailed("it is not a JPEG, PNG, or WebP");
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

function refuse(message: string): CoreError {
  return new CoreError("validation", message);
}
