import { CoreError } from "../errors.js";
import { type NamedRecord, named } from "../render.js";
import type { LevelRow, RoomRow, WallRow } from "../store.js";
import type { HomeModel } from "./model.js";
import { sameName } from "./writer.js";

// Finding the records a call names, within its Home only, with errors that list what exists.

export const active = <T extends { archivedAt: string | null }>(row: T): boolean =>
  row.archivedAt === null;

/** A Room by slug, or else by name. */
export function findRoom(rooms: RoomRow[], wanted: string): RoomRow | undefined {
  return (
    rooms.find((room) => room.slug === wanted) ?? rooms.find((room) => sameName(room.name, wanted))
  );
}

/** A Room of the Home, by slug or name: one not Archived, or with `archived` any. */
export function requireRoom(
  model: HomeModel,
  wanted: string,
  { archived = false }: { archived?: boolean } = {},
): RoomRow {
  const current = model.rooms.filter(active);
  const room = findRoom(current, wanted) ?? (archived ? findRoom(model.rooms, wanted) : undefined);
  if (room) return room;
  throw new CoreError(
    "not_found",
    current.length === 0
      ? `This Home has no Room "${wanted}": it has no Rooms recorded yet.`
      : `This Home has no Room "${wanted}". Its Rooms are ${list(current)}.`,
  );
}

/** A Room's Wall, not Archived, by position. */
export function requireWall(model: HomeModel, room: RoomRow, position: number): WallRow {
  const walls = model.walls
    .filter((wall) => wall.roomId === room.id && active(wall))
    .sort((a, b) => a.position - b.position);
  const wall = walls.find((each) => each.position === position);
  if (wall) return wall;
  throw new CoreError(
    "not_found",
    `${named(room)} has no Wall ${position}` +
      (walls.length > 0 ? `; its Walls are ${walls.map((each) => each.slug).join(", ")}` : " yet") +
      ". Add it in `walls` (the same call will do), then refer to it by its position.",
  );
}

/** Storey 0, which create_home always adds; the lowest Level if it was ever missing. */
export function groundLevel(levels: LevelRow[]): LevelRow | undefined {
  return levels.find((level) => level.storey === 0) ?? levels[0];
}

export function findLevel(levels: LevelRow[], wanted: string): LevelRow | undefined {
  return levels.find((level) => level.slug === wanted || sameName(level.name, wanted));
}

export function list(records: NamedRecord[]): string {
  return records.map(named).join(", ");
}
