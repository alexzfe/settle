import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_QUALITY,
  exifDay,
  fitWithin,
  PHOTO_QUALITY,
  prepareDocumentImage,
  preparePhoto,
  THUMB_QUALITY,
} from "./photoPrep";

/**
 * A JPEG holding nothing but an EXIF block with one DateTimeOriginal: a little-endian TIFF whose
 * first directory points to the Exif one, which holds the date as ASCII.
 */
function jpegTakenOn(date: string): Uint8Array<ArrayBuffer> {
  const ascii = new TextEncoder().encode(`${date}\0`);
  const tiff = new Uint8Array(44 + ascii.length);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  view.setUint32(4, 8, true);
  // IFD0: one entry, the pointer to the Exif directory at 26.
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 26, true);
  // The Exif directory: DateTimeOriginal, ASCII, at 44.
  view.setUint16(26, 1, true);
  view.setUint16(28, 0x9003, true);
  view.setUint16(30, 2, true);
  view.setUint32(32, ascii.length, true);
  view.setUint32(36, 44, true);
  tiff.set(ascii, 44);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1, 0xff, 0xd9]);
}

/** What the fake canvas saved: its size and the quality asked for. */
interface Saved {
  width: number;
  height: number;
  type: string;
  quality: number;
}

const saved = new WeakMap<Blob, Saved>();

/** Stands in for the browser's decoder and canvas, which jsdom has not got. */
function stubDrawing(size: { width: number; height: number } | "undecodable") {
  const decode = vi.fn(async () => {
    if (size === "undecodable") throw new DOMException("The source image cannot be decoded.");
    return { ...size, close: vi.fn() };
  });
  vi.stubGlobal("createImageBitmap", decode);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type = "image/png",
    quality = 0,
  ) {
    const blob = new Blob(["x"], { type });
    saved.set(blob, { width: this.width, height: this.height, type, quality });
    callback(blob);
  });
  return { decode, drawImage };
}

const picked = (bytes: BlobPart = "not really a photo") =>
  new File([bytes], "IMG_0001.jpg", { type: "image/jpeg" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("preparePhoto", () => {
  it("redraws a phone photo at 1600 px as a JPEG, with a 320 px thumbnail", async () => {
    const { decode } = stubDrawing({ width: 4032, height: 3024 });
    const file = picked();
    const prepared = await preparePhoto(file);
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(prepared.size).toEqual({ width: 4032, height: 3024 });
    expect(saved.get(prepared.file)).toEqual({
      width: 1600,
      height: 1200,
      type: "image/jpeg",
      quality: PHOTO_QUALITY,
    });
    expect(saved.get(prepared.thumb)).toEqual({
      width: 320,
      height: 240,
      type: "image/jpeg",
      quality: THUMB_QUALITY,
    });
  });

  it("caps a portrait photo by its height", async () => {
    stubDrawing({ width: 3024, height: 4032 });
    const prepared = await preparePhoto(picked());
    expect(saved.get(prepared.file)).toMatchObject({ width: 1200, height: 1600 });
    expect(saved.get(prepared.thumb)).toMatchObject({ width: 240, height: 320 });
  });

  it("never scales a small photo up, but still redraws it", async () => {
    stubDrawing({ width: 800, height: 600 });
    const file = picked();
    const prepared = await preparePhoto(file);
    expect(prepared.file).not.toBe(file);
    expect(saved.get(prepared.file)).toMatchObject({ width: 800, height: 600 });
    expect(saved.get(prepared.thumb)).toMatchObject({ width: 320, height: 240 });
  });

  it("sends a file it cannot decode as it is, as both, for core to refuse", async () => {
    stubDrawing("undecodable");
    const file = new File(["ftypheic"], "IMG_0002.HEIC", { type: "image/heic" });
    const prepared = await preparePhoto(file);
    expect(prepared.file).toBe(file);
    expect(prepared.thumb).toBe(file);
    expect(prepared.takenOn).toBeUndefined();
    expect(prepared.size).toBeUndefined();
  });

  it("cuts the crop from the whole picture before shrinking it", async () => {
    const { drawImage } = stubDrawing({ width: 4000, height: 3000 });
    const prepared = await preparePhoto(picked(), { x: 1500, y: 1000, width: 1000, height: 1000 });
    // 1000 px square is within 1600, so it keeps every pixel of the crop.
    expect(saved.get(prepared.file)).toMatchObject({ width: 1000, height: 1000 });
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([1500, 1000, 1000, 1000, 0, 0, 1000, 1000]);
    expect(saved.get(prepared.thumb)).toMatchObject({ width: 320, height: 320 });
    // The size is still the whole picture's, so the crop can be reopened over it.
    expect(prepared.size).toEqual({ width: 4000, height: 3000 });
  });

  it("shrinks a crop larger than 1600 px after cutting it", async () => {
    const { drawImage } = stubDrawing({ width: 3024, height: 4032 });
    const prepared = await preparePhoto(picked(), { x: 0, y: 32, width: 3024, height: 2000 });
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([0, 32, 3024, 2000, 0, 0, 1600, 1058]);
    expect(saved.get(prepared.file)).toMatchObject({ width: 1600, height: 1058 });
  });

  it("keeps a crop inside the picture, in whole pixels", async () => {
    const { drawImage } = stubDrawing({ width: 800, height: 600 });
    await preparePhoto(picked(), { x: -3.4, y: 400.6, width: 900, height: 300 });
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([0, 401, 800, 199, 0, 0, 800, 199]);
  });

  it("draws the whole picture when there is no crop", async () => {
    const { drawImage } = stubDrawing({ width: 4000, height: 3000 });
    await preparePhoto(picked());
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([0, 0, 4000, 3000, 0, 0, 1600, 1200]);
  });

  it("reads the date from the original when cropping", async () => {
    stubDrawing({ width: 4032, height: 3024 });
    const prepared = await preparePhoto(picked(jpegTakenOn("2026:03:14 10:22:01")), {
      x: 10,
      y: 10,
      width: 100,
      height: 100,
    });
    expect(prepared.takenOn).toBe("2026-03-14");
  });

  it("reads the day it was taken from the EXIF", async () => {
    stubDrawing({ width: 4032, height: 3024 });
    const prepared = await preparePhoto(picked(jpegTakenOn("2026:03:14 10:22:01")));
    expect(prepared.takenOn).toBe("2026-03-14");
  });

  it("reads the date of a file it cannot decode, too", async () => {
    stubDrawing("undecodable");
    const prepared = await preparePhoto(picked(jpegTakenOn("2025:12:31 23:59:59")));
    expect(prepared.takenOn).toBe("2025-12-31");
  });

  it("leaves the date out when the file has none", async () => {
    stubDrawing({ width: 100, height: 100 });
    expect((await preparePhoto(picked())).takenOn).toBeUndefined();
    expect(
      (await preparePhoto(picked(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])))).takenOn,
    ).toBeUndefined();
  });
});

