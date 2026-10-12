// The rules of Photos: the user's own pictures of a Room or an Item, added on the web with a
// thumbnail the browser made, validated by their bytes, stored as files under
// uploads/<home>/photos/, captioned, a Room's naming the Wall it shows, deleted outright, shown
// newest first on the owner's page and as the main one on every Item and Room, logged on the owner
// by the day each was taken, and shown to the Agent as stored by view_photos. The Agent's lines
// for them are in render.test.ts.
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
let session: string;
let agent: CallContext;
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
  session = (
    await core.run("open_session", { caller: { kind: "session" }, home }, { skill: "home-intake" })
  ).session;
  agent = { caller: { kind: "session", session }, home };
  await core.run("save_room", agent, {
    session,
    name: "Living room",
    walls: [{ position: 1, label: "window wall" }, { position: 2 }, { position: 3 }],
  });
  await core.run("save_room", agent, { session, name: "Hall" });
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

describe("Room Photos", () => {
  const addToRoom = (input: Partial<OperationInput<"add_photo">> = {}) =>
    core.run("add_photo", web, {
      home,
      room: "living-room",
      file: JPEG,
      thumb: THUMB,
      ...input,
    });
  const room = (slug = "living-room") => core.run("get_room", web, { home, room: slug });

  it("adds a Photo of the whole Room or of one of its Walls, newest first, with the Wall's label", async () => {
    await addToRoom({ takenOn: "2026-09-20" });
    const { photos } = await addToRoom({ takenOn: "2026-10-04", wall: 1, caption: "by the sofa" });
    expect(photos.map(({ takenOn, caption, wall }) => ({ takenOn, caption, wall }))).toEqual([
      {
        takenOn: "2026-10-04",
        caption: "by the sofa",
        wall: { position: 1, label: "window wall", archived: false },
      },
      { takenOn: "2026-09-20", caption: undefined, wall: undefined },
    ]);
    expect(photos[1]).not.toHaveProperty("wall");
    expect((await room()).photos).toEqual(photos);
    expect((await room("hall")).photos).toEqual([]);
    // The Room's tile shows the main Photo, the newest; a Room without one has none.
    const { rooms } = await core.run("get_home", web, { home });
    expect(rooms.find((each) => each.slug === "living-room")?.photo).toEqual({
      id: photos[0]?.id,
      version: photos[0]?.version,
    });
    expect(rooms.find((each) => each.slug === "hall")).not.toHaveProperty("photo");
    // An Item's Photos are its own: the Room's are not on its Items.
    expect((await page()).photos).toEqual([]);
    const full = await core.run("get_photo", web, {
      home,
      room: "living-room",
      photo: photos[0]?.id ?? 0,
      size: "full",
    });
    expect(full).toEqual({ mimeType: "image/jpeg", data: JPEG });
  });

  it("refuses a Photo of both or neither, a Wall on an Item's Photo, and a Wall the Room lacks", async () => {
    const refused = await Promise.all([
      refusal(addToRoom({ item: "lamp" })),
      refusal(core.run("add_photo", web, { home, file: JPEG, thumb: THUMB })),
      refusal(add({ wall: 1 })),
      refusal(addToRoom({ wall: 7 })),
      refusal(addToRoom({ room: "hall", wall: 1 })),
      refusal(addToRoom({ room: "attic" })),
    ]);
    expect(refused.map((each) => [each.code, each.message])).toEqual([
      ["validation", "A Photo is of one Room or one Item: send `room` or `item`, not both."],
      [
        "validation",
        "Say whose Photo it is: send `room` with a Room's slug, or `item` with an Item's.",
      ],
      [
        "validation",
        "An Item's Photo names no Wall: leave `wall` out, or send `room` instead of `item` to add " +
          "a Photo of the Room.",
      ],
      [
        "not_found",
        "Living room has no Wall 7. Its Walls are 1, 2, 3; send one of those, or leave `wall` " +
          "out for the whole Room.",
      ],
      ["not_found", "Hall has no Walls recorded: leave `wall` out for a Photo of the whole Room."],
      ["not_found", 'This Home has no Room "attic".'],
    ]);
    expect(stored()).toEqual([]);
  });

  it("keeps a Photo's Wall when the Wall is Archived, and may still name it", async () => {
    const id = (await addToRoom({ wall: 3 })).photos[0]?.id ?? 0;
    await core.run("save_room", agent, {
      session,
      room: "living-room",
      name: "Living room",
      walls: [{ position: 3, archive: true }],
    });
    expect((await room()).photos[0]?.wall).toEqual({ position: 3, archived: true });
    const { photos } = await addToRoom({ wall: 3 });
    expect(photos.map((each) => each.wall?.archived)).toEqual([true, true]);
    expect(photos[1]?.id).toBe(id);
  });

  it("edits the Wall and the caption, each left as it is when left out, and refuses a Wall on an Item's Photo", async () => {
    const id = (await addToRoom({ caption: "corner" })).photos[0]?.id ?? 0;
    const edit = (change: Partial<OperationInput<"edit_photo">>) =>
      core.run("edit_photo", web, { home, room: "living-room", photo: id, ...change });
    expect((await edit({ wall: 2 })).photos[0]).toMatchObject({
      caption: "corner",
      wall: { position: 2, archived: false },
    });
    expect((await edit({ caption: "the reading corner" })).photos[0]?.wall?.position).toBe(2);
    expect((await edit({ wall: null })).photos[0]).not.toHaveProperty("wall");
    expect((await refusal(edit({ wall: 9 }))).code).toBe("not_found");
    const itemPhoto = (await add()).photos[0]?.id ?? 0;
    const onItem = await refusal(
      core.run("edit_photo", web, { home, item: "lamp", photo: itemPhoto, wall: 1 }),
    );
    expect(onItem.code).toBe("validation");
    // A Room's Photo is not found through an Item, nor through another Room.
    const elsewhere = await Promise.all([
      refusal(core.run("delete_photo", web, { home, item: "lamp", photo: id })),
      refusal(core.run("delete_photo", web, { home, room: "hall", photo: id })),
    ]);
    expect(elsewhere.map((each) => each.code)).toEqual(["not_found", "not_found"]);
  });

  it("deletes a Room's Photo and both its files", async () => {
    const id = (await addToRoom()).photos[0]?.id ?? 0;
    const { photos } = await core.run("delete_photo", web, {
      home,
      room: "living-room",
      photo: id,
    });
    expect(photos).toEqual([]);
    expect(stored()).toEqual([]);
    const { rooms } = await core.run("get_home", web, { home });
    expect(rooms.find((each) => each.slug === "living-room")).not.toHaveProperty("photo");
  });

  it("logs each change on the Room, the Wall by its position", async () => {
    const id = (await addToRoom({ takenOn: "2026-10-04", wall: 1 })).photos[0]?.id ?? 0;
    await core.run("edit_photo", web, { home, room: "living-room", photo: id, wall: 2 });
    await core.run("edit_photo", web, { home, room: "living-room", photo: id, wall: 2 });
    await core.run("edit_photo", web, { home, room: "living-room", photo: id, wall: null });
    await core.run("delete_photo", web, { home, room: "living-room", photo: id });
    const { changes } = await core.run("get_change_log", web, { home });
    expect(
      changes
        .filter((each) => each.field?.startsWith("photo"))
        .reverse()
        .map(({ recordKind, record, field, old, new: value }) => ({
          recordKind,
          record,
          field,
          old,
          new: value,
        })),
    ).toEqual([
      {
        recordKind: "room",
        record: "living-room",
        field: "photo",
        old: undefined,
        new: { takenOn: "2026-10-04", wall: 1 },
      },
      { recordKind: "room", record: "living-room", field: "photo wall", old: 1, new: 2 },
      { recordKind: "room", record: "living-room", field: "photo wall", old: 2, new: null },
      {
        recordKind: "room",
        record: "living-room",
        field: "photo",
        old: { takenOn: "2026-10-04" },
        new: null,
      },
    ]);
  });

  it("takes a color judged by eye as a plain name, Estimated, with no code or hex", async () => {
    // What the Agent writes on the user's OK after looking at a Photo: the Room Sheet and the
    // Room page show the name, with no swatch to pass for a measurement.
    const color = { name: "warm off-white", provenance: "estimated" } as const;
    await core.run("save_room", agent, {
      session,
      room: "living-room",
      name: "Living room",
      surfaces: { walls: { color } },
    });
    const walls = (await room()).room.surfaces.find((each) => each.part === "walls");
    expect(walls?.color).toEqual(color);
    const { sheet } = await core.run("get_room_sheet", agent, { session, room: "living-room" });
    expect(sheet).toContain("- walls: color ~warm off-white\n");
  });
});

