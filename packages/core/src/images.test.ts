// The image port's own rules, written against a stubbed global fetch so no test ever reaches the
// network: what it validates, in what order, and that the 2 MB cap is enforced while reading
// rather than trusted from content-length (docs/adr/0005-core-fetches-listing-images.md,
// docs/research/spikes/5-listing-image-fetch.md).
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreError } from "./errors.js";
import { MAX_IMAGE_BYTES, nodeImageFetcher, sniffImageType } from "./images.js";

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = bytes([0x52, 0x49, 0x46, 0x46, 0x20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const HTML = new TextEncoder().encode("<!doctype html><html>Are you a robot?</html>");

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** A response whose body arrives in 64 KB chunks, as a real one does. */
function answer(body: Uint8Array, init: { status?: number; type?: string | null } = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < body.length; at += 65536) {
        controller.enqueue(body.subarray(at, at + 65536));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: init.status ?? 200,
    headers: init.type === null ? {} : { "content-type": init.type ?? "image/jpeg" },
  });
}

function serves(response: Response | Error): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected the fetch to be refused, but it succeeded");
}

describe("sniffImageType", () => {
  it("reads the type out of the bytes, never out of the URL", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(HTML)).toBeUndefined();
    // RIFF, but not a WebP: a WAV file says RIFF too.
    expect(
      sniffImageType(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])),
    ).toBe(undefined);
    expect(sniffImageType(new Uint8Array())).toBeUndefined();
  });
});

describe("the image fetch", () => {
  it("stores what the bytes say they are, whatever the URL's extension claims", async () => {
    serves(answer(WEBP, { type: "image/jpeg" }));
    // Falabella's URLs carry no extension at all, and one path serves JPEG on one host and WebP
    // on another, so the sniffed type wins over both the URL and the content-type.
    const image = await nodeImageFetcher("https://media.example.pe/falabellaPE/1_01/public");
    expect(image.type).toBe("image/webp");
    expect(image.bytes).toEqual(WEBP);
  });

  it("sends a browser User-Agent and follows redirects", async () => {
    serves(answer(PNG, { type: "image/png" }));
    await nodeImageFetcher("https://shop.example/rug.png");
    const [, init] = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("Mozilla/5.0");
    expect(init.redirect).toBe("follow");
  });

  it("refuses anything but a 200", async () => {
    serves(answer(JPEG, { status: 404 }));
    expect((await refusal(nodeImageFetcher("https://shop.example/gone.jpg"))).message).toContain(
      "answered 404",
    );
  });

  it("refuses a content-type that is not an image, before it reads a byte", async () => {
    serves(answer(HTML, { type: "text/html" }));
    expect((await refusal(nodeImageFetcher("https://shop.example/wall"))).message).toContain(
      "not an image",
    );
  });

  it("refuses a bot wall that calls itself an image, which only the magic number catches", async () => {
    serves(answer(HTML, { type: "image/jpeg" }));
    expect((await refusal(nodeImageFetcher("https://shop.example/rug.jpg"))).message).toContain(
      "not a JPEG, PNG, or WebP",
    );
  });

  it("stops at the cap while reading, whatever content-length says", async () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1024);
    huge.set(JPEG);
    const response = answer(huge);
    // A lying content-length is exactly the case the cap must survive.
    response.headers.set("content-length", "1234");
    serves(response);
    expect((await refusal(nodeImageFetcher("https://shop.example/huge.jpg"))).message).toContain(
      "over 2048 KB",
    );
  });

  it("takes an image right up to the cap", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES);
    big.set(JPEG);
    serves(answer(big));
    expect((await nodeImageFetcher("https://shop.example/big.jpg")).bytes.length).toBe(
      MAX_IMAGE_BYTES,
    );
  });

  it("refuses a URL that is not http or https, and one that is no URL at all", async () => {
    serves(answer(JPEG));
    expect((await refusal(nodeImageFetcher("file:///etc/passwd"))).message).toContain(
      "Only http and https",
    );
    expect((await refusal(nodeImageFetcher("not a url"))).message).toContain("is not a URL");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("turns a network failure into a refusal that says so", async () => {
    serves(new TypeError("fetch failed"));
    expect((await refusal(nodeImageFetcher("https://nowhere.example/rug.jpg"))).message).toContain(
      "could not be fetched",
    );
  });
});
