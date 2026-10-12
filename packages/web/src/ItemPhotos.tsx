// The Photos of an Item or a Room on its page: the newest at full size, the others as a strip of
// thumbnails, each opening full size in a dialog with its date, its caption and a pencil for it,
// and delete. A Room's strip is grouped by date, and a Room Photo shows and edits the Wall it
// names. The user adds them here from a phone or a computer; the Agent reads that they exist and
// looks only when asked. The date is when the photo was taken, so it is never edited.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import type { PercentCrop } from "react-image-crop";
import styles from "./App.module.css";
import { call, type Photo, type PhotoOwner, type PhotoWall, photoUrl, upload } from "./api";
import sheet from "./ItemPage.module.css";
import { formatPartialDate } from "./itemDates";
import { type CropArea, type PreparedPhoto, preparePhoto } from "./photoPrep";
import { queryKeys } from "./queries";
import { Dialog } from "./ui/Dialog";

/** A Photo's day: "14 Mar 2026". A plain day, so it reads the same in every time zone. */
export const photoDate = (photo: Photo) => formatPartialDate(photo.takenOn);

/** A Wall a Room Photo can name: its position, and its label when it has one. */
export type PhotoWallChoice = Pick<PhotoWall, "position" | "label">;

/** "wall 2", or the Wall's label; "(archived)" once the Wall is. */
export function photoWallName(wall: PhotoWallChoice & { archived?: boolean }): string {
  return `${wall.label ?? `wall ${wall.position}`}${wall.archived ? " (archived)" : ""}`;
}

/** "Open the photo from 14 Mar 2026", and for a Room Photo of a Wall, "… of wall 2". */
function openLabel(photo: Photo): string {
  return `Open the photo from ${photoDate(photo)}${photo.wall ? ` of ${photoWallName(photo.wall)}` : ""}`;
}

/**
 * After any Photo write: an Item's page, the lists' thumbnails, the Room pages, and the log; for a
 * Room's, the Room pages, the Home's Room tiles, and the log.
 */
