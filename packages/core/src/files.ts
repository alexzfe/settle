import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BlueprintFileType, Quarter } from "./operations/schemas.js";

/**
 * The file store seam: core's only way to the disk. The Home Folder writer uses the text half;
 * Blueprint uploads and their rendered pages use the binary half.
 */
export interface FileStore {
  /** The file's text, or undefined when there is no such file. */
  readText(path: string): string | undefined;
  /** Writes the file, creating its folder and any missing parents. */
  writeText(path: string, text: string): void;
  /** The file's bytes, or undefined when there is no such file. */
  readBytes(path: string): Uint8Array | undefined;
  /** Writes the file, creating its folder and any missing parents. */
  writeBytes(path: string, bytes: Uint8Array): void;
}

export const nodeFileStore: FileStore = {
  readText(path) {
    return missingAsUndefined(() => readFileSync(path, "utf8"));
  },
  writeText(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
  readBytes(path) {
    return missingAsUndefined(() => new Uint8Array(readFileSync(path)));
  },
  writeBytes(path, bytes) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  },
};

function missingAsUndefined<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// ─── The rendering port ─────────────────────────────────────────────────────────────────────
//
// Turns a Blueprint file into page images and text lines. One implementation, with mupdf, in
// blueprints/mupdf.ts: the only module that imports it, so it can be swapped for pdftoppm or pdfjs
// (mupdf is AGPL; docs/research/spikes/3-pdf-to-png.md). Pages are numbered from 1, and sizes are
// in the page's displayed orientation, after any /Rotate.

/** One line of a page's text layer. `bbox` is [x0, y0, x1, y1] in the rendered page's pixels. */
export interface TextLine {
  text: string;
  bbox: [number, number, number, number];
  /** The font size, in points. */
  size: number;
  /** The writing direction: [1, 0] left to right, [0, -1] upward. */
  dir: [number, number];
}

export interface RenderedImage {
  png: Uint8Array;
  width: number;
  height: number;
}

/** An open Blueprint file. Every call after close() throws. */
export interface BlueprintDocument {
  /** Never 0: a file with no pages is refused when it is opened. */
  readonly pageCount: number;
  /**
   * The page as a PNG with its long edge at `longEdge` pixels; with `crop`, only that quarter of
   * the page, at twice the scale, so the quarter's long edge is `longEdge`.
   */
  renderPage(page: number, options: { longEdge: number; crop?: Quarter }): RenderedImage;
  /** The page's text layer, with boxes in the pixels of a render at `longEdge`; [] for a scan. */
  textLines(page: number, longEdge: number): TextLine[];
  /** Frees everything the file holds. */
  close(): void;
}

export interface PdfRenderer {
  /**
   * Opens a PDF, PNG, or JPEG through the same call: an image is a one-page document. Refuses a
   * file that can't be read or has no pages with the CoreError no_pages, and a password-protected
   * PDF with unsupported_file.
   */
  open(bytes: Uint8Array, type: BlueprintFileType): BlueprintDocument;
  /** Re-encodes a PNG as a JPEG of `quality` (0-100). */
  jpeg(png: Uint8Array, quality: number): Uint8Array;
}
