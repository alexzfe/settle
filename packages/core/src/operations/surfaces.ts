import type { RoomRow, WallRow } from "../store.js";
import type { HomeModel } from "./model.js";
import type { SurfaceInput, SurfacePart } from "./schemas.js";
import { given, type Writer } from "./writer.js";

// Writing a Surface: save_room's Surfaces and Wall exceptions, and a Room color's Fulfilment.

/** A Surface's slug: "living-room/floor", or "living-room/wall-3/surface" for one Wall's. */
export function surfaceSlug(room: RoomRow, part: SurfacePart, wall: WallRow | undefined): string {
  return wall ? `${wall.slug}/surface` : `${room.slug}/${part}`;
}

/**
 * Records one Surface of a Room, or a whole-Wall exception to its walls Surface, changing only
 * the fields given; its color follows the Provenance rule through the Writer. Returns the
 * receipt's subject for it.
 */
export function saveSurface(
  model: HomeModel,
  writer: Writer,
  room: RoomRow,
  part: SurfacePart,
  wall: WallRow | undefined,
  input: SurfaceInput,
): string {
  const slug = surfaceSlug(room, part, wall);
  const subject = wall
    ? `Surface of ${wall.slug} (${slug})`
    : `${room.name} ${part} Surface (${slug})`;
  const values = { materials: input.materials, color: input.color, finish: input.finish };
  const existing = model.surfaces.find((surface) => surface.slug === slug);
  if (existing) {
    writer.line(subject, undefined, writer.patch("surfaces", "surface", existing, subject, values));
    return subject;
  }
  if (given(values).length === 0) return subject;
  const created = writer.create(
    "surfaces",
    "surface",
    {
      homeId: model.home.id,
      slug,
      roomId: room.id,
      part,
      wallId: wall?.id ?? null,
      materials: values.materials ?? null,
      color: values.color ?? null,
      finish: values.finish ?? null,
    },
    values,
  );
  model.surfaces.push(created);
  writer.line(subject, "recorded", given(values));
  return subject;
}
