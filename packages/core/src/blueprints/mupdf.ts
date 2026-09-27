// The rendering port, implemented with mupdf (WebAssembly): the only module that imports it.
// mupdf is AGPL-3.0, which is why Settle is AGPL too; to swap it for pdftoppm or pdf.js, replace
// this one file. Every mupdf object holds WASM memory until destroy(), so each one is destroyed in
// a finally.
import * as mupdf from "mupdf";
import { CoreError } from "../errors.js";
import type { BlueprintDocument, PdfRenderer, RenderedImage, TextLine } from "../files.js";
import type { BlueprintFileType, Quarter } from "../operations/schemas.js";

const MAGIC: Record<BlueprintFileType, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
};

const NAMES: Record<BlueprintFileType, string> = { pdf: "PDF", png: "PNG", jpeg: "JPEG" };

// mupdf logs format errors and repair warnings to stderr. A file it can't use is refused with a
// message of our own, so its log would only be noise.
mupdf.setLog({ error() {}, warning() {} });

export const mupdfRenderer: PdfRenderer = {
  open(bytes, type) {
    let doc: mupdf.Document;
    try {
      doc = mupdf.Document.openDocument(bytes, MAGIC[type]);
    } catch (error) {
      throw unreadable(type, error);
    }
    try {
      if (doc.needsPassword()) {
        throw new CoreError(
          "unsupported_file",
          "This PDF is password-protected. Save a copy without the password, then upload that.",
        );
      }
      const pageCount = doc.countPages();
      // A truncated PDF is repaired into a document with no pages rather than refused.
      if (pageCount === 0) throw unreadable(type);
      return new MupdfDocument(doc, pageCount);
    } catch (error) {
      doc.destroy();
      throw error instanceof CoreError ? error : unreadable(type, error);
    }
  },

  jpeg(png, quality) {
    const image = new mupdf.Image(png);
    try {
      const pixmap = image.toPixmap();
      try {
        return pixmap.asJPEG(quality);
      } finally {
        pixmap.destroy();
      }
    } finally {
      image.destroy();
    }
  },
};

class MupdfDocument implements BlueprintDocument {
  readonly pageCount: number;
  #doc: mupdf.Document | undefined;

  constructor(doc: mupdf.Document, pageCount: number) {
    this.#doc = doc;
    this.pageCount = pageCount;
  }

  renderPage(
    page: number,
    { longEdge, crop }: { longEdge: number; crop?: Quarter },
  ): RenderedImage {
    return this.#withPage(page, (loaded) => {
      const bounds = loaded.getBounds();
      const region = crop ? quarterOf(bounds, crop) : bounds;
      const scale = longEdge / longSide(region);
      // One rounding rule for whole pages and crops: the origin and the size are each rounded,
      // so the long edge is exactly `longEdge` pixels.
      const x = Math.round(region[0] * scale);
      const y = Math.round(region[1] * scale);
      const box: mupdf.Rect = [
        x,
        y,
        x + Math.round((region[2] - region[0]) * scale),
        y + Math.round((region[3] - region[1]) * scale),
      ];
      const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, box, false);
      try {
        pixmap.clear(255);
        const device = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pixmap);
        try {
          loaded.run(device, mupdf.Matrix.identity);
          device.close();
        } finally {
          device.destroy();
        }
        return { png: pixmap.asPNG(), width: pixmap.getWidth(), height: pixmap.getHeight() };
      } finally {
        pixmap.destroy();
      }
    });
  }

  textLines(page: number, longEdge: number): TextLine[] {
    return this.#withPage(page, (loaded) => {
      const [x0, y0, x1, y1] = loaded.getBounds();
      const scale = longEdge / Math.max(x1 - x0, y1 - y0);
      const text = loaded.toStructuredText("preserve-whitespace");
      try {
        const lines: TextLine[] = [];
        let line: { chars: string[]; bbox: mupdf.Rect; dir: mupdf.Point; size: number } | undefined;
        text.walk({
          beginLine(bbox, _wmode, dir) {
            line = { chars: [], bbox, dir, size: 0 };
          },
          onChar(char, _origin, _font, size) {
            if (!line) return;
            line.chars.push(char);
            line.size = Math.max(line.size, size);
          },
          endLine() {
            const joined = line?.chars.join("").trim();
            if (line && joined) {
              const [a, b, c, d] = line.bbox;
              lines.push({
                text: joined,
                bbox: [
                  round((a - x0) * scale, 1),
                  round((b - y0) * scale, 1),
                  round((c - x0) * scale, 1),
                  round((d - y0) * scale, 1),
                ],
                size: round(line.size, 2),
                dir: [round(line.dir[0], 3), round(line.dir[1], 3)],
              });
            }
            line = undefined;
          },
        });
        return lines;
      } finally {
        text.destroy();
      }
    });
  }

  close(): void {
    this.#doc?.destroy();
    this.#doc = undefined;
  }

  #withPage<T>(page: number, use: (loaded: mupdf.Page) => T): T {
    if (!this.#doc) throw new Error("This Blueprint document is closed");
    if (!Number.isInteger(page) || page < 1 || page > this.pageCount) {
      throw new RangeError(`Page ${page} is not in a document of ${this.pageCount} pages`);
    }
    const loaded = this.#doc.loadPage(page - 1);
    try {
      return use(loaded);
    } finally {
      loaded.destroy();
    }
  }
}

function quarterOf([x0, y0, x1, y1]: mupdf.Rect, quarter: Quarter): mupdf.Rect {
  const midX = (x0 + x1) / 2;
  const midY = (y0 + y1) / 2;
  const left = quarter.endsWith("left");
  const top = quarter.startsWith("top");
  return [left ? x0 : midX, top ? y0 : midY, left ? midX : x1, top ? midY : y1];
}

function longSide([x0, y0, x1, y1]: mupdf.Rect): number {
  return Math.max(x1 - x0, y1 - y0);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor || 0;
}

function unreadable(type: BlueprintFileType, cause?: unknown): CoreError {
  const detail = cause instanceof Error ? ` (${cause.message})` : "";
  return new CoreError(
    "no_pages",
    `This file has no pages to show: it could not be read as a ${NAMES[type]}${detail}. It may be ` +
      "truncated or damaged; export or download it again, then upload the new copy.",
  );
}
