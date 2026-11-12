// The image port's own rules, written against a real HTTP server on loopback, reached through a
// lookup that sends every name there: what it validates, in what order, that the 2 MB cap is
// enforced while reading rather than trusted from content-length, and that each hop is dialled
// through the guarded lookup. No test reaches the network. The guard itself is tested with the
// real fetcher, whose lookup refuses loopback.
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreError } from "./errors.js";
import {
  createImageFetcher,
  isPdf,
  MAX_IMAGE_BYTES,
  nodeImageFetcher,
  sniffImageType,
} from "./images.js";

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = bytes([0x52, 0x49, 0x46, 0x46, 0x20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const HTML = new TextEncoder().encode("<!doctype html><html>Are you a robot?</html>");

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/**
 * The one refusal for everything that happens once a request is sent: it never says what
 * answered, or whether anything did, so the fetch can't map the server's own network.
 */
const COULD_NOT_FETCH =
  "Couldn't fetch an image from that address. Save the picture from the shop's page, then " +
  "paste it or choose the file instead.";

type Route = (response: ServerResponse) => void;

/** What the server answers at each path, and each request it was sent, in order. */
let routes: Record<string, Route>;
let requests: { host: string; path: string; headers: IncomingHttpHeaders }[];
let port: number;
const server = createServer((request, response) => {
  requests.push({
    host: request.headers.host ?? "",
    path: request.url ?? "",
    headers: request.headers,
  });
  const route = routes[request.url ?? ""];
  if (route) route(response);
  else response.writeHead(404).end();
});

/** DNS that sends every name to the test server, as a public shop's would to the shop. */
const toTestServer: LookupFunction = (_hostname, options, callback) => {
  if (options.all) {
    (callback as never as (e: null, a: { address: string; family: number }[]) => void)(null, [
      { address: "127.0.0.1", family: 4 },
    ]);
  } else callback(null, "127.0.0.1", 4);
};
const fetchImage = createImageFetcher({ lookup: toTestServer });

/** A URL on the test server, under a public-looking name. */
const at = (path: string, host = "shop.example") => `http://${host}:${port}${path}`;

function answer(body: Uint8Array, init: { status?: number; type?: string | null } = {}): Route {
  return (response) => {
    response.writeHead(
      init.status ?? 200,
      init.type === null ? {} : { "content-type": init.type ?? "image/jpeg" },
    );
    // In 64 KB chunks, as a real answer arrives.
    for (let start = 0; start < body.length; start += 65536) {
      response.write(body.subarray(start, start + 65536));
    }
    response.end();
  };
}

function redirect(location: string, status = 302): Route {
  return (response) => response.writeHead(status, { location }).end();
}

beforeEach(async () => {
  routes = {};
  requests = [];
  if (!server.listening)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => server.close());

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

describe("isPdf", () => {
  const text = (value: string) => new TextEncoder().encode(value);

  it("takes bytes that begin with %PDF-, after any whitespace", () => {
    expect(isPdf(text("%PDF-1.7\n%âãÏÓ\n"))).toBe(true);
    expect(isPdf(text("\r\n \t%PDF-1.4\n"))).toBe(true);
  });

  it("refuses an HTML page that only mentions %PDF- further in, so it is never served as a PDF", () => {
    expect(isPdf(text("<!doctype html><!-- %PDF-1.7 --><script>alert(1)</script>"))).toBe(false);
    expect(isPdf(HTML)).toBe(false);
  });
});

describe("the image fetch", () => {
  it("stores what the bytes say they are, whatever the URL's extension claims", async () => {
    routes["/falabellaPE/1_01/public"] = answer(WEBP, { type: "image/jpeg" });
    // Falabella's URLs carry no extension at all, and one path serves JPEG on one host and WebP
    // on another, so the sniffed type wins over both the URL and the content-type.
    const image = await fetchImage(at("/falabellaPE/1_01/public", "media.example.pe"));
    expect(image.type).toBe("image/webp");
    expect(image.bytes).toEqual(WEBP);
  });

  it("sends Settle's own User-Agent", async () => {
    routes["/rug.png"] = answer(PNG, { type: "image/png" });
    await fetchImage(at("/rug.png"));
    expect(requests[0]?.headers["user-agent"]).toBe(
      "Settle/1.0 (+https://github.com/alexzfe/settle)",
    );
  });

  it("follows a redirect by hand, relative or absolute, to a public address", async () => {
    routes["/rug"] = redirect("/cdn/rug.png", 301);
    routes["/cdn/rug.png"] = redirect(at("/rug.png", "cdn.example"));
    routes["/rug.png"] = answer(PNG);
    const image = await fetchImage(at("/rug"));
    expect(image.type).toBe("image/png");
    expect(requests.map(({ host, path }) => `${host.split(":")[0]}${path}`)).toEqual([
      "shop.example/rug",
      "shop.example/cdn/rug.png",
      "cdn.example/rug.png",
    ]);
  });

  it("refuses a redirect into the server's own network without dialling it", async () => {
    routes["/rug.jpg"] = answer(JPEG);
    for (const location of [
      "http://169.254.169.254/latest/meta-data/",
      `http://127.0.0.1:${port}/rug.jpg`,
      `http://[::1]:${port}/rug.jpg`,
      "file:///etc/passwd",
    ]) {
      requests = [];
      routes["/go"] = redirect(location);
      const error = await refusal(fetchImage(at("/go")));
      expect(error.message, location).toBe(COULD_NOT_FETCH);
      expect(
        requests.map(({ path }) => path),
        location,
      ).toEqual(["/go"]);
    }
  });

  it("gives up after five redirects", async () => {
    routes["/loop"] = redirect("/loop");
    expect((await refusal(fetchImage(at("/loop")))).message).toBe(COULD_NOT_FETCH);
    expect(requests).toHaveLength(6);
  });

  it("never dials a private, loopback, link-local or metadata address", async () => {
    routes["/rug.jpg"] = answer(JPEG);
    for (const url of [
      `http://127.0.0.1:${port}/rug.jpg`,
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/rug.jpg",
      "http://192.168.1.1/rug.jpg",
      "http://100.100.100.100/rug.jpg",
      `http://[::1]:${port}/rug.jpg`,
      `http://[::ffff:127.0.0.1]:${port}/rug.jpg`,
      `http://0x7f000001:${port}/rug.jpg`,
      `http://0:${port}/rug.jpg`,
    ]) {
      expect((await refusal(fetchImage(url))).message, url).toBe(COULD_NOT_FETCH);
    }
    expect(requests).toEqual([]);
  });

  it("refuses a name that resolves to a private address, at connect time, without a request", async () => {
    // The real fetcher: localhost resolves to loopback, so its lookup must refuse it before any
    // request reaches the server listening there.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    routes["/rug.jpg"] = answer(JPEG);
    const error = await refusal(nodeImageFetcher(at("/rug.jpg", "localhost")));
    expect(error.message).toBe(COULD_NOT_FETCH);
    expect(requests).toEqual([]);
  });

  it("refuses anything but a 200, without saying what answered", async () => {
    routes["/gone.jpg"] = answer(JPEG, { status: 404 });
    expect((await refusal(fetchImage(at("/gone.jpg")))).message).toBe(COULD_NOT_FETCH);
  });

  it("refuses a content-type that is not an image", async () => {
    routes["/wall"] = answer(HTML, { type: "text/html" });
    expect((await refusal(fetchImage(at("/wall")))).message).toBe(COULD_NOT_FETCH);
  });

  it("refuses a bot wall that calls itself an image, which only the magic number catches", async () => {
    routes["/rug.jpg"] = answer(HTML, { type: "image/jpeg" });
    expect((await refusal(fetchImage(at("/rug.jpg")))).message).toBe(COULD_NOT_FETCH);
  });

  it("stops at the cap while reading, with no content-length to trust", async () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1024);
    huge.set(JPEG);
    routes["/huge.jpg"] = answer(huge);
    expect((await refusal(fetchImage(at("/huge.jpg")))).message).toBe(COULD_NOT_FETCH);
  });

  it("takes an image right up to the cap", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES);
    big.set(JPEG);
    routes["/big.jpg"] = answer(big);
    expect((await fetchImage(at("/big.jpg"))).bytes.length).toBe(MAX_IMAGE_BYTES);
  });

  it("refuses a URL that is not http or https, and one that is no URL at all", async () => {
    expect((await refusal(fetchImage("file:///etc/passwd"))).message).toContain(
      "Only http and https",
    );
    expect((await refusal(fetchImage("not a url"))).message).toContain("is not a URL");
    expect(requests).toEqual([]);
  });

  it("logs why a fetch failed for the operator, and keeps it off the refusal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Nothing listens on the port the server had before it closed.
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port: deadPort } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));

    const error = await refusal(fetchImage(`http://nowhere.example:${deadPort}/rug.jpg`));

    expect(error.message).toBe(COULD_NOT_FETCH);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0])).toContain("ECONNREFUSED");
    expect(String(warn.mock.calls[0])).toContain(`http://nowhere.example:${deadPort}/rug.jpg`);
  });
});
