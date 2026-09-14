import type { SQLInputValue, StatementSync } from "node:sqlite";
import { migrate } from "./migrate.js";
import type {
  BuildingType,
  Color,
  CompassPoint,
  Condition,
  DoorSideBKind,
  FeatureKind,
  GlassKind,
  ItemCategory,
  Light,
  Material,
  Measurement,
  Obstruction,
  PlannedStay,
  RoomFunction,
  SurfacePart,
  Tenure,
  TimeOfUse,
  WindowKind,
} from "./operations/schemas.js";

// The store seam: every SQL statement core runs is in this file.
//
// Rows use camelCase keys for snake_case columns (roomAId is room_a_id). A value with Provenance
// is one Measurement key over the column triple <field>_mm, <field>_prov, <field>_src.

export interface HomeRow {
  id: number;
  slug: string;
  name: string;
  country: string;
  city: string;
  latitude: number;
  homeFolderPath: string | null;
  tenure: Tenure | null;
  plannedStay: PlannedStay | null;
  buildingType: BuildingType | null;
  buildingEra: string | null;
  lift: boolean | null;
  liftDoorWidth: Measurement | null;
  liftCarDepth: Measurement | null;
  accessWidth: Measurement | null;
  accessNote: string | null;
}

export interface LevelRow {
  id: number;
  homeId: number;
  slug: string;
  name: string;
  storey: number;
}

export interface RoomRow {
  id: number;
  homeId: number;
  levelId: number;
  slug: string;
  name: string;
  functions: RoomFunction[];
  outdoor: boolean;
  ceilingHeight: Measurement | null;
  timesOfUse: TimeOfUse[];
  windowless: boolean;
  archivedAt: string | null;
  archivedReason: string | null;
}

export interface WallRow {
  id: number;
  homeId: number;
  roomId: number;
  /** <room slug>/wall-<position> */
  slug: string;
  position: number;
  length: Measurement | null;
  facing: CompassPoint | null;
  beyondKind: "room" | "outside" | "unknown";
  beyondRoomId: number | null;
  label: string | null;
  obstruction: Obstruction | null;
  deciduous: boolean | null;
  archivedAt: string | null;
}

export interface WindowRow {
  id: number;
  homeId: number;
  roomId: number;
  slug: string;
  /** Null for a roof window. */
  wallId: number | null;
  roofFacing: CompassPoint | null;
  kind: WindowKind | null;
  width: Measurement | null;
  height: Measurement | null;
  sillHeight: Measurement | null;
  offset: Measurement | null;
  glass: GlassKind | null;
  archivedAt: string | null;
}

export interface DoorRow {
  id: number;
  homeId: number;
  slug: string;
  roomAId: number;
  wallAId: number | null;
  sideBKind: DoorSideBKind;
  roomBId: number | null;
  wallBId: number | null;
  clearWidth: Measurement | null;
  height: Measurement | null;
  offset: Measurement | null;
  glazed: boolean | null;
  noDoor: boolean | null;
  archivedAt: string | null;
}

export interface SurfaceRow {
  id: number;
  homeId: number;
  slug: string;
  roomId: number;
  part: SurfacePart;
  /** Set for a whole-Wall exception to the Room's walls Surface. */
  wallId: number | null;
  materials: Material[] | null;
  color: Color | null;
  finish: string | null;
}

export interface FeatureRow {
  id: number;
  homeId: number;
  roomId: number;
  slug: string;
  kind: FeatureKind;
  description: string | null;
  wallId: number | null;
  positionNote: string | null;
  width: Measurement | null;
  height: Measurement | null;
  depth: Measurement | null;
  light: Light | null;
  archivedAt: string | null;
  archivedReason: string | null;
  replacedByFeatureId: number | null;
}

export interface ItemRow {
  id: number;
  homeId: number;
  slug: string;
  name: string;
  category: ItemCategory;
  quantity: number;
  /** Null for an Unplaced Item. */
  roomId: number | null;
  wallId: number | null;
  positionNote: string | null;
  width: Measurement | null;
  depth: Measurement | null;
  height: Measurement | null;
  colors: Color[] | null;
  materials: string[] | null;
  condition: Condition | null;
  brand: string | null;
  model: string | null;
  price: string | null;
  link: string | null;
  light: Light | null;
  archivedAt: string | null;
  archivedReason: string | null;
  replacedByItemId: number | null;
}

