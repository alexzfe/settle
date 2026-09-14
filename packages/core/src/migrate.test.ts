import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "./migrate.js";

describe("migrate", () => {
  const dirs: string[] = [];
  const tempDatabase = () => {
    const dir = mkdtempSync(join(tmpdir(), "idh-core-"));
    dirs.push(dir);
    return join(dir, "test.sqlite");
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("applies every migration to an empty database and records each", () => {
    const db = migrate(":memory:");
    expect(db.prepare("SELECT id FROM migrations ORDER BY id").all()).toEqual([
      { id: 0 },
      { id: 1 },
    ]);
    db.close();
  });

  it("applies nothing a second time", () => {
    const path = tempDatabase();
    migrate(path).close();
    const db = migrate(path);
    expect(db.prepare("SELECT count(*) AS n FROM migrations").get()).toEqual({ n: 2 });
    db.close();
  });

  it("creates the slice 1 tables", () => {
    const db = migrate(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
      "change_log",
      "homes",
      "levels",
      "migrations",
      "rooms",
      "sessions",
      "settings",
    ]);
    db.close();
  });

  it("turns on WAL and foreign keys", () => {
    const db = migrate(tempDatabase());
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });
});
