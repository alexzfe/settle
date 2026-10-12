import { join } from "node:path";
import { CoreError } from "../errors.js";
import {
  type FetchedImage,
  imageVersion,
  PHOTO_EXTENSIONS,
  sniffImageType,
  uploadedImage,
} from "../images.js";
import { optional } from "../optional.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { renderViewedPhotos } from "../render.js";
import type { HomeRow, ItemRow, PhotoRow, RoomRow, WallRow } from "../store.js";
import { newestFirst } from "./model.js";
import {
  addPhotoInput,
  deletePhotoInput,
  editPhotoInput,
  type GetPhotoResult,
  getPhotoInput,
  type Photo,
  type PhotosResult,
  type ViewedPhoto,
  type ViewPhotosResult,
  viewPhotosInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";

// Photos of a Room or of an Item: the user's own pictures, to recognise a thing, remember what is
// where in a Room and what sits next to what, and keep a dated record. A Room's Photo may name
// the Wall it shows. Web writes only, like the Item page's pencil: the camera is in the user's
// hand. The Agent is told a Photo exists, with its id, Wall, date, and caption, on the Room Sheet
// and in find_items, and looks at one through view_photos only when the user asks; it cannot add,
// change, or delete one.
//
// The browser shrinks each photo and makes its thumbnail before upload, so core stores both as
// they came, validated by their own bytes, under uploads/<home>/photos/. Core has no image library
// for photos and gets none.

/** The reason a write on the page carries: the user acting, as the Item page's pencil does. */
const WEB_EDIT = "edited by the user on the web";

export const addPhoto = defineOperation({
  name: "add_photo",
  description:
    "Adds a Photo to one Room or one Item, Archived ones too, as multipart/form-data: `room` or " +
    "`item`, the photo as `file` and its thumbnail as `thumb`, both made by the browser, with " +
    "`takenOn` (today when left out), an optional one-line `caption`, and for a Room an " +
    "optional `wall`, the position of the Wall it shows. Answers the owner's Photos, newest " +
    "first.",
  input: addPhotoInput,
  readOnly: false,
  surface: "web",
  handler(context, input): PhotosResult {
    const home = requireHome(context);
    const file = uploadedImage(input.file, { name: "That photo", heic: true });
    const thumb = uploadedImage(input.thumb, { name: "Its thumbnail", heic: true });
    const today = context.now().slice(0, 10);
    const takenOn = input.takenOn ?? today;
    if (takenOn > tomorrow(today)) {
      throw new CoreError("validation", `A Photo can't be taken in the future, on ${takenOn}.`);
    }
    const caption = input.caption || null;
    const written: string[] = [];
    try {
      return context.write("web", (log) => {
        const owner = requireOwner(context, home, input);
        const wall =
          input.wall === undefined ? null : requireWall(context, home, owner, input.wall);
        const row = context.store.insert("photos", {
          homeId: home.id,
          itemId: owner.kind === "item" ? owner.row.id : null,
          roomId: owner.kind === "room" ? owner.row.id : null,
          wallId: wall?.id ?? null,
          path: "",
          thumbPath: "",
          type: file.type,
          version: imageVersion(file.bytes),
          takenOn,
          caption,
          createdAt: context.now(),
        });
        // The file names are the row's id, so the paths are filled in once there is one.
        const path = store(context, home, `${row.id}`, file, written);
        const thumbPath = store(context, home, `${row.id}-thumb`, thumb, written);
        context.store.update("photos", row.id, { path, thumbPath });
        log({
          home,
          recordKind: owner.kind,
          record: owner.row,
          field: "photo",
          new: optional({ takenOn, caption, wall: wall?.position }),
          reason: WEB_EDIT,
        });
        return { photos: photosOf(context, home, owner) };
      });
    } catch (error) {
      for (const path of written) context.files.remove(join(context.dataDir(), path));
      throw error;
    }
  },
});

export const editPhoto = defineOperation({
  name: "edit_photo",
  description:
    "Changes one Photo's caption, and for a Room's Photo the Wall it shows, by position; each " +
    "left out stays as it is, and null (or an empty caption) clears it. Its date and image " +
    "stay as they are. Answers the owner's Photos, newest first.",
  input: editPhotoInput,
  readOnly: false,
  surface: "web",
  handler(context, input): PhotosResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const owner = requireOwner(context, home, input);
      const photo = requirePhoto(context, home, owner, input.photo);
      const change = (field: string, old: unknown, value: unknown) =>
        log({
          home,
          recordKind: owner.kind,
          record: owner.row,
          field,
          old,
          new: value,
          reason: WEB_EDIT,
        });
      if (input.caption !== undefined) {
        const caption = input.caption || null;
        if (caption !== photo.caption) {
          context.store.update("photos", photo.id, { caption });
          change("photo caption", photo.caption, caption);
        }
      }
      if (input.wall !== undefined) {
        const wall = input.wall === null ? null : requireWall(context, home, owner, input.wall);
        if ((wall?.id ?? null) !== photo.wallId) {
          context.store.update("photos", photo.id, { wallId: wall?.id ?? null });
          const before = photo.wallId === null ? null : wallById(context, home, photo.wallId);
          change("photo wall", before?.position ?? null, wall?.position ?? null);
        }
      }
      return { photos: photosOf(context, home, owner) };
    });
  },
});