export interface ConstraintRow {
  id: number;
  homeId: number;
  slug: string;
  text: string;
  archivedAt: string | null;
  archivedReason: string | null;
}

export interface NoteRow {
  id: number;
  homeId: number;
  slug: string;
  text: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface SessionSummary {
  changed: string;
  open: string;
  next: string;
}

export interface SessionRow {
  id: number;
  homeId: number;
  slug: string;
  openedAt: string;
  closedAt: string | null;
  skills: string[];
  openingSent: string[];
  summary: SessionSummary | null;
}

export interface ChangeRow {
  homeId: number;
  at: string;
  /** The Session slug, or "web". */
  origin: string;
  recordKind: string;
  recordId: number;
  recordSlug: string;
  /** Null when the record was created. */
  field: string | null;
  old: unknown;
  new: unknown;
  /** Why, when the write said: an override of Provenance, a removal. */
  reason: string | null;
}

/** The tables of the Home model, each row carrying home_id, by row type. */
export interface HomeTables {
  levels: LevelRow;
  rooms: RoomRow;
  walls: WallRow;
  windows: WindowRow;
  doors: DoorRow;
  surfaces: SurfaceRow;
  features: FeatureRow;
  items: ItemRow;
  constraints: ConstraintRow;
  notes: NoteRow;
}

export type HomeTable = keyof HomeTables;
type Tables = HomeTables & { homes: HomeRow };
type Table = keyof Tables;
type NewRow<T extends Table> = Omit<Tables[T], "id">;
type Patch<T extends Table> = Partial<Omit<Tables[T], "id" | "homeId">>;

type SluggedTable = "homes" | "sessions" | HomeTable;

export interface Store {
  /** Runs `fn` in one transaction, rolled back if it throws. `fn` must be synchronous. */
  transaction<T>(fn: () => T): T;

  insertHome(home: Pick<HomeRow, "slug" | "name" | "country" | "city" | "latitude">): HomeRow;
  home(slug: string): HomeRow | undefined;
  homes(): HomeRow[];
  setHomeFolderPath(homeId: number, path: string): void;

  insertLevel(level: Omit<LevelRow, "id">): LevelRow;
  /** In storey order. */
  levels(homeId: number): LevelRow[];
  deleteLevel(levelId: number): void;

  insertRoom(room: Pick<RoomRow, "homeId" | "levelId" | "slug" | "name">): RoomRow;
  /** Archived ones too: by storey of their Level, then in the order they were recorded. */
  rooms(homeId: number): RoomRow[];
  room(homeId: number, slug: string): RoomRow | undefined;
  setRoomLevel(roomId: number, levelId: number): void;

  /** Adds a row to a table of the Home model, or to homes. */
  insert<T extends Table>(table: T, row: NewRow<T>): Tables[T];
  /** Changes the given fields of one row; fields left out stay as they are. */
  update<T extends Table>(table: T, id: number, patch: Patch<T>): void;
  /** Every row of a Home in `table`, Archived ones too, in the order they were recorded. */
  list<T extends HomeTable>(table: T, homeId: number): Tables[T][];

  insertSession(session: Omit<SessionRow, "id">): SessionRow;
  /** Looks across every Home: Session slugs are unique app-wide. */
  session(slug: string): SessionRow | undefined;
  /** Newest first. */
  sessions(homeId: number): SessionRow[];
  updateSession(session: SessionRow): void;

  appendChange(change: ChangeRow): void;
  /** Oldest first. */
  changes(homeId: number): ChangeRow[];

  /** Whether a record in `table` has `slug`, within `homeId` for the Home-scoped tables. */
  slugTaken(table: SluggedTable, slug: string, homeId?: number): boolean;