describe("view_photos", () => {
  const view = (photos: number[]) => core.run("view_photos", agent, { session, photos });

  it("shows Room and Item Photos as stored, in the order asked, each named in the text", async () => {
    const roomPhoto =
      (
        await core.run("add_photo", web, {
          home,
          room: "living-room",
          wall: 1,
          file: PNG,
          thumb: THUMB,
          takenOn: "2026-10-04",
        })
      ).photos[0]?.id ?? 0;
    const itemPhoto = (await add({ takenOn: "2026-03-14", caption: "scratch" })).photos[0]?.id ?? 0;
    const operation = core.operations.find((each) => each.name === "view_photos");
    const result = await view([itemPhoto, roomPhoto, itemPhoto]);
    // Sent as stored, never shrunk or re-encoded, and never the thumbnail.
    expect(operation?.images?.(result)).toEqual([
      { data: JPEG, mimeType: "image/jpeg" },
      { data: PNG, mimeType: "image/png" },
    ]);
    expect(operation?.text?.(result)).toBe(
      [
        "2 Photos follow, the user's own, one image each, in this order:",
        `- #${itemPhoto}: Item Lamp (lamp), taken 2026-03-14, "scratch"`,
        `- #${roomPhoto}: Room Living room (living-room), wall 1 "window wall", taken 2026-10-04`,
      ].join("\n"),
    );
  });

  it("refuses an unknown id by naming it, and more than 4", async () => {
    const id = (await add()).photos[0]?.id ?? 0;
    const unknown = await refusal(view([id, id + 7, id + 9]));
    expect(unknown.code).toBe("not_found");
    expect(unknown.message).toContain(`This Home has no Photos #${id + 7}, #${id + 9}.`);
    expect((await refusal(view([1, 2, 3, 4, 5]))).code).toBe("validation");
    expect((await refusal(view([]))).code).toBe("validation");
  });

  it("is the Agent's, read-only, and tells it to look only when the user asks", () => {
    const operation = core.operations.find((each) => each.name === "view_photos");
    expect(operation).toMatchObject({ surface: "agent", readOnly: true });
    expect(operation?.description).toContain(
      "Call this only when the user has asked you to look or said yes to looking",
    );
  });
});
