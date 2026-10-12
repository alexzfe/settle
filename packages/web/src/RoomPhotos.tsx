// A Room's Photos under its banner: the newest large, the rest as thumbnails grouped by date, and
// the add-photo panel with the Wall picker and the tips for a good room photo. A Room with no
// Photos shows only the panel, never an empty frame.

import type { Photo } from "./api";
import { AddPhoto, PhotoFigure, type PhotoWallChoice } from "./ItemPhotos";
import page from "./RoomPage.module.css";

/** The tips, word for word from the room-photos handoff (Q19). */
const TIPS = [
  "Take one photo of each wall, standing against the opposite wall. Use the wide lens (0.5×) if you have one, and hold the phone level.",
  "Leave the room as it is. The point is to remember what's where, so don't tidy away the things around the furniture.",
  "Use plenty of light: open the curtains, or turn the lights on at night.",
  "Take a close-up of anything you'll want to recognise later: a headboard, a rug, what's beside the sofa.",
];

/**
 * How to take a good room photo: open while the Room has no Photos, then folded into one line that
 * opens on tap. Derived from the Photos, so nothing is remembered per browser.
 */
export function RoomPhotoTips({ open }: { open: boolean }) {
  const tips = (
    <ul className={page.tipList}>
      {TIPS.map((tip) => (
        <li key={tip}>{tip}</li>
      ))}
    </ul>
  );
  if (open) {
    return (
      <section className={page.tips} aria-label="A good room photo">
        <p className={page.tipsTitle}>A good room photo</p>
        {tips}
      </section>
    );
  }
  return (
    <details className={page.tips}>
      <summary>How to take a good room photo</summary>
      {tips}
    </details>
  );
}

export function RoomPhotos({
  home,
  room,
  name,
  photos,
  walls,
}: {
  home: string;
  room: string;
  name: string;
  /** Newest first. */
  photos: Photo[];
  /** The Room's live Walls, clockwise. */
  walls: readonly PhotoWallChoice[];
}) {
  const owner = { room };
  return (
    <div className={page.photos}>
      <PhotoFigure home={home} owner={owner} name={name} photos={photos} walls={walls} />
      <div className={page.photoPanel}>
        <RoomPhotoTips open={photos.length === 0} />
        <AddPhoto home={home} owner={owner} walls={walls} photos={photos} />
      </div>
    </div>
  );
}
