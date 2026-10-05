// The rules of Photos: the user's own pictures of an Item, added on the web with a thumbnail the
// browser made, validated by their bytes, stored as files under uploads/<home>/photos/, captioned,
// deleted outright, shown newest first on the Item page and as the main one on every Item, and
// logged on the Item by the day each was taken. The Agent's line for them is in render.test.ts.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore, type OperationInput } from "./core.js";
import { CoreError } from "./errors.js";
import { nodeFileStore } from "./files.js";
import { MAX_IMAGE_BYTES } from "./images.js";

const web: CallContext = { caller: { kind: "web" } };

const JPEG = image([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46], 1);
const THUMB = image([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46], 2);
const PNG = image([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 3);
/** An iPhone's photo: a box of length 24, then "ftyp" and the brand "heic". */
const HEIC = image([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")], 4);

/** 64 fake bytes behind a real signature, told apart by `mark`. */
function image(signature: number[], mark: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set(signature);
  bytes[60] = mark;
  return bytes;
}

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

let dataDir: string;
let core: Core;
let home: string;
/** Paths whose write the file store refuses, to fail an upload partway. */
let failing: RegExp | undefined;

const add = (input: Partial<OperationInput<"add_photo">> = {}) =>
  core.run("add_photo", web, { home, item: "lamp", file: JPEG, thumb: THUMB, ...input });
const page = (item = "lamp") => core.run("get_item", web, { home, item });
const photosDir = () => join(dataDir, "uploads", home, "photos");
const stored = () => (existsSync(photosDir()) ? readdirSync(photosDir()).sort() : []);

beforeEach(async () => {
  failing = undefined;
  dataDir = mkdtempSync(join(tmpdir(), "settle-photos-"));
  core = createCore({
    dataDir,
    clock: () => new Date("2026-10-05T10:00:00.000Z"),
    files: {
      ...nodeFileStore,
      writeBytes(path, bytes) {
        if (failing?.test(path)) throw new Error(`The disk refused ${path}`);
        nodeFileStore.writeBytes(path, bytes);
      },
    },
  });
  home = (await core.run("create_home", web, { name: "My flat", country: "CL", city: "Santiago" }))
    .home.slug;
  const session = (
    await core.run("open_session", { caller: { kind: "session" }, home }, { skill: "home-intake" })
  ).session;
  const agent: CallContext = { caller: { kind: "session", session }, home };
  await core.run("save_room", agent, { session, name: "Living room" });
  await core.run("save_items", agent, {
    session,
    items: [
      { name: "Lamp", category: "lighting", room: "living-room" },
      { name: "Sofa", category: "seating", room: "living-room" },
      { name: "Old rug", category: "rugs", room: "living-room" },
    ],
  });
  await core.run("save_items", agent, {
    session,
    items: [{ item: "old-rug", archive: true, archiveReason: "worn out" }],
  });
});
afterEach(() => {
  core.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("add_photo", () => {
  it("stores the photo and its thumbnail, dated today and uncaptioned when neither is given", async () => {
    const { photos } = await add();
    expect(photos).toEqual([
      { id: expect.any(Number), version: expect.any(String), takenOn: "2026-10-05" },
    ]);
    const id = photos[0]?.id;
    expect(stored()).toEqual([`${id}-thumb.jpg`, `${id}.jpg`]);
    const full = await core.run("get_photo", web, {
      home,
      item: "lamp",
      photo: id ?? 0,
      size: "full",
    });
    const thumb = await core.run("get_photo", web, {
      home,
      item: "lamp",
      photo: id ?? 0,
      size: "thumb",
    });
    expect([full.mimeType, full.data]).toEqual(["image/jpeg", JPEG]);
    expect([thumb.mimeType, thumb.data]).toEqual(["image/jpeg", THUMB]);
  });

  it("takes the day it was taken and a caption, trimmed, and an empty caption is none", async () => {
    await add({ takenOn: "2026-03-14", caption: "  scratch on the left leg " });
    const { photos } = await add({ takenOn: "2026-01-02", caption: "   ", file: PNG });
    expect(photos.map(({ takenOn, caption }) => ({ takenOn, caption }))).toEqual([
      { takenOn: "2026-03-14", caption: "scratch on the left leg" },
      { takenOn: "2026-01-02", caption: undefined },
    ]);
    expect(stored()).toContain(`${photos[1]?.id}.png`);
  });

  it("refuses a day that is not real, or in the future", async () => {
    const unreal = await refusal(add({ takenOn: "2026-02-30" }));
    const future = await refusal(add({ takenOn: "2026-12-01" }));
    expect([unreal.code, future.code]).toEqual(["validation", "validation"]);
    expect(future.message).toContain("future");
    expect(stored()).toEqual([]);
  });

  it("refuses a HEIC by name, saying to export a JPEG, for the photo or its thumbnail", async () => {
    for (const files of [{ file: HEIC }, { thumb: HEIC }]) {
      const error = await refusal(add(files));
      expect(error.code).toBe("unsupported_file");
      expect(error.message).toMatch(/HEIC image.*Export it as a JPEG/);
    }
    expect(stored()).toEqual([]);
  });

  it("refuses a file that is not an image, whatever it is called", async () => {
    const error = await refusal(add({ file: new TextEncoder().encode("<!doctype html>") }));
    expect(error.code).toBe("unsupported_file");
    expect(error.message).toContain("not a JPEG, PNG, or WebP");
  });

  it("refuses either file over the cap", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(JPEG.subarray(0, 8));
    const photo = await refusal(add({ file: big }));
    const thumb = await refusal(add({ thumb: big }));
    expect([photo.code, thumb.code]).toEqual(["validation", "validation"]);
    expect(photo.message).toContain("over 2048 KB");
    expect(stored()).toEqual([]);
  });

  it("leaves no files and no Photo when a write fails partway", async () => {
    failing = /-thumb\.jpg$/;
    await expect(add()).rejects.toThrow("The disk refused");
    expect(stored()).toEqual([]);
    expect((await page()).photos).toEqual([]);
  });

  it("takes a Photo on an Archived Item", async () => {
    const { photos } = await add({ item: "old-rug" });
    expect(photos).toHaveLength(1);
    expect((await page("old-rug")).item.photo?.id).toBe(photos[0]?.id);
  });
});

describe("the Item's Photos, read", () => {
  it("get_item gives them newest first, by the day taken then by upload, and none as empty", async () => {
    const march = (await add({ takenOn: "2026-03-14" })).photos[0];
    await add({ takenOn: "2026-01-02" });
    const { photos } = await add({ takenOn: "2026-03-14", file: PNG });
    const later = photos.find((each) => each.id !== march?.id && each.takenOn === "2026-03-14");
    expect(photos.map((each) => each.takenOn)).toEqual(["2026-03-14", "2026-03-14", "2026-01-02"]);
    expect(photos[0]?.id).toBe(later?.id);
    expect((await page()).photos).toEqual(photos);
    expect((await page("sofa")).photos).toEqual([]);
  });

  it("toItem's photo is the newest, in list_items and get_room, and absent without one", async () => {
    await add({ takenOn: "2026-03-14" });
    const newest = (await add({ takenOn: "2026-09-01", file: PNG })).photos[0];
    await add({ takenOn: "2026-01-02" });
    const { items } = await core.run("list_items", web, { home });
    const { room } = await core.run("get_room", web, { home, room: "living-room" });
    for (const list of [items, room.items]) {
      expect(list.find((each) => each.slug === "lamp")?.photo).toEqual({
        id: newest?.id,
        version: newest?.version,
      });
      expect(list.find((each) => each.slug === "sofa")).not.toHaveProperty("photo");
    }
  });
});

describe("edit_photo and delete_photo", () => {
  it("edits the caption and clears it with null or an empty string", async () => {
    const id = (await add({ caption: "under the window" })).photos[0]?.id ?? 0;
    const edit = (caption: string | null) =>
      core.run("edit_photo", web, { home, item: "lamp", photo: id, caption });
    expect((await edit("east wall, by the window")).photos[0]?.caption).toBe(
      "east wall, by the window",
    );
    expect((await edit("")).photos[0]).not.toHaveProperty("caption");
    await edit("again");
    expect((await edit(null)).photos[0]).not.toHaveProperty("caption");
  });

  it("deletes the row and both files", async () => {
    const id = (await add()).photos[0]?.id ?? 0;
    const { photos } = await core.run("delete_photo", web, { home, item: "lamp", photo: id });
    expect(photos).toEqual([]);
    expect(stored()).toEqual([]);
    expect((await page()).item).not.toHaveProperty("photo");
  });

  it("refuses not_found for a Photo that is not on the named Item", async () => {
    const id = (await add()).photos[0]?.id ?? 0;
    const refused = await Promise.all([
      refusal(core.run("edit_photo", web, { home, item: "sofa", photo: id, caption: "x" })),
      refusal(core.run("delete_photo", web, { home, item: "sofa", photo: id })),
      refusal(core.run("get_photo", web, { home, item: "sofa", photo: id, size: "full" })),
      refusal(core.run("delete_photo", web, { home, item: "lamp", photo: id + 1 })),
    ]);
    expect(refused.map((each) => each.code)).toEqual([
      "not_found",
      "not_found",
      "not_found",
      "not_found",
    ]);
    expect(stored()).toHaveLength(2);
  });
});

it("logs each change on the Item from the web, naming the Photo by its day, never its id", async () => {
  const id = (await add({ takenOn: "2026-03-14", caption: "scratch" })).photos[0]?.id ?? 0;
  await core.run("edit_photo", web, { home, item: "lamp", photo: id, caption: "deep scratch" });
  await core.run("edit_photo", web, { home, item: "lamp", photo: id, caption: "deep scratch" });
  await core.run("delete_photo", web, { home, item: "lamp", photo: id });
  const { changes } = await core.run("get_change_log", web, { home });
  const photoChanges = changes.filter((each) => each.field?.startsWith("photo")).reverse();
  expect(photoChanges).toEqual([
    {
      at: expect.any(String),
      origin: "web",
      recordKind: "item",
      record: "lamp",
      field: "photo",
      new: { takenOn: "2026-03-14", caption: "scratch" },
      reason: "edited by the user on the web",
    },
    // An edit to the same caption changes nothing, so it logs nothing.
    {
      at: expect.any(String),
      origin: "web",
      recordKind: "item",
      record: "lamp",
      field: "photo caption",
      old: "scratch",
      new: "deep scratch",
      reason: "edited by the user on the web",
    },
    {
      at: expect.any(String),
      origin: "web",
      recordKind: "item",
      record: "lamp",
      field: "photo",
      old: { takenOn: "2026-03-14", caption: "deep scratch" },
      new: null,
      reason: "edited by the user on the web",
    },
  ]);
  // The Item page's history shows them too.
  expect(
    (await page()).history.flatMap((entry) => entry.changes.map((each) => each.field)),
  ).toEqual(expect.arrayContaining(["photo", "photo caption"]));
});

it("is never offered to the Agent", () => {
  for (const name of ["add_photo", "edit_photo", "delete_photo", "get_photo"]) {
    expect(core.operations.find((each) => each.name === name)?.surface).toBe("web");
  }
});
