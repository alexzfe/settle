// A Photo is made ready in the browser before it is sent: core has no image library for Photos
// and caps an upload at 2 MB, and a phone photo is 3–8 MB. The picture is redrawn upright at a
// long edge of 1600 px as a JPEG, with a 320 px thumbnail for the lists. Redrawing also drops the
// file's metadata, the GPS position of the user's home among it, which is wanted. The one fact
// kept is the day it was taken, read from the EXIF before anything is redrawn. A crop the user
// drew is cut from the decoded picture before it is shrunk, so a tight crop keeps its detail.
// A Document's image is redrawn the same way, larger and finer, so a receipt's small print stays
// readable, and with neither a thumbnail nor a date.

export const PHOTO_EDGE = 1600;
export const PHOTO_QUALITY = 0.8;
export const THUMB_EDGE = 320;
export const THUMB_QUALITY = 0.75;
export const DOCUMENT_EDGE = 2400;
export const DOCUMENT_QUALITY = 0.85;

export interface PreparedPhoto {
  /** The Photo itself: at most 1600 px on its long edge, as a JPEG. */
  file: Blob;
  thumb: Blob;
  /** When it was taken, YYYY-MM-DD, when the file says. */
  takenOn?: string;
  /** The whole picture's size, upright, when it could be decoded: what a crop is measured in. */
  size?: { width: number; height: number };
}

/** A Document's image: at most 2400 px on its long edge, as a JPEG. */
export interface PreparedImage {
  file: Blob;
  /** The whole picture's size, upright, when it could be decoded: what a crop is measured in. */
  size?: { width: number; height: number };
}

/** A rectangle of the picture to keep, in its own pixels, upright. */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The picked file as core takes it: the date it was taken, then the Photo and its thumbnail, cut
 * to `crop` when one is given. A file the browser cannot decode (a HEIC in a browser without
 * HEIC) goes as it is, as both, so core's refusal, which names HEIC and says what to do, is the
 * one the user reads.
 */
export async function preparePhoto(picked: File, crop?: CropArea): Promise<PreparedPhoto> {
  const takenOn = await takenOnOf(picked);
  const dated = takenOn ? { takenOn } : {};
  // The thumbnail is drawn from the 1600 px canvas: a smaller step down, and a sharper result.
  const redrawn = await redraw(picked, PHOTO_EDGE, PHOTO_QUALITY, crop, async (full) => ({
    thumb: await jpeg(drawn(full, THUMB_EDGE), THUMB_QUALITY),
  }));
  return redrawn ? { ...redrawn, ...dated } : { file: picked, thumb: picked, ...dated };
}

/**
 * A Document's image as core takes it, cut to `crop` when one is given. A file the browser cannot
 * decode goes as it is, for core to refuse by name, as a Photo's does.
 */
export async function prepareDocumentImage(picked: File, crop?: CropArea): Promise<PreparedImage> {
  const redrawn = await redraw(picked, DOCUMENT_EDGE, DOCUMENT_QUALITY, crop, async () => ({}));
  return redrawn ?? { file: picked };
}

/**
 * The picture decoded upright, cut to `crop`, and saved as a JPEG at most `edge` on its long side,
 * with whatever `more` makes from that canvas; nothing when the browser cannot decode it.
 */
async function redraw<More>(
  picked: File,
  edge: number,
  quality: number,
  crop: CropArea | undefined,
  more: (full: HTMLCanvasElement) => Promise<More>,
): Promise<({ file: Blob; size: { width: number; height: number } } & More) | undefined> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(picked, { imageOrientation: "from-image" });
  } catch {
    return undefined;
  }
  try {
    const size = { width: bitmap.width, height: bitmap.height };
    const full = drawn(bitmap, edge, crop && within(crop, size));
    const file = await jpeg(full, quality);
    return { file, size, ...(await more(full)) };
  } finally {
    bitmap.close();
  }
}

/** A width and height scaled to fit `edge` on the long side, never scaled up. */
export function fitWithin(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A crop held to whole pixels inside the picture, at least one pixel each way. */
export function within(crop: CropArea, size: { width: number; height: number }): CropArea {
  const x = Math.min(Math.max(0, Math.round(crop.x)), size.width - 1);
  const y = Math.min(Math.max(0, Math.round(crop.y)), size.height - 1);
  return {
    x,
    y,
    width: Math.min(Math.max(1, Math.round(crop.width)), size.width - x),
    height: Math.min(Math.max(1, Math.round(crop.height)), size.height - y),
  };
}

/** EXIF's "2026:03:14 10:22:01" as "2026-03-14"; nothing for a blank or impossible date. */
export function exifDay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    year > 1900 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return real ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** The day the file says it was taken; nothing when it cannot be read. */
async function takenOnOf(picked: Blob): Promise<string | undefined> {
  try {
    // Loaded only when a photo is added. The lite build reads JPEG and HEIC EXIF without the full
    // build's other formats.
    const { default: exifr } = await import("exifr/dist/lite.esm.mjs");
    const tags: unknown = await exifr.parse(picked, {
      exif: { pick: ["DateTimeOriginal"] },
      gps: false,
      interop: false,
      ifd1: false,
      reviveValues: false,
    });
    return exifDay((tags as { DateTimeOriginal?: unknown } | undefined)?.DateTimeOriginal);
  } catch {
    return undefined;
  }
}

function drawn(
  source: ImageBitmap | HTMLCanvasElement,
  edge: number,
  crop: CropArea = { x: 0, y: 0, width: source.width, height: source.height },
): HTMLCanvasElement {
  const { width, height } = fitWithin(crop.width, crop.height, edge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the photo.");
  context.imageSmoothingQuality = "high";
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  return canvas;
}

function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This browser cannot save the photo."))),
      "image/jpeg",
      quality,
    ),
  );
}
