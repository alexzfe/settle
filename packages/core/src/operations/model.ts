import { roomGaps } from "../gaps.js";
import { optional } from "../optional.js";
import { featureName, type OverviewView } from "../render.js";
import type {
  ConstraintRow,
  DoorRow,
  FeatureRow,
  HomeRow,
  ItemRow,
  LevelRow,
  NoteRow,
  RoomRow,
  Store,
  SurfaceRow,
  WallRow,
  WindowRow,
} from "../store.js";
import { toHome, toLevel } from "./homes.js";
import {
  type Constraint,
  type Door,
  type Feature,
  type Item,
  type LightSource,
  type NamedRef,
  type Note,
  type RoomDetail,
  SURFACE_PARTS,
  type Surface,
  type Wall,
  type Window,
} from "./schemas.js";

/** Every row of one Home, Archived ones too, as one operation reads them. */
export interface HomeModel {
  home: HomeRow;
  /** In storey order. */
  levels: LevelRow[];
  /** By storey of their Level, then in the order they were recorded. */
  rooms: RoomRow[];
  walls: WallRow[];
  windows: WindowRow[];
  doors: DoorRow[];
  surfaces: SurfaceRow[];
  features: FeatureRow[];
  items: ItemRow[];
  constraints: ConstraintRow[];
}

export function loadHome(store: Store, home: HomeRow): HomeModel {
  return {
    home,
    levels: store.levels(home.id),
    rooms: store.rooms(home.id),
    walls: store.list("walls", home.id),
    windows: store.list("windows", home.id),
    doors: store.list("doors", home.id),
    surfaces: store.list("surfaces", home.id),
    features: store.list("features", home.id),
    items: store.list("items", home.id),
    constraints: store.list("constraints", home.id),
  };
}

const active = <T extends { archivedAt: string | null }>(row: T) => row.archivedAt === null;

/** The Home Overview's content: the Home's facts, Constraints in force, and its Rooms. */
export function overviewView(model: HomeModel): OverviewView {
  return {
    home: toHome(model.home),
    levels: model.levels.map(toLevel),
    constraints: model.constraints.filter(active).map(toConstraint),
    unplacedItems: model.items.filter((item) => active(item) && item.roomId === null).length,
    rooms: model.rooms.filter(active).map((room) => roomDetail(model, room)),
  };
}

/** Everything on a Room's Room Sheet: its current state, without Archived parts. */
export function roomDetail(model: HomeModel, room: RoomRow): RoomDetail {
  const level = model.levels.find((each) => each.id === room.levelId);
  if (!level) throw new Error(`Room ${room.slug} is on a Level its Home does not have`);
  const walls = model.walls
    .filter((wall) => wall.roomId === room.id && active(wall))
    .sort((a, b) => a.position - b.position);
  const features = model.features.filter(
    (feature) => feature.roomId === room.id && active(feature),
  );
  const items = model.items.filter((item) => item.roomId === room.id && active(item));
  const lights: LightSource[] = [
    ...features.flatMap((feature) =>
      feature.light
        ? [
            {
              source: "feature" as const,
              slug: feature.slug,
              name: featureName(feature.kind, feature.description ?? undefined),
              light: feature.light,
            },
          ]
        : [],
    ),
    ...items.flatMap((item) =>
      item.light
        ? [{ source: "item" as const, slug: item.slug, name: item.name, light: item.light }]
        : [],
    ),
  ];
  const detail: Omit<RoomDetail, "gaps"> = {
    slug: room.slug,
    name: room.name,
    level: toLevel(level),
    functions: room.functions,
    outdoor: room.outdoor,
    ...optional({
      ceilingHeight: room.ceilingHeight,
      archivedAt: room.archivedAt,
      archivedReason: room.archivedReason,
    }),
    timesOfUse: room.timesOfUse,
    windowless: room.windowless,
    walls: walls.map((wall) => toWall(model, wall)),
    windows: model.windows
      .filter((window) => window.roomId === room.id && active(window))
      .map((window) => toWindow(model, window)),
    doors: model.doors
      .filter((door) => active(door) && (door.roomAId === room.id || door.roomBId === room.id))
      .map((door) => toDoor(model, door, room)),
    surfaces: SURFACE_PARTS.flatMap((part) => {
      const row = model.surfaces.find(
        (surface) => surface.roomId === room.id && surface.part === part && surface.wallId === null,
      );
      return row && hasContent(row) ? [toSurface(model, row)] : [];
    }),
    features: features.map((feature) => toFeature(model, feature)),
    items: items.map((item) => toItem(model, item)),
    lights,
  };
  return { ...detail, gaps: roomGaps(detail) };
}

