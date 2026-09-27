// The conversion test: both fixture PDFs through the mupdf renderer, including a /Rotate 90 page
// and an image-only scan.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoreError } from "../errors.js";
import type { BlueprintDocument } from "../files.js";
import { mupdfRenderer } from "./mupdf.js";

const FIXTURES = join(import.meta.dirname, "..", "..", "fixture");
const A3 = readFileSync(join(FIXTURES, "blueprint-a3.pdf"));
const THREE_PAGES = readFileSync(join(FIXTURES, "blueprint-3-pages.pdf"));

/** A PNG's pixel size, from its IHDR chunk. */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const open: BlueprintDocument[] = [];
function openPdf(bytes: Uint8Array): BlueprintDocument {
  const doc = mupdfRenderer.open(bytes, "pdf");
  open.push(doc);
  return doc;
}
afterEach(() => {
  for (const doc of open.splice(0)) doc.close();
});

describe("the mupdf renderer", () => {
  it("renders the A3 plan at 2000 px on its long edge, with its text layer", () => {
    const doc = openPdf(A3);
    const page = doc.renderPage(1, { longEdge: 2000 });
    const lines = doc.textLines(1, 2000);

    expect(doc.pageCount).toBe(1);
    expect([page.width, page.height]).toEqual([2000, 1414]);
    expect([...page.png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(page.png)).toEqual({ width: 2000, height: 1414 });
    expect(lines.some((line) => line.text.includes("3.62 m"))).toBe(true);
    for (const { bbox } of lines) {
      expect(bbox[0]).toBeGreaterThanOrEqual(0);
      expect(bbox[2]).toBeLessThanOrEqual(2000);
      expect(bbox[3]).toBeLessThanOrEqual(1414);
    }
  });

  it("honours /Rotate and finds no text on the scan", () => {
    const doc = openPdf(THREE_PAGES);
    const sizes = [1, 2, 3].map((page) => {
      const { width, height } = doc.renderPage(page, { longEdge: 2000 });
      return [width, height];
    });

    expect(doc.pageCount).toBe(3);
    // Page 1 is A4 portrait; page 2 is stored portrait with /Rotate 90, so it shows landscape.
    expect(sizes).toEqual([
      [1414, 2000],
      [2000, 1414],
      [2000, 1414],
    ]);
    expect(doc.textLines(1, 2000).length).toBeGreaterThan(0);
    // The rotated page's vertical text keeps its direction, with its box in displayed orientation.
    expect(doc.textLines(2, 2000).some((line) => line.dir[0] === 0)).toBe(true);
    expect(doc.textLines(3, 2000)).toEqual([]);
  });

  it("renders a quarter at twice the scale, so it is 2000 px on its long edge too", () => {
    const doc = openPdf(A3);
    for (const crop of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      const quarter = doc.renderPage(1, { longEdge: 2000, crop });
      expect([quarter.width, quarter.height], crop).toEqual([2000, 1414]);
      expect(pngSize(quarter.png), crop).toEqual({ width: 2000, height: 1414 });
    }
  });

  it("opens a PNG and a JPEG through the same call, as one page", () => {
    const png = openPdf(A3).renderPage(1, { longEdge: 1000 }).png;
    const jpeg = mupdfRenderer.jpeg(png, 85);

    const fromPng = mupdfRenderer.open(png, "png");
    const fromJpeg = mupdfRenderer.open(jpeg, "jpeg");
    open.push(fromPng, fromJpeg);

    expect([...jpeg.subarray(0, 3)]).toEqual(JPEG_SIGNATURE);
    for (const doc of [fromPng, fromJpeg]) {
      expect(doc.pageCount).toBe(1);
      const page = doc.renderPage(1, { longEdge: 2000 });
      expect([page.width, page.height]).toEqual([2000, 1414]);
      expect(doc.textLines(1, 2000)).toEqual([]);
    }
  });

  it("refuses a truncated PDF, which repairs to 0 pages, and bytes that are not a PDF", () => {
    const truncated = A3.subarray(0, 600);
    const garbage = new TextEncoder().encode("%PDF-1.7 this is not really a PDF at all");

    for (const bytes of [truncated, garbage]) {
      let refused: unknown;
      try {
        openPdf(bytes);
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(CoreError);
      expect((refused as CoreError).code).toBe("no_pages");
    }
  });

  it("refuses to render after close, and a page out of range", () => {
    const doc = mupdfRenderer.open(A3, "pdf");
    expect(() => doc.renderPage(2, { longEdge: 2000 })).toThrow(RangeError);
    doc.close();
    doc.close();
    expect(() => doc.renderPage(1, { longEdge: 2000 })).toThrow(/closed/);
  });
});
