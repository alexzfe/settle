import { daylightOpenings } from "./daylight.js";
import { type RoomDetail, SURFACE_PARTS } from "./operations/schemas.js";

/**
 * A Room's Gaps: what the "enough for advice" list (docs/specs/home-model.md#rules-the-home-model-
 * owns) needs and the Room lacks, in the list's order: Wall lengths, ceiling height, Windows with
 * a daylight opening (a Window, or a glazed Door leading outside) with the facing of its Wall, or
 * the Room marked windowless, times of use, and the four Surfaces.
 * An outdoor Room is checked only for its floor Surface and times of use.
 */
export function roomGaps(room: Omit<RoomDetail, "gaps">): string[] {
  const gaps: string[] = [];
  const surfaces = new Set(room.surfaces.map((surface) => surface.part));
  if (room.outdoor) {
    if (room.timesOfUse.length === 0) gaps.push("times of use");
    if (!surfaces.has("floor")) gaps.push("floor Surface");
    return gaps;
  }

  const unmeasured = room.walls.filter((wall) => !wall.length).map((wall) => wall.slug);
  if (room.walls.length === 0) gaps.push("wall lengths");
  else if (unmeasured.length > 0) gaps.push(`wall lengths (${unmeasured.join(", ")})`);

  if (!room.ceilingHeight) gaps.push("ceiling height");

  const openings = daylightOpenings(room);
  if (openings.length === 0) {
    if (!room.windowless) gaps.push("Windows or windowless");
  } else {
    const unfaced = [
      ...new Set(
        openings.flatMap((opening) =>
          opening.wall !== undefined && opening.facing === undefined ? [opening.wall] : [],
        ),
      ),
    ];
    if (unfaced.length > 0) gaps.push(`facing of ${unfaced.join(", ")}`);
  }

  if (room.timesOfUse.length === 0) gaps.push("times of use");
  for (const part of SURFACE_PARTS) if (!surfaces.has(part)) gaps.push(`${part} Surface`);
  return gaps;
}
