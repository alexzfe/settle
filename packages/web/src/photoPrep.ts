// A Photo is made ready in the browser before it is sent: core has no image library for Photos
// and caps an upload at 2 MB, and a phone photo is 3–8 MB. The picture is redrawn upright at a
// long edge of 1600 px as a JPEG, with a 320 px thumbnail for the lists. Redrawing also drops the
// file's metadata, the GPS position of the user's home among it, which is wanted. The one fact
// kept is the day it was taken, read from the EXIF before anything is redrawn.

export const PHOTO_EDGE = 1600;
export const PHOTO_QUALITY = 0.8;
export const THUMB_EDGE = 320;
export const THUMB_QUALITY = 0.75;

export interface PreparedPhoto {
  /** The Photo itself: at most 1600 px on its long edge, as a JPEG. */
  file: Blob;
  thumb: Blob;
  /** When it was taken, YYYY-MM-DD, when the file says. */
  takenOn?: string;
}

/**
 * The picked file as core takes it: the date it was taken, then the Photo and its thumbnail. A
 * file the browser cannot decode (a HEIC in a browser without HEIC) goes as it is, as both, so
 * core's refusal, which names HEIC and says what to do, is the one the user reads.
 */
export async function preparePhoto(picked: File): Promise<PreparedPhoto> {
  const takenOn = await takenOnOf(picked);
  const dated = takenOn ? { takenOn } : {};
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(picked, { imageOrientation: "from-image" });
  } catch {
    return { file: picked, thumb: picked, ...dated };
  }
  try {
    // The thumbnail is drawn from the 1600 px canvas: a smaller step down, and a sharper result.
    const full = drawn(bitmap, PHOTO_EDGE);
    const file = await jpeg(full, PHOTO_QUALITY);
    const thumb = await jpeg(drawn(full, THUMB_EDGE), THUMB_QUALITY);
    return { file, thumb, ...dated };
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

function drawn(source: ImageBitmap | HTMLCanvasElement, edge: number): HTMLCanvasElement {
  const { width, height } = fitWithin(source.width, source.height, edge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the photo.");
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
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