export const deletePhoto = defineOperation({
  name: "delete_photo",
  description:
    "Deletes one Photo outright, its row and both files: nothing refers to a Photo, so a " +
    "blurry one can just go. Answers the owner's Photos that remain, newest first.",
  input: deletePhotoInput,
  readOnly: false,
  surface: "web",
  handler(context, input): PhotosResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const owner = requireOwner(context, home, input);
      const photo = requirePhoto(context, home, owner, input.photo);
      context.store.removePhoto(photo.id);
      log({
        home,
        recordKind: owner.kind,
        record: owner.row,
        field: "photo",
        old: optional({ takenOn: photo.takenOn, caption: photo.caption }),
        new: null,
        reason: WEB_EDIT,
      });
      // Last, so a failure above leaves the files with the row the rollback keeps.
      context.files.remove(join(context.dataDir(), photo.path));
      context.files.remove(join(context.dataDir(), photo.thumbPath));
      return { photos: photosOf(context, home, owner) };
    });
  },
});

export const getPhoto = defineOperation({
  name: "get_photo",
  description:
    "One Photo's stored bytes, the photo or its thumbnail, with the type sniffed from them, " +
    "served by GET /api/get_photo?home=<slug>&item=<slug>&photo=<id>&size=full|thumb&v=<version>, " +
    "or with room=<slug> in place of item for a Room's Photo.",
  input: getPhotoInput,
  readOnly: true,
  surface: "web",
  handler(context, input): GetPhotoResult {
    const home = requireHome(context);
    const owner = requireOwner(context, home, input);
    const photo = requirePhoto(context, home, owner, input.photo);
    const path = input.size === "full" ? photo.path : photo.thumbPath;
    const bytes = context.files.readBytes(join(context.dataDir(), path));
    // The thumbnail's type is its own: the browser may have made it differently.
    const type = bytes && (input.size === "full" ? photo.type : sniffImageType(bytes));
    if (!bytes || !type) throw missingFile(owner.row, path);
    return { mimeType: type, data: bytes };
  },
});

export const viewPhotos = defineOperation({
  name: "view_photos",
  description:
    "Shows the user's own Photos of this Home's Rooms and Items as images, so you can look at " +
    "them: first a text block with one line per Photo (its id, the Room or Item it is of, the " +
    "Wall it shows, the day it was taken, its caption), then one image per Photo, as stored, in " +
    "that order. Name Photos by id, as the Room Sheet's Photos line and find_items list them: " +
    "at most 4 per call, and the fewest that answer the question, usually the newest or the one " +
    "of the Wall in question. Call this only when the user has asked you to look or said yes " +
    "to looking: each Photo stays in the Session's context for every later turn. Changes " +
    "nothing.",
  input: viewPhotosInput,
  readOnly: true,
  surface: "agent",
  handler(context, input): ViewPhotosResult {
    const { store } = context;
    const home = requireHome(context);
    requireSession(context, home, { open: false });
    const ids = [...new Set(input.photos)];
    const rows = store.list("photos", home.id);
    const unknown = ids.filter((id) => !rows.some((each) => each.id === id));
    if (unknown.length > 0) {
      throw new CoreError(
        "not_found",
        `This Home has no ${unknown.length === 1 ? "Photo" : "Photos"} ` +
          `${unknown.map((id) => `#${id}`).join(", ")}. The Room Sheet's Photos line and ` +
          "find_items give each Photo's id.",
      );
    }
    const walls = store.list("walls", home.id);
    const rooms = store.rooms(home.id);
    const items = store.list("items", home.id);
    return {
      photos: ids.map((id): ViewedPhoto => {
        const row = rows.find((each) => each.id === id) as PhotoRow;
        const owner = ownerOf(row, rooms, items);
        const data = context.files.readBytes(join(context.dataDir(), row.path));
        if (!data) throw missingFile(owner.row, row.path);
        const { version: _, ...photo } = toPhoto(row, walls);
        return {
          ...photo,
          of: { kind: owner.kind, slug: owner.row.slug, name: owner.row.name },
          // Sent as stored, never shrunk: the detail and color are what looking is for.
          mimeType: row.type,
          data,
        };
      }),
    };
  },
  text: renderViewedPhotos,
  images: ({ photos }) => photos.map(({ data, mimeType }) => ({ data, mimeType })),
});

/** A Photo as the web sees it, its Wall found among the Home's `walls`, Archived ones too. */
export function toPhoto(row: PhotoRow, walls: readonly WallRow[] = []): Photo {
  const wall = row.wallId === null ? undefined : walls.find((each) => each.id === row.wallId);
  return {
    id: row.id,
    version: row.version,
    takenOn: row.takenOn,
    ...optional({
      caption: row.caption,
      wall: wall && {
        position: wall.position,
        ...optional({ label: wall.label }),
        archived: wall.archivedAt !== null,
      },
    }),
  };
}