  close(): void;
}

const SESSION_COLUMNS =
  "id, home_id AS homeId, slug, opened_at AS openedAt, closed_at AS closedAt, skills, " +
  "opening_sent AS openingSent, summary";

// Columns that are not plain text or numbers. Every other column maps to its camelCase key as is.
const MEASUREMENT_KEYS = new Set([
  "liftDoorWidth",
  "liftCarDepth",
  "accessWidth",
  "ceilingHeight",
  "length",
  "width",
  "height",
  "depth",
  "sillHeight",
  "offset",
  "clearWidth",
]);
const BOOLEAN_KEYS = new Set(["lift", "outdoor", "windowless", "deciduous", "glazed", "noDoor"]);
const JSON_KEYS = new Set(["functions", "timesOfUse", "materials", "color", "colors", "light"]);
const MEASUREMENT_COLUMN = /^(.+)_(mm|prov|src)$/;

const column = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const key = (name: string) =>
  name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The columns and SQL values for one row key. */
function encode(field: string, value: unknown): [string, SQLInputValue][] {
  const name = column(field);
  if (MEASUREMENT_KEYS.has(field)) {
    const measurement = value as Measurement | null;
    return [
      [`${name}_mm`, measurement?.mm ?? null],
      [`${name}_prov`, measurement?.provenance ?? null],
      [`${name}_src`, measurement?.source ? JSON.stringify(measurement.source) : null],
    ];
  }
  if (value === null || value === undefined) return [[name, null]];
  if (BOOLEAN_KEYS.has(field)) return [[name, value ? 1 : 0]];
  if (JSON_KEYS.has(field)) return [[name, JSON.stringify(value)]];
  return [[name, value as SQLInputValue]];
}

/** A row as read from SQLite, into its camelCase row type. */
function decode<T>(raw: Record<string, unknown>): T {
  const row: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const triple = MEASUREMENT_COLUMN.exec(name);
    if (triple) {
      if (triple[2] !== "mm") continue;
      const base = triple[1] as string;
      const source = raw[`${base}_src`];
      row[key(base)] =
        value === null
          ? null
          : {
              mm: value,
              provenance: raw[`${base}_prov`],
              ...(typeof source === "string" ? { source: JSON.parse(source) } : {}),
            };
      continue;
    }
    const field = key(name);
    if (value === null) row[field] = null;
    else if (BOOLEAN_KEYS.has(field)) row[field] = value === 1;
    else if (JSON_KEYS.has(field)) row[field] = JSON.parse(value as string);
    else row[field] = value;
  }
  return row as T;
}