function toWall(model: HomeModel, wall: WallRow): Wall {
  const beyond = wall.beyondRoomId === null ? undefined : roomById(model, wall.beyondRoomId);
  const surface = model.surfaces.find((each) => each.wallId === wall.id);
  return {
    slug: wall.slug,
    position: wall.position,
    beyond: {
      kind: wall.beyondKind,
      ...(beyond
        ? { room: { slug: beyond.slug, name: beyond.name, outdoor: beyond.outdoor } }
        : {}),
    },
    ...optional({
      length: wall.length,
      facing: wall.facing,
      label: wall.label,
      obstruction: wall.obstruction,
      deciduous: wall.deciduous,
      surface: surface && hasContent(surface) ? toSurface(model, surface) : undefined,
    }),
  };
}

function toWindow(model: HomeModel, window: WindowRow): Window {
  return {
    slug: window.slug,
    wall: window.wallId === null ? "roof" : wallSlug(model, window.wallId),
    ...optional({
      roofFacing: window.roofFacing,
      kind: window.kind,
      width: window.width,
      height: window.height,
      sillHeight: window.sillHeight,
      offset: window.offset,
      glass: window.glass,
    }),
  };
}

/** A Door as seen from `room`, one of the two Rooms it joins. */
function toDoor(model: HomeModel, door: DoorRow, room: RoomRow): Door {
  const sideA = door.roomAId === room.id;
  const otherId = sideA ? door.roomBId : door.roomAId;
  const other = otherId === null ? undefined : roomById(model, otherId);
  const to = other ? (other.outdoor ? "outdoor-room" : "room") : door.sideBKind;
  const wallId = sideA ? door.wallAId : door.wallBId;
  const otherWallId = sideA ? door.wallBId : door.wallAId;
  return {
    slug: door.slug,
    to,
    sideA,
    ...optional({
      wall: wallId === null ? undefined : wallSlug(model, wallId),
      otherRoom: other && ref(other),
      otherWall: otherWallId === null ? undefined : wallSlug(model, otherWallId),
      clearWidth: door.clearWidth,
      height: door.height,
      offset: door.offset,
      glazed: door.glazed,
      noDoor: door.noDoor,
    }),
  };
}

function toSurface(model: HomeModel, surface: SurfaceRow): Surface {
  return {
    slug: surface.slug,
    part: surface.part,
    ...optional({
      wall: surface.wallId === null ? undefined : wallSlug(model, surface.wallId),
      materials: surface.materials?.length ? surface.materials : undefined,
      color: surface.color,
      finish: surface.finish,
    }),
  };
}

function toFeature(model: HomeModel, feature: FeatureRow): Feature {
  return {
    slug: feature.slug,
    kind: feature.kind,
    ...optional({
      description: feature.description,
      wall: feature.wallId === null ? undefined : wallSlug(model, feature.wallId),
      positionNote: feature.positionNote,
      width: feature.width,
      height: feature.height,
      depth: feature.depth,
      light: feature.light,
      archivedAt: feature.archivedAt,
      archivedReason: feature.archivedReason,
    }),
  };
}

export function toItem(model: HomeModel, item: ItemRow): Item {
  const room = item.roomId === null ? undefined : roomById(model, item.roomId);
  return {
    slug: item.slug,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    ...optional({
      room: room && ref(room),
      wall: item.wallId === null ? undefined : wallSlug(model, item.wallId),
      positionNote: item.positionNote,
      width: item.width,
      depth: item.depth,
      height: item.height,
      colors: item.colors?.length ? item.colors : undefined,
      materials: item.materials?.length ? item.materials : undefined,
      condition: item.condition,
      brand: item.brand,
      model: item.model,
      price: item.price,
      link: item.link,
      light: item.light,
      archivedAt: item.archivedAt,
      archivedReason: item.archivedReason,
    }),
  };
}

export function toConstraint(row: ConstraintRow): Constraint {
  return {
    slug: row.slug,
    text: row.text,
    ...optional({ archivedAt: row.archivedAt, archivedReason: row.archivedReason }),
  };
}

export function toNote(row: NoteRow): Note {
  return { slug: row.slug, text: row.text, createdAt: row.createdAt };
}

export function roomById(model: HomeModel, id: number): RoomRow {
  const room = model.rooms.find((each) => each.id === id);
  if (!room) throw new Error(`Room ${id} is not in Home ${model.home.slug}`);
  return room;
}

export function wallSlug(model: HomeModel, id: number): string {
  const wall = model.walls.find((each) => each.id === id);
  if (!wall) throw new Error(`Wall ${id} is not in Home ${model.home.slug}`);
  return wall.slug;
}

const ref = (room: RoomRow): NamedRef => ({ slug: room.slug, name: room.name });

/** Whether a Surface has anything recorded. */
export function hasContent(surface: SurfaceRow): boolean {
  return Boolean(surface.materials?.length || surface.color || surface.finish);
}