function photosOf(context: OperationContext, home: HomeRow, owner: Owner): Photo[] {
  const walls = context.store.list("walls", home.id);
  return newestFirst(
    context.store.list("photos", home.id).filter((each) => ownedBy(each, owner)),
  ).map((row) => toPhoto(row, walls));
}

/** Writes one file and notes its path, for removal should the write fail. Returns the path. */
function store(
  context: OperationContext,
  home: HomeRow,
  name: string,
  image: FetchedImage,
  written: string[],
): string {
  const path = join("uploads", home.slug, "photos", `${name}.${PHOTO_EXTENSIONS[image.type]}`);
  written.push(path);
  context.files.writeBytes(join(context.dataDir(), path), image.bytes);
  return path;
}

/** The day after `day`: a phone ahead of the server's UTC may date a photo there. */
function tomorrow(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** An Item of the Home by slug, Archived ones too. */
export function requireItem(context: OperationContext, home: HomeRow, slug: string): ItemRow {
  const item = context.store.list("items", home.id).find((each) => each.slug === slug);
  if (!item) throw new CoreError("not_found", `This Home has no Item "${slug}".`);
  return item;
}

/** Whose Photos: one Room or one Item of the Home. */
type Owner = { kind: "item"; row: ItemRow } | { kind: "room"; row: RoomRow };

/** The Photo's owner, from exactly one of `item` and `room`, Archived ones too. */
function requireOwner(
  context: OperationContext,
  home: HomeRow,
  input: { item?: string | undefined; room?: string | undefined },
): Owner {
  if (input.item !== undefined && input.room !== undefined) {
    throw new CoreError(
      "validation",
      "A Photo is of one Room or one Item: send `room` or `item`, not both.",
    );
  }
  if (input.room !== undefined) {
    const slug = input.room;
    const room = context.store.rooms(home.id).find((each) => each.slug === slug);
    if (!room) throw new CoreError("not_found", `This Home has no Room "${slug}".`);
    return { kind: "room", row: room };
  }
  if (input.item !== undefined) {
    return { kind: "item", row: requireItem(context, home, input.item) };
  }
  throw new CoreError(
    "validation",
    "Say whose Photo it is: send `room` with a Room's slug, or `item` with an Item's.",
  );
}

/** A Wall of the owner Room by position, Archived ones too: a Photo of an old wall is still one. */
function requireWall(
  context: OperationContext,
  home: HomeRow,
  owner: Owner,
  position: number,
): WallRow {
  if (owner.kind === "item") {
    throw new CoreError(
      "validation",
      "An Item's Photo names no Wall: leave `wall` out, or send `room` instead of `item` to " +
        "add a Photo of the Room.",
    );
  }
  const walls = context.store
    .list("walls", home.id)
    .filter((wall) => wall.roomId === owner.row.id)
    .sort((a, b) => a.position - b.position);
  // A live Wall before an Archived one at the same position.
  const wall =
    walls.find((each) => each.position === position && each.archivedAt === null) ??
    walls.find((each) => each.position === position);
  if (wall) return wall;
  const positions = [...new Set(walls.map((each) => each.position))];
  throw new CoreError(
    "not_found",
    positions.length === 0
      ? `${owner.row.name} has no Walls recorded: leave \`wall\` out for a Photo of the whole Room.`
      : `${owner.row.name} has no Wall ${position}. Its Walls are ${positions.join(", ")}; send ` +
          "one of those, or leave `wall` out for the whole Room.",
  );
}

function wallById(context: OperationContext, home: HomeRow, id: number): WallRow | undefined {
  return context.store.list("walls", home.id).find((each) => each.id === id);
}

function ownedBy(photo: PhotoRow, owner: Owner): boolean {
  return owner.kind === "item" ? photo.itemId === owner.row.id : photo.roomId === owner.row.id;
}

/** The Room or Item a stored Photo is of. */
function ownerOf(photo: PhotoRow, rooms: RoomRow[], items: ItemRow[]): Owner {
  const room = photo.roomId === null ? undefined : rooms.find((each) => each.id === photo.roomId);
  if (room) return { kind: "room", row: room };
  const item = items.find((each) => each.id === photo.itemId);
  if (item) return { kind: "item", row: item };
  throw new Error(`Photo ${photo.id} belongs to no Room or Item of its Home`);
}

function requirePhoto(
  context: OperationContext,
  home: HomeRow,
  owner: Owner,
  id: number,
): PhotoRow {
  const photo = context.store
    .list("photos", home.id)
    .find((each) => each.id === id && ownedBy(each, owner));
  if (!photo) throw new CoreError("not_found", `${owner.row.name} has no Photo ${id}.`);
  return photo;
}

function missingFile(owner: { name: string }, path: string): CoreError {
  return new CoreError(
    "not_found",
    `The file of the photo of ${owner.name} is missing from the app's data folder (${path}).`,
  );
}
