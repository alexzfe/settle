import { CoreError } from "../errors.js";
import { isMeasurement, type NamedRecord, named } from "../render.js";
import type {
  BlueprintPageRow,
  BlueprintRow,
  HomeRow,
  LevelRow,
  RoomRow,
  Store,
  WallRow,
} from "../store.js";
import type { HomeModel } from "./model.js";
import type { Measurement } from "./schemas.js";
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

/** A Blueprint by its label and slug: "Agent plan (agent-plan)". */
export function blueprintName(blueprint: BlueprintRow): string {
  return named({ name: blueprint.label, slug: blueprint.slug });
}

export function requireBlueprint(blueprints: BlueprintRow[], slug: string): BlueprintRow {
  const blueprint = blueprints.find((each) => each.slug === slug);
  if (blueprint) return blueprint;
  throw new CoreError(
    "not_found",
    `This Home has no Blueprint "${slug}". ${blueprintsText(blueprints)}`,
  );
}

export function requirePage(
  pages: BlueprintPageRow[],
  blueprint: BlueprintRow,
  page: number,
): BlueprintPageRow {
  const row = pages.find((each) => each.blueprintId === blueprint.id && each.page === page);
  if (row) return row;
  throw new CoreError(
    "not_found",
    `${blueprintName(blueprint)} has no page ${page}: it has ${pageRange(blueprint.pageCount)}.`,
  );
}

/**
 * The Blueprint sources of a write: every length with blueprint Provenance must carry a source
 * naming a page of one of this Home's Blueprints, and a source goes with blueprint Provenance
 * only. Refuses the whole write, naming the field, before anything is stored.
 */
export function requireSources(store: Store, home: HomeRow, input: unknown): void {
  let blueprints: BlueprintRow[] | undefined;
  eachMeasurement(input, "", (measurement, where) => {
    const { provenance, source } = measurement;
    if (provenance !== "blueprint") {
      if (!source) return;
      throw new CoreError(
        "validation",
        `${where} has a source but ${provenance} Provenance. A source goes only with blueprint ` +
          "Provenance, for a figure printed on a Blueprint: leave the source out, or make the " +
          "Provenance blueprint.",
      );
    }
    if (!source) {
      throw new CoreError(
        "validation",
        `${where} has blueprint Provenance but no source. Give source { blueprint, page, ` +
          "printed } with the text exactly as printed; a length scaled off the drawing is " +
          "estimated.",
      );
    }
    blueprints ??= store.list("blueprints", home.id);
    const blueprint = blueprints.find((each) => each.slug === source.blueprint);
    if (!blueprint) {
      throw new CoreError(
        "not_found",
        `${where} names Blueprint "${source.blueprint}", which this Home does not have. ` +
          blueprintsText(blueprints),
      );
    }
    if (source.page > blueprint.pageCount) {
      throw new CoreError(
        "not_found",
        `${where} names page ${source.page} of ${blueprintName(blueprint)}, which has ` +
          `${pageRange(blueprint.pageCount)}.`,
      );
    }
  });
}

/** Calls `visit` with every length in `value`, and where it is ("walls.3.length"). */
function eachMeasurement(
  value: unknown,
  path: string,
  visit: (measurement: Measurement, where: string) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((each, index) => {
      eachMeasurement(each, `${path}.${index}`, visit);
    });
  } else if (isMeasurement(value)) {
    visit(value, path);
  } else if (typeof value === "object" && value !== null && !(value instanceof Uint8Array)) {
    for (const [key, each] of Object.entries(value)) {
      eachMeasurement(each, path ? `${path}.${key}` : key, visit);
    }
  }
}

function blueprintsText(blueprints: BlueprintRow[]): string {
  return blueprints.length === 0
    ? "It has no Blueprints yet: the user uploads them on the Home's page in the app."
    : `Its Blueprints are ${blueprints.map(blueprintName).join(", ")}.`;
}

function pageRange(count: number): string {
  return count === 1 ? "only page 1" : `pages 1 to ${count}`;
}