function usePhotoWrite<Input>(
  home: string,
  owner: PhotoOwner,
  write: (input: Input) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () => {
      const stale =
        "item" in owner
          ? [
              queryKeys.item(home, owner.item),
              queryKeys.items(home),
              queryKeys.rooms(home),
              queryKeys.changeLog(home),
            ]
          : [queryKeys.rooms(home), queryKeys.home(home), queryKeys.changeLog(home)];
      for (const queryKey of stale) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

/** A day as the Photos store it, YYYY-MM-DD, in the reader's time zone. */
function isoDay(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * Photos grouped by the day they were taken, in the order given (newest first), each group headed
 * "Today" or "14 Mar 2026".
 */
export function photoGroups(
  photos: readonly Photo[],
  today = new Date(),
): { day: string; label: string; photos: Photo[] }[] {
  const groups: { day: string; label: string; photos: Photo[] }[] = [];
  for (const photo of photos) {
    const last = groups.at(-1);
    if (last?.day === photo.takenOn) last.photos.push(photo);
    else {
      const label = photo.takenOn === isoDay(today) ? "Today" : photoDate(photo);
      groups.push({ day: photo.takenOn, label, photos: [photo] });
    }
  }
  return groups;
}

/**
 * The main Photo, its date (and a Room Photo's Wall) and caption, and the others as thumbnails;
 * each opens full size. An Item's strip holds the others; a Room's holds them all, by date.
 */
export function PhotoFigure({
  home,
  owner,
  name,
  photos,
  walls = [],
}: {
  home: string;
  owner: PhotoOwner;
  name: string;
  photos: Photo[];
  /** A Room's live Walls, for a Room Photo's Wall pencil. */
  walls?: readonly PhotoWallChoice[];
}) {
  const [open, setOpen] = useState<number>();
  const [main, ...others] = photos;
  if (!main) return null;
  const thumb = (photo: Photo) => (
    <li key={photo.id}>
      <button
        type="button"
        className={sheet.photoButton}
        aria-label={openLabel(photo)}
        onClick={() => setOpen(photo.id)}
      >
        <img src={photoUrl(home, owner, photo, "thumb")} alt="" loading="lazy" />
      </button>
    </li>
  );
  return (
    <figure className={sheet.picture}>
      <button
        type="button"
        className={sheet.photoButton}
        aria-label={openLabel(main)}
        onClick={() => setOpen(main.id)}
      >
        <img src={photoUrl(home, owner, main, "full")} alt={name} />
      </button>
      <figcaption>
        {photoDate(main)}
        {main.wall && ` · ${photoWallName(main.wall)}`}
        {main.caption && <span className={sheet.photoCaption}>{main.caption}</span>}
      </figcaption>
      {others.length > 0 &&
        ("room" in owner ? (
          <div className={sheet.dated}>
            {photoGroups(photos).map((group) => (
              <section key={group.day} aria-label={`Photos from ${group.label}`}>
                <p className={sheet.datedHead}>
                  {group.label} · {group.photos.length}
                </p>
                <ul className={sheet.strip}>{group.photos.map(thumb)}</ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className={sheet.strip} aria-label="More photos">
            {others.map(thumb)}
          </ul>
        ))}
      {open !== undefined && (
        <PhotoViewer
          home={home}
          owner={owner}
          name={name}
          photos={photos}
          walls={walls}
          id={open}
          onShow={setOpen}
          onClose={() => setOpen(undefined)}
        />
      )}
    </figure>
  );
}

/** One Photo full size, with previous and next among the owner's Photos when it has several. */
function PhotoViewer({
  home,
  owner,
  name,
  photos,
  walls,
  id,
  onShow,
  onClose,
}: {
  home: string;
  owner: PhotoOwner;
  name: string;
  photos: Photo[];
  walls: readonly PhotoWallChoice[];
  id: number;
  onShow: (id: number) => void;
  onClose: () => void;
}) {
  const at = photos.findIndex((photo) => photo.id === id);
  const photo = photos[at];
  const previous = photos[at - 1];
  const next = photos[at + 1];
  // A Photo deleted elsewhere while it was open leaves nothing to show.
  useEffect(() => {
    if (!photo) onClose();
  }, [photo, onClose]);
  // Left and right step through the Photos wherever focus is, except while a caption is typed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      const to =
        event.key === "ArrowLeft" ? previous : event.key === "ArrowRight" ? next : undefined;
      if (to) onShow(to.id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [previous, next, onShow]);
  if (!photo) return null;
  // After a delete, the Photo that took its place, or the one before it; none closes the dialog.
  const afterDelete = () => {
    const left = photos.filter((each) => each.id !== photo.id);
    const shown = left[Math.min(at, left.length - 1)];
    if (shown) onShow(shown.id);
    else onClose();
  };
  return (
    <Dialog
      label={`Photo of ${name}, ${photoDate(photo)}`}
      onClose={onClose}
      className={sheet.viewerDialog}
    >
      <div className={sheet.viewer}>
        <div className={sheet.viewerBar}>
          {photos.length > 1 && (
            <span className={styles.muted}>
              {at + 1} of {photos.length}
            </span>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <img className={sheet.viewerImage} src={photoUrl(home, owner, photo, "full")} alt={name} />
        {photos.length > 1 && (
          <div className={sheet.viewerSteps}>
            <button
              type="button"
              className="secondary"
              disabled={!previous}
              onClick={() => previous && onShow(previous.id)}
            >
              ‹ Previous
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!next}
              onClick={() => next && onShow(next.id)}
            >
              Next ›
            </button>
          </div>
        )}
        {/* Keyed by the Photo, so stepping to another closes an open pencil or delete. */}
        <PhotoDetails
          key={photo.id}
          home={home}
          owner={owner}
          photo={photo}
          walls={walls}
          onDeleted={afterDelete}
        />
      </div>
    </Dialog>
  );
}

/** A Photo's date, a Room Photo's Wall with its pencil, its caption with the pencil, and delete. */
function PhotoDetails({
  home,
  owner,
  photo,
  walls,
  onDeleted,
}: {
  home: string;
  owner: PhotoOwner;
  photo: Photo;
  walls: readonly PhotoWallChoice[];
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState<"caption" | "wall">();
  return (
    <div className={sheet.viewerDetails}>
      <p className={sheet.viewerDate}>{photoDate(photo)}</p>
      {"room" in owner &&
        (editing === "wall" ? (
          <WallEdit
            home={home}
            owner={owner}
            photo={photo}
            walls={walls}
            onDone={() => setEditing(undefined)}
          />
        ) : (
          <div className={sheet.captionLine}>
            <p>{photo.wall ? photoWallName(photo.wall) : "Whole room"}</p>
            <button
              type="button"
              className={`secondary ${sheet.pencil}`}
              aria-label="Change the wall"
              title="Change the wall"
              onClick={() => setEditing("wall")}
            >
              <span aria-hidden>✎</span>
            </button>
          </div>
        ))}
      {editing === "caption" ? (
        <CaptionEdit home={home} owner={owner} photo={photo} onDone={() => setEditing(undefined)} />
      ) : (
        <div className={sheet.captionLine}>
          {photo.caption ? <p>{photo.caption}</p> : <p className={styles.muted}>No caption.</p>}
          <button
            type="button"
            className={`secondary ${sheet.pencil}`}
            aria-label="Edit the caption"
            title="Edit the caption"
            onClick={() => setEditing("caption")}
          >
            <span aria-hidden>✎</span>
          </button>
        </div>
      )}
      <DeletePhoto home={home} owner={owner} photo={photo} onDeleted={onDeleted} />
    </div>
  );
}

/**
 * The Walls a Room Photo can name, "Whole room" first: the Room's live Walls, and the Photo's own
 * Wall too when it has since been archived, so it can be kept.
 */
function WallSelect({
  id,
  walls,
  value,
  current,
  onChange,
}: {
  id: string;
  walls: readonly PhotoWallChoice[];
  value: number | null;
  current?: PhotoWall | undefined;
  onChange: (position: number | null) => void;
}) {
  const kept = current?.archived ? [current] : [];
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
    >
      <option value="">Whole room</option>
      {[...walls, ...kept].map((wall) => (
        <option key={wall.position} value={wall.position}>
          {photoWallName(wall)}
        </option>
      ))}
    </select>
  );
}

/** A Room Photo's Wall pencil: the Wall picker, Save and Cancel. */
function WallEdit({
  home,
  owner,
  photo,
  walls,
  onDone,
}: {
  home: string;
  owner: PhotoOwner;
  photo: Photo;
  walls: readonly PhotoWallChoice[];
  onDone: () => void;
}) {
  const [wall, setWall] = useState<number | null>(photo.wall?.position ?? null);
  const id = useId();
  const save = usePhotoWrite(home, owner, (position: number | null) =>
    call("edit_photo", { home, ...owner, photo: photo.id, wall: position }),
  );
  return (
    <form
      className={sheet.captionForm}
      aria-label="Change the wall"
      onSubmit={(event) => {
        event.preventDefault();
        if (wall === (photo.wall?.position ?? null)) {
          onDone();
          return;
        }
        save.mutate(wall, { onSuccess: onDone });
      }}
    >
      <label htmlFor={`${id}-wall`}>Wall</label>
      <WallSelect
        id={`${id}-wall`}
        walls={walls}
        value={wall}
        current={photo.wall}
        onChange={setWall}
      />
      <div className={styles.actions}>
        <button type="submit" disabled={save.isPending}>
          Save
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
      <Refusal of={save} />
    </form>
  );
}

/** The caption's pencil form: one line, Save and Cancel; saved empty, the caption is cleared. */
function CaptionEdit({
  home,
  owner,
  photo,
  onDone,
}: {
  home: string;
  owner: PhotoOwner;
  photo: Photo;
  onDone: () => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? "");
  const id = useId();
  const save = usePhotoWrite(home, owner, (typed: string | null) =>
    call("edit_photo", { home, ...owner, photo: photo.id, caption: typed }),
  );
  return (
    <form
      className={sheet.captionForm}
      aria-label="Edit the caption"
      onSubmit={(event) => {
        event.preventDefault();
        const typed = caption.trim();
        if (typed === (photo.caption ?? "")) {
          onDone();
          return;
        }
        save.mutate(typed === "" ? null : typed, { onSuccess: onDone });
      }}
    >
      <label htmlFor={`${id}-caption`}>Caption</label>
      <input
        id={`${id}-caption`}
        value={caption}
        placeholder={"item" in owner ? "scratch on the left leg" : "the sofa from the door"}
        onChange={(event) => setCaption(event.target.value)}
      />
      <div className={styles.actions}>
        <button type="submit" disabled={save.isPending}>
          Save
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
      <Refusal of={save} />
    </form>
  );
}

/** Delete, asked once in the page: a Photo goes for good, and nothing refers to it. */
function DeletePhoto({
  home,
  owner,
  photo,
  onDeleted,
}: {
  home: string;
  owner: PhotoOwner;
  photo: Photo;
  onDeleted: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const remove = usePhotoWrite(home, owner, () =>
    call("delete_photo", { home, ...owner, photo: photo.id }),
  );
  if (!armed) {
    return (
      <div className={styles.actions}>
        <button type="button" className="secondary" onClick={() => setArmed(true)}>
          Delete
        </button>
      </div>
    );
  }
  return (
    <div className={sheet.deleteConfirm}>
      <span className={sheet.deleteWarning}>Deletes this photo for good.</span>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => remove.mutate(undefined, { onSuccess: onDeleted })}
        >
          Delete it
        </button>
        <button type="button" className="secondary" onClick={() => setArmed(false)}>
          Keep it
        </button>
      </div>
      <Refusal of={remove} />
    </div>
  );
}

/** A picture made ready to send, and its preview when the browser could decode it. */
interface Ready {
  prepared: PreparedPhoto;
  preview?: string;
}

type Adding =
  | { step: "preparing" }
  | {
      step: "ready";
      picked: File;
      /** The whole picture, kept so the crop can be reopened from it. */
      whole: Ready;
      /** The picture cut to the box last drawn, in percent of the whole, when one was. */
      cropped?: Ready & { crop: PercentCrop };
    }
  | { step: "failed"; message: string };

const PhotoCrop = lazy(() => import("./PhotoCrop"));

/** "No photo yet: wall 2, wall 4": the live Walls no Photo names; undefined once every one has one. */
export function wallsWithoutPhoto(
  walls: readonly PhotoWallChoice[],
  photos: readonly Photo[],
): string | undefined {
  const pictured = new Set(
    photos.flatMap((photo) => (photo.wall && !photo.wall.archived ? [photo.wall.position] : [])),
  );
  const missing = walls.filter((wall) => !pictured.has(wall.position));
  return missing.length === 0
    ? undefined
    : `No photo yet: ${missing.map((wall) => photoWallName(wall)).join(", ")}`;
}

/**
 * "Take photo" goes straight to a phone's camera (`capture`); "Choose photo" has no `capture`, so
 * a phone offers its own library and files, for the best-lit older shot. A computer opens a file
 * chooser for both. A picked photo is made ready here, then shown with Crop, a caption box, Save
 * and Cancel; a Room's also with the Wall picker, "Whole room" by default, and the Walls no Photo
 * shows yet.
 */
export function AddPhoto({
  home,
  owner,
  walls = [],
  photos = [],
}: {
  home: string;
  owner: PhotoOwner;
  /** A Room's live Walls, for the Wall picker. */
  walls?: readonly PhotoWallChoice[];
  /** A Room's Photos, for the Walls without one. */
  photos?: readonly Photo[];
}) {
  const camera = useRef<HTMLInputElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState<Adding>();
  const [cropping, setCropping] = useState<"open" | "cutting">();
  const [caption, setCaption] = useState("");
  const [wall, setWall] = useState<number | null>(null);
  const id = useId();
  const save = usePhotoWrite(home, owner, (form: FormData) => upload("add_photo", form));
  const whole = adding?.step === "ready" ? adding.whole.preview : undefined;
  const cut = adding?.step === "ready" ? adding.cropped?.preview : undefined;
  useEffect(() => {
    if (whole) return () => URL.revokeObjectURL(whole);
  }, [whole]);
  useEffect(() => {
    if (cut) return () => URL.revokeObjectURL(cut);
  }, [cut]);

  const close = () => {
    setAdding(undefined);
    setCropping(undefined);
    setCaption("");
    setWall(null);
    save.reset();
  };

  async function onChoose(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    // Cleared, so choosing the same file again still counts as a choice.
    event.target.value = "";
    if (!picked) return;
    setAdding({ step: "preparing" });
    try {
      const prepared = await preparePhoto(picked);
      setAdding({ step: "ready", picked, whole: ready(picked, prepared) });
    } catch (error) {
      fail(error);
    }
  }

  /** The whole picture cut to the box drawn over it; a box around all of it is no crop. */
  async function onCropped(
    picked: File,
    size: { width: number; height: number },
    crop: PercentCrop,
  ) {
    if (isWhole(crop)) {
      setAdding((current) =>
        current?.step === "ready" ? { ...current, cropped: undefined } : current,
      );
      setCropping(undefined);
      return;
    }
    setCropping("cutting");
    try {
      const prepared = await preparePhoto(picked, cropArea(crop, size));
      setAdding((current) =>
        current?.step === "ready"
          ? { ...current, cropped: { ...ready(picked, prepared), crop } }
          : current,
      );
    } catch (error) {
      fail(error);
    }
    setCropping(undefined);
  }

  function fail(error: unknown) {
    setAdding({
      step: "failed",
      message: error instanceof Error ? error.message : "The photo could not be read.",
    });
  }

  function send(picked: File, prepared: PreparedPhoto) {
    const decoded = prepared.file !== picked;
    const form = new FormData();
    form.set("home", home);
    for (const [field, slug] of Object.entries(owner)) form.set(field, slug);
    if ("room" in owner && wall !== null) form.set("wall", String(wall));
    form.set("file", prepared.file, decoded ? "photo.jpg" : picked.name);
    form.set("thumb", prepared.thumb, decoded ? "thumb.jpg" : picked.name);
    if (prepared.takenOn) form.set("takenOn", prepared.takenOn);
    if (caption.trim()) form.set("caption", caption.trim());
    save.mutate(form, { onSuccess: close });
  }

  const shown = adding?.step === "ready" ? (adding.cropped ?? adding.whole) : undefined;
  const missing = "room" in owner ? wallsWithoutPhoto(walls, photos) : undefined;
  return (
    <div className={sheet.addPhoto}>
      {adding === undefined || adding.step === "failed" ? (
        <div className={styles.actions}>
          <button type="button" className="secondary" onClick={() => camera.current?.click()}>
            Take photo
          </button>
          <button type="button" className="secondary" onClick={() => chooser.current?.click()}>
            Choose photo
          </button>
        </div>
      ) : null}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className={sheet.chooser}
        onChange={onChoose}
        aria-label="Photo from the camera"
        tabIndex={-1}
      />
      <input
        ref={chooser}
        type="file"
        accept="image/*"
        className={sheet.chooser}
        onChange={onChoose}
        aria-label="Photo file"
        tabIndex={-1}
      />
      {adding?.step === "preparing" && (
        <p role="status" className={styles.muted}>
          Preparing the photo…
        </p>
      )}
      {adding?.step === "failed" && (
        <p role="alert" className={styles.error}>
          {adding.message}
        </p>
      )}
      {adding?.step === "ready" && cropping === "open" && adding.whole.preview && (
        <Suspense
          fallback={
            <p role="status" className={styles.muted}>
              Opening the crop…
            </p>
          }
        >
          <PhotoCrop
            src={adding.whole.preview}
            {...(adding.cropped ? { initial: adding.cropped.crop } : {})}
            onDone={(crop) => {
              const { size } = adding.whole.prepared;
              if (size) void onCropped(adding.picked, size, crop);
            }}
            onCancel={() => setCropping(undefined)}
          />
        </Suspense>
      )}
      {adding?.step === "ready" && shown && cropping !== "open" && (
        <form
          className={sheet.addForm}
          aria-label="Add a photo"
          onSubmit={(event) => {
            event.preventDefault();
            send(adding.picked, shown.prepared);
          }}
        >
          {shown.preview ? (
            <img className={sheet.preview} src={shown.preview} alt="Ready to add" />
          ) : (
            <p className={styles.muted}>{adding.picked.name}</p>
          )}
          {/* An undecoded file cannot be cut either: it goes as it is, for core to refuse. */}
          {adding.whole.preview && (
            <div className={styles.actions}>
              <button
                type="button"
                className="secondary"
                disabled={cropping === "cutting" || save.isPending}
                onClick={() => setCropping("open")}
              >
                Crop
              </button>
            </div>
          )}
          {cropping === "cutting" && (
            <p role="status" className={styles.muted}>
              Cropping the photo…
            </p>
          )}
          {"room" in owner && (
            <>
              <label htmlFor={`${id}-wall`}>Wall</label>
              <WallSelect id={`${id}-wall`} walls={walls} value={wall} onChange={setWall} />
              {missing && <p className={styles.muted}>{missing}</p>}
            </>
          )}
          <label htmlFor={`${id}-caption`}>Caption (optional)</label>
          <input
            id={`${id}-caption`}
            value={caption}
            placeholder={"item" in owner ? "under the window, east wall" : "the sofa from the door"}
            onChange={(event) => setCaption(event.target.value)}
          />
          <div className={styles.actions}>
            <button type="submit" disabled={save.isPending || cropping === "cutting"}>
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={save.isPending || cropping === "cutting"}
              onClick={close}
            >
              Cancel
            </button>
          </div>
          {save.isPending && (
            <p role="status" className={styles.muted}>
              Sending the photo…
            </p>
          )}
          <Refusal of={save} />
        </form>
      )}
    </div>
  );
}

/** A file sent as it is could not be decoded here, so it cannot be previewed either. */
export function ready<Prepared extends { file: Blob }>(
  picked: File,
  prepared: Prepared,
): { prepared: Prepared; preview?: string } {
  return prepared.file === picked
    ? { prepared }
    : { prepared, preview: URL.createObjectURL(prepared.file) };
}

/** A box around all of the picture, which is no crop at all. */
export function isWhole(crop: PercentCrop): boolean {
  return crop.x <= 0 && crop.y <= 0 && crop.width >= 100 && crop.height >= 100;
}

/** A box drawn in percent of the picture as shown, in the whole picture's own pixels. */
export function cropArea(crop: PercentCrop, size: { width: number; height: number }): CropArea {
  return {
    x: (crop.x / 100) * size.width,
    y: (crop.y / 100) * size.height,
    width: (crop.width / 100) * size.width,
    height: (crop.height / 100) * size.height,
  };
}

/** A refusal from a write, in the reader's words, where it happened. */
export function Refusal({ of }: { of: { isError: boolean; error: Error | null } }) {
  if (!of.isError) return null;
  return (
    <p role="alert" className={styles.error}>
      {of.error?.message}
    </p>
  );
}
