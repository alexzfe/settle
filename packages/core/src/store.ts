import type { SQLInputValue, StatementSync } from "node:sqlite";
import { migrate } from "./migrate.js";

// The store seam: every SQL statement core runs is in this file.

export interface HomeRow {
  id: number;
  slug: string;
  name: string;
  country: string;
  city: string;
  latitude: number;
  homeFolderPath: string | null;
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
}

type SluggedTable = "homes" | "levels" | "rooms" | "sessions";

export interface Store {
  /** Runs `fn` in one transaction, rolled back if it throws. `fn` must be synchronous. */
  transaction<T>(fn: () => T): T;

  insertHome(home: Omit<HomeRow, "id" | "homeFolderPath">): HomeRow;
  home(slug: string): HomeRow | undefined;
  homes(): HomeRow[];
  setHomeFolderPath(homeId: number, path: string): void;

  insertLevel(level: Omit<LevelRow, "id">): LevelRow;
  /** In storey order. */
  levels(homeId: number): LevelRow[];

  insertRoom(room: Omit<RoomRow, "id">): RoomRow;
  /** By storey of their Level, then in the order they were recorded. */
  rooms(homeId: number): RoomRow[];
  room(homeId: number, slug: string): RoomRow | undefined;
  setRoomLevel(roomId: number, levelId: number): void;

  insertSession(session: Omit<SessionRow, "id">): SessionRow;
  /** Looks across every Home: Session slugs are unique app-wide. */
  session(slug: string): SessionRow | undefined;
  /** Newest first. */
  sessions(homeId: number): SessionRow[];
  updateSession(session: SessionRow): void;

  appendChange(change: ChangeRow): void;
  changes(homeId: number): ChangeRow[];

  /** Whether a record in `table` has `slug`, within `homeId` for the Home-scoped tables. */
  slugTaken(table: SluggedTable, slug: string, homeId?: number): boolean;

  close(): void;
}

const HOME_COLUMNS = "id, slug, name, country, city, latitude, home_folder_path AS homeFolderPath";
const LEVEL_COLUMNS = "id, home_id AS homeId, slug, name, storey";
const ROOM_COLUMNS =
  "rooms.id, rooms.home_id AS homeId, level_id AS levelId, rooms.slug, rooms.name";
const SESSION_COLUMNS =
  "id, home_id AS homeId, slug, opened_at AS openedAt, closed_at AS closedAt, skills, " +
  "opening_sent AS openingSent, summary";

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
  const insertedId = (sql: string, ...params: SQLInputValue[]) =>
    Number(run(sql, ...params).lastInsertRowid);

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

    insertHome(home) {
      const id = insertedId(
        "INSERT INTO homes (slug, name, country, city, latitude) VALUES (?, ?, ?, ?, ?)",
        home.slug,
        home.name,
        home.country,
        home.city,
        home.latitude,
      );
      return { id, ...home, homeFolderPath: null };
    },
    home: (slug) => get<HomeRow>(`SELECT ${HOME_COLUMNS} FROM homes WHERE slug = ?`, slug),
    homes: () => all<HomeRow>(`SELECT ${HOME_COLUMNS} FROM homes ORDER BY name, id`),
    setHomeFolderPath(homeId, path) {
      run("UPDATE homes SET home_folder_path = ? WHERE id = ?", path, homeId);
    },

    insertLevel(level) {
      const id = insertedId(
        "INSERT INTO levels (home_id, slug, name, storey) VALUES (?, ?, ?, ?)",
        level.homeId,
        level.slug,
        level.name,
        level.storey,
      );
      return { id, ...level };
    },
    levels: (homeId) =>
      all<LevelRow>(
        `SELECT ${LEVEL_COLUMNS} FROM levels WHERE home_id = ? ORDER BY storey, id`,
        homeId,
      ),

    insertRoom(room) {
      const id = insertedId(
        "INSERT INTO rooms (home_id, level_id, slug, name) VALUES (?, ?, ?, ?)",
        room.homeId,
        room.levelId,
        room.slug,
        room.name,
      );
      return { id, ...room };
    },
    rooms: (homeId) =>
      all<RoomRow>(
        `SELECT ${ROOM_COLUMNS} FROM rooms JOIN levels ON levels.id = rooms.level_id
         WHERE rooms.home_id = ? ORDER BY levels.storey, rooms.id`,
        homeId,
      ),
    room: (homeId, slug) =>
      get<RoomRow>(
        `SELECT ${ROOM_COLUMNS} FROM rooms WHERE rooms.home_id = ? AND rooms.slug = ?`,
        homeId,
        slug,
      ),
    setRoomLevel(roomId, levelId) {
      run("UPDATE rooms SET level_id = ? WHERE id = ?", levelId, roomId);
    },

    insertSession(session) {
      const id = insertedId(
        `INSERT INTO sessions (home_id, slug, opened_at, closed_at, skills, opening_sent, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        session.homeId,
        session.slug,
        session.openedAt,
        session.closedAt,
        JSON.stringify(session.skills),
        JSON.stringify(session.openingSent),
        session.summary && JSON.stringify(session.summary),
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
           (home_id, at, origin, record_kind, record_id, record_slug, field, old, new)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        change.homeId,
        change.at,
        change.origin,
        change.recordKind,
        change.recordId,
        change.recordSlug,
        change.field,
        change.old === undefined ? null : JSON.stringify(change.old),
        change.new === undefined ? null : JSON.stringify(change.new),
      );
    },
    changes: (homeId) =>
      all<RawChange>(
        `SELECT home_id AS homeId, at, origin, record_kind AS recordKind, record_id AS recordId,
           record_slug AS recordSlug, field, old, new
         FROM change_log WHERE home_id = ? ORDER BY id`,
        homeId,
      ).map((row) => ({
        ...row,
        old: row.old === null ? undefined : JSON.parse(row.old),
        new: row.new === null ? undefined : JSON.parse(row.new),
      })),

    slugTaken(table, slug, homeId) {
      const scoped = table === "levels" || table === "rooms";
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