/** Opens and migrates the SQLite database at `path` (a file, or ":memory:"). */
export function openStore(path: string): Store {
  const db = migrate(path);
  const statements = new Map<string, StatementSync>();
  const statement = (sql: string) => {
    let prepared = statements.get(sql);
    if (!prepared) {
      prepared = db.prepare(sql);
      statements.set(sql, prepared);
    }
    return prepared;
  };
  const all = <T>(sql: string, ...params: SQLInputValue[]) =>
    statement(sql).all(...params) as unknown as T[];
  const get = <T>(sql: string, ...params: SQLInputValue[]) =>
    statement(sql).get(...params) as unknown as T | undefined;
  const run = (sql: string, ...params: SQLInputValue[]) => statement(sql).run(...params);
  const rows = <T>(sql: string, ...params: SQLInputValue[]) =>
    all<Record<string, unknown>>(sql, ...params).map((raw) => decode<T>(raw));
  const one = <T>(sql: string, ...params: SQLInputValue[]) => {
    const raw = get<Record<string, unknown>>(sql, ...params);
    return raw && decode<T>(raw);
  };

  function insert<T extends Table>(table: T, row: NewRow<T>): Tables[T] {
    const pairs = Object.entries(row).flatMap(([field, value]) => encode(field, value));
    const id = Number(
      run(
        `INSERT INTO ${table} (${pairs.map(([name]) => name).join(", ")})
         VALUES (${pairs.map(() => "?").join(", ")})`,
        ...pairs.map(([, value]) => value),
      ).lastInsertRowid,
    );
    const inserted = one<Tables[T]>(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!inserted) throw new Error(`The new row of ${table} was not found`);
    return inserted;
  }

  function update<T extends Table>(table: T, id: number, patch: Patch<T>): void {
    const pairs = Object.entries(patch)
      .filter(([, value]) => value !== undefined)
      .flatMap(([field, value]) => encode(field, value));
    if (pairs.length === 0) return;
    run(
      `UPDATE ${table} SET ${pairs.map(([name]) => `${name} = ?`).join(", ")} WHERE id = ?`,
      ...pairs.map(([, value]) => value),
      id,
    );
  }

  return {
    transaction(fn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    insertHome: (home) => insert("homes", { ...home, homeFolderPath: null } as NewRow<"homes">),
    home: (slug) => one<HomeRow>("SELECT * FROM homes WHERE slug = ?", slug),
    homes: () => rows<HomeRow>("SELECT * FROM homes ORDER BY name, id"),
    setHomeFolderPath(homeId, path) {
      run("UPDATE homes SET home_folder_path = ? WHERE id = ?", path, homeId);
    },

    insertLevel: (level) => insert("levels", level),
    levels: (homeId) =>
      rows<LevelRow>("SELECT * FROM levels WHERE home_id = ? ORDER BY storey, id", homeId),
    deleteLevel(levelId) {
      run("DELETE FROM levels WHERE id = ?", levelId);
    },

    insertRoom: (room) => insert("rooms", room as NewRow<"rooms">),
    rooms: (homeId) =>
      rows<RoomRow>(
        `SELECT rooms.* FROM rooms JOIN levels ON levels.id = rooms.level_id
         WHERE rooms.home_id = ? ORDER BY levels.storey, rooms.id`,
        homeId,
      ),
    room: (homeId, slug) =>
      one<RoomRow>("SELECT * FROM rooms WHERE home_id = ? AND slug = ?", homeId, slug),
    setRoomLevel(roomId, levelId) {
      run("UPDATE rooms SET level_id = ? WHERE id = ?", levelId, roomId);
    },

    insert,
    update,
    list: <T extends HomeTable>(table: T, homeId: number) =>
      rows<Tables[T]>(`SELECT * FROM ${table} WHERE home_id = ? ORDER BY id`, homeId),

    insertSession(session) {
      const id = Number(
        run(
          `INSERT INTO sessions (home_id, slug, opened_at, closed_at, skills, opening_sent, summary)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          session.homeId,
          session.slug,
          session.openedAt,
          session.closedAt,
          JSON.stringify(session.skills),
          JSON.stringify(session.openingSent),
          session.summary && JSON.stringify(session.summary),
        ).lastInsertRowid,
      );
      return { id, ...session };
    },
    session(slug) {
      const row = get<RawSession>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE slug = ?`, slug);
      return row && parseSession(row);
    },
    sessions: (homeId) =>
      all<RawSession>(
        `SELECT ${SESSION_COLUMNS} FROM sessions WHERE home_id = ? ORDER BY opened_at DESC, id DESC`,
        homeId,
      ).map(parseSession),
    updateSession(session) {
      run(
        `UPDATE sessions SET closed_at = ?, skills = ?, opening_sent = ?, summary = ?
         WHERE id = ?`,
        session.closedAt,
        JSON.stringify(session.skills),
        JSON.stringify(session.openingSent),
        session.summary && JSON.stringify(session.summary),
        session.id,
      );
    },

    appendChange(change) {
      run(
        `INSERT INTO change_log
           (home_id, at, origin, record_kind, record_id, record_slug, field, old, new, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        change.homeId,
        change.at,
        change.origin,
        change.recordKind,
        change.recordId,
        change.recordSlug,
        change.field,
        change.old === undefined ? null : JSON.stringify(change.old),
        change.new === undefined ? null : JSON.stringify(change.new),
        change.reason,
      );
    },
    changes: (homeId) =>
      all<RawChange>(
        `SELECT home_id AS homeId, at, origin, record_kind AS recordKind, record_id AS recordId,
           record_slug AS recordSlug, field, old, new, reason
         FROM change_log WHERE home_id = ? ORDER BY id`,
        homeId,
      ).map((row) => ({
        ...row,
        old: row.old === null ? undefined : JSON.parse(row.old),
        new: row.new === null ? undefined : JSON.parse(row.new),
      })),

    slugTaken(table, slug, homeId) {
      const scoped = table !== "homes" && table !== "sessions";
      const sql = scoped
        ? `SELECT 1 FROM ${table} WHERE slug = ? AND home_id = ?`
        : `SELECT 1 FROM ${table} WHERE slug = ?`;
      return (scoped ? get(sql, slug, homeId ?? null) : get(sql, slug)) !== undefined;
    },

    close: () => db.close(),
  };
}

interface RawSession extends Omit<SessionRow, "skills" | "openingSent" | "summary"> {
  skills: string;
  openingSent: string;
  summary: string | null;
}

interface RawChange extends Omit<ChangeRow, "old" | "new"> {
  old: string | null;
  new: string | null;
}

function parseSession(row: RawSession): SessionRow {
  return {
    ...row,
    skills: JSON.parse(row.skills) as string[],
    openingSent: JSON.parse(row.openingSent) as string[],
    summary: row.summary === null ? null : (JSON.parse(row.summary) as SessionSummary),
  };
}
