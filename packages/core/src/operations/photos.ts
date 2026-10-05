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
import type { HomeRow, ItemRow, PhotoRow } from "../store.js";
import { newestFirst } from "./model.js";
import {
  addPhotoInput,
  deletePhotoInput,
  editPhotoInput,
  type GetPhotoResult,
  getPhotoInput,
  type Photo,
  type PhotosResult,
} from "./schemas.js";
import { requireHome } from "./scope.js";

// Photos of an Item: the user's own pictures, taken standing next to the thing and added from its
// page, to recognise it, keep a dated record of its condition, recall a color, and see where in
// the Room it sits. Web writes only, like the Item page's pencil: the camera is in the user's
// hand. The Agent is told a Photo exists, with its date and caption, in find_items; it never sees
// the image and cannot add, change, or delete one.
//
// The browser shrinks each photo and makes its thumbnail before upload, so core stores both as
// they came, validated by their own bytes, under uploads/<home>/photos/. Core has no image library
// for photos and gets none.

/** The reason a write on the page carries: the user acting, as the Item page's pencil does. */
const WEB_EDIT = "edited by the user on the web";

export const addPhoto = defineOperation({
  name: "add_photo",
  description:
    "Adds a Photo to one Item, Archived ones too, as multipart/form-data: the photo as `file` " +
    "and its thumbnail as `thumb`, both made by the browser, with `takenOn` (today when left " +
    "out) and an optional one-line `caption`. Answers the Item's Photos, newest first.",
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
        const item = requireItem(context, home, input.item);
        const row = context.store.insert("photos", {
          homeId: home.id,
          itemId: item.id,
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
          recordKind: "item",
          record: item,
          field: "photo",
          new: optional({ takenOn, caption }),
          reason: WEB_EDIT,
        });
        return { photos: photosOf(context, home, item) };
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
    "Changes one Photo's caption; null or an empty string clears it. Its date and image stay " +
    "as they are. Answers the Item's Photos, newest first.",
  input: editPhotoInput,
  readOnly: false,
  surface: "web",
  handler(context, input): PhotosResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const item = requireItem(context, home, input.item);
      const photo = requirePhoto(context, home, item, input.photo);
      const caption = input.caption || null;
      if (caption !== photo.caption) {
        context.store.update("photos", photo.id, { caption });
        log({
          home,
          recordKind: "item",
          record: item,
          field: "photo caption",
          old: photo.caption,
          new: caption,
          reason: WEB_EDIT,
        });
      }
      return { photos: photosOf(context, home, item) };
    });
  },
});

export const deletePhoto = defineOperation({
  name: "delete_photo",
  description:
    "Deletes one Photo outright, its row and both files: nothing refers to a Photo, so a " +
    "blurry one can just go. Answers the Item's Photos that remain, newest first.",
  input: deletePhotoInput,
  readOnly: false,
  surface: "web",
  handler(context, input): PhotosResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const item = requireItem(context, home, input.item);
      const photo = requirePhoto(context, home, item, input.photo);
      context.store.removePhoto(photo.id);
      log({
        home,
        recordKind: "item",
        record: item,
        field: "photo",
        old: optional({ takenOn: photo.takenOn, caption: photo.caption }),
        new: null,
        reason: WEB_EDIT,
      });
      // Last, so a failure above leaves the files with the row the rollback keeps.
      context.files.remove(join(context.dataDir(), photo.path));
      context.files.remove(join(context.dataDir(), photo.thumbPath));
      return { photos: photosOf(context, home, item) };
    });
  },
});

export const getPhoto = defineOperation({
  name: "get_photo",
  description:
    "One Photo's stored bytes, the photo or its thumbnail, with the type sniffed from them, " +
    "served by GET /api/get_photo?home=<slug>&item=<slug>&photo=<id>&size=full|thumb&v=<version>.",
  input: getPhotoInput,
  readOnly: true,
  surface: "web",
  handler(context, input): GetPhotoResult {
    const home = requireHome(context);
    const item = requireItem(context, home, input.item);
    const photo = requirePhoto(context, home, item, input.photo);
    const path = input.size === "full" ? photo.path : photo.thumbPath;
    const bytes = context.files.readBytes(join(context.dataDir(), path));
    // The thumbnail's type is its own: the browser may have made it differently.
    const type = bytes && (input.size === "full" ? photo.type : sniffImageType(bytes));
    if (!bytes || !type) {
      throw new CoreError(
        "not_found",
        `The file of the photo of ${item.name} is missing from the app's data folder (${path}).`,
      );
    }
    return { mimeType: type, data: bytes };
  },
});

/** An Item's Photos as the web sees them, newest first. */
export function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    version: row.version,
    takenOn: row.takenOn,
    ...optional({ caption: row.caption }),
  };
}

function photosOf(context: OperationContext, home: HomeRow, item: ItemRow): Photo[] {
  return newestFirst(
    context.store.list("photos", home.id).filter((each) => each.itemId === item.id),
  ).map(toPhoto);
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
function requireItem(context: OperationContext, home: HomeRow, slug: string): ItemRow {
  const item = context.store.list("items", home.id).find((each) => each.slug === slug);
  if (!item) throw new CoreError("not_found", `This Home has no Item "${slug}".`);
  return item;
}

function requirePhoto(
  context: OperationContext,
  home: HomeRow,
  item: ItemRow,
  id: number,
): PhotoRow {
  const photo = context.store
    .list("photos", home.id)
    .find((each) => each.id === id && each.itemId === item.id);
  if (!photo) throw new CoreError("not_found", `${item.name} has no Photo ${id}.`);
  return photo;
}
