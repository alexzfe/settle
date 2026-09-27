import type { CompassPoint, Obstruction, RoomDetail } from "./operations/schemas.js";
import { optional } from "./optional.js";

/**
 * One way daylight reaches a Room: a Window, or a glazed Door leading outside or onto an outdoor
 * Room. A Door's glazed field has always meant that the door counts as a light source (French
 * doors, a balcony door); nothing read the field until now, so a Room whose only glazing was a
 * balcony door had to be marked windowless to clear its Gap, and then read as dark.
 *
 * A glazed Door between two indoor Rooms is borrowed light, not daylight, and is left out until
 * the case comes up.
 */
export interface DaylightOpening {
  slug: string;
  kind: "window" | "glazed door";
  /** The Wall it sits in, by slug; absent for a skylight and for a Door on no recorded Wall. */
  wall?: string;
  /** True for a skylight, whose facing is its own rather than a Wall's. */
  roof?: boolean;
  /** The direction it faces: its Wall's, or a skylight's own. */
  facing?: CompassPoint;
  /** How much sky it sees, from its Wall. */
  obstruction?: Obstruction;
  /** True when deciduous trees do the blocking, so it is bare in winter. */
  deciduous?: boolean;
}

/** The Room's daylight openings, Windows first, then glazed Doors, each in the order recorded. */
export function daylightOpenings(room: Omit<RoomDetail, "gaps">): DaylightOpening[] {
  const walls = new Map(room.walls.map((wall) => [wall.slug, wall]));
  const openings: DaylightOpening[] = [];

  for (const window of room.windows) {
    if (window.wall === "roof") {
      openings.push({
        slug: window.slug,
        kind: "window",
        roof: true,
        ...optional({ facing: window.roofFacing }),
      });
      continue;
    }
    const wall = walls.get(window.wall);
    openings.push({
      slug: window.slug,
      kind: "window",
      wall: window.wall,
      ...optional({
        facing: wall?.facing,
        obstruction: wall?.obstruction,
        deciduous: wall?.deciduous,
      }),
    });
  }

  for (const door of room.doors) {
    if (!door.glazed) continue;
    if (door.to !== "outside" && door.to !== "outdoor-room") continue;
    const wall = door.wall === undefined ? undefined : walls.get(door.wall);
    openings.push({
      slug: door.slug,
      kind: "glazed door",
      ...optional({
        wall: door.wall,
        facing: wall?.facing,
        obstruction: wall?.obstruction,
        deciduous: wall?.deciduous,
      }),
    });
  }

  return openings;
}