describe("prepareDocumentImage", () => {
  it("redraws a phone shot of a receipt at 2400 px as a finer JPEG, with no thumbnail or date", async () => {
    const { decode } = stubDrawing({ width: 3024, height: 4032 });
    const file = picked(jpegTakenOn("2026:03:14 10:22:01"));
    const prepared = await prepareDocumentImage(file);
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(saved.get(prepared.file)).toEqual({
      width: 1800,
      height: 2400,
      type: "image/jpeg",
      quality: DOCUMENT_QUALITY,
    });
    expect(prepared).toEqual({ file: prepared.file, size: { width: 3024, height: 4032 } });
  });

  it("leaves a Photo at 1600 px all the same", async () => {
    stubDrawing({ width: 3024, height: 4032 });
    const photo = await preparePhoto(picked());
    const document = await prepareDocumentImage(picked());
    expect(saved.get(photo.file)).toMatchObject({ width: 1200, height: 1600 });
    expect(saved.get(document.file)).toMatchObject({ width: 1800, height: 2400 });
  });

  it("never scales a small image up, but still redraws it", async () => {
    stubDrawing({ width: 1200, height: 900 });
    const file = picked();
    const prepared = await prepareDocumentImage(file);
    expect(prepared.file).not.toBe(file);
    expect(saved.get(prepared.file)).toMatchObject({ width: 1200, height: 900 });
  });

  it("cuts the crop from the whole picture before shrinking it to 2400 px", async () => {
    const { drawImage } = stubDrawing({ width: 3024, height: 4032 });
    const prepared = await prepareDocumentImage(picked(), {
      x: 500,
      y: 0,
      width: 2000,
      height: 4000,
    });
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([500, 0, 2000, 4000, 0, 0, 1200, 2400]);
    expect(saved.get(prepared.file)).toMatchObject({ width: 1200, height: 2400 });
    expect(prepared.size).toEqual({ width: 3024, height: 4032 });
  });

  it("sends a file it cannot decode as it is, for core to refuse", async () => {
    stubDrawing("undecodable");
    const file = new File(["ftypheic"], "IMG_0002.HEIC", { type: "image/heic" });
    expect(await prepareDocumentImage(file)).toEqual({ file });
  });
});

describe("fitWithin", () => {
  it("scales the long edge down to the limit and keeps the shape", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1000, 5000, 320)).toEqual({ width: 64, height: 320 });
  });

  it("leaves a picture already within it alone", () => {
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(10, 20, 1600)).toEqual({ width: 10, height: 20 });
  });
});

describe("exifDay", () => {
  it("reads EXIF's date as YYYY-MM-DD", () => {
    expect(exifDay("2026:03:14 10:22:01")).toBe("2026-03-14");
  });

  it("ignores a blank, zeroed, or impossible date", () => {
    expect(exifDay("    :  :     :  :  ")).toBeUndefined();
    expect(exifDay("0000:00:00 00:00:00")).toBeUndefined();
    expect(exifDay("2026:02:30 10:00:00")).toBeUndefined();
    expect(exifDay(undefined)).toBeUndefined();
  });
});
