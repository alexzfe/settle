import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "./migrate.js";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

describe("migrate", () => {
  const dirs: string[] = [];
  const tempDatabase = () => {
    const dir = mkdtempSync(join(tmpdir(), "settle-core-"));
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
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
      { id: 6 },
      { id: 7 },
      { id: 8 },
      { id: 9 },
      { id: 10 },
      { id: 11 },
    ]);
    db.close();
  });

  it("applies nothing a second time", () => {
    const path = tempDatabase();
    migrate(path).close();
    const db = migrate(path);
    expect(db.prepare("SELECT count(*) AS n FROM migrations").get()).toEqual({ n: 12 });
    db.close();
  });

  it("marks each Basis entry automatic or given, given by default", () => {
    const db = migrate(":memory:");
    const columns = db.prepare("PRAGMA table_info(decision_basis)").all();
    expect(columns).toContainEqual(
      expect.objectContaining({ name: "automatic", notnull: 1, dflt_value: "0" }),
    );
    db.close();
  });

  it("records the field a value_changed flag's source changed", () => {
    const db = migrate(":memory:");
    const columns = db.prepare("PRAGMA table_info(flags)").all();
    expect(columns).toContainEqual(expect.objectContaining({ name: "source_field", notnull: 0 }));
    db.close();
  });

  it("gives the Quick Guide's own lines a kind, avoid when they begin Avoid and test otherwise, and leaves the looking-for line empty", () => {
    const path = tempDatabase();
    const early = new DatabaseSync(path);
    // Guides rows alone, for Purchases this test never needs.
    early.exec("PRAGMA foreign_keys = OFF");
    for (const file of readdirSync(MIGRATIONS)
      .filter((each) => each < "0009")
      .sort()) {
      early.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
      early
        .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, '')")
        .run(Number(file.slice(0, 4)));
    }
    const insert = early.prepare(
      "INSERT INTO guides (home_id, decision_id, slug, quick_lines, lan_token) VALUES (1, ?, ?, ?, ?)",
    );
    insert.run(
      1,
      "rug/guides",
      JSON.stringify(["Avoid loop pile", "Rub the pile", "Ask about it"]),
      "a",
    );
    insert.run(2, "lamp/guides", "[]", "b");
    early.close();

    const db = migrate(path);
    const rows = db.prepare("SELECT quick_lines, looking_for FROM guides ORDER BY id").all();
    expect(rows.map((row) => [JSON.parse(String(row.quick_lines)), row.looking_for])).toEqual([
      [
        [
          { kind: "avoid", text: "Avoid loop pile" },
          { kind: "test", text: "Rub the pile" },
          { kind: "test", text: "Ask about it" },
        ],
        null,
      ],
      [[], null],
    ]);
    db.close();
  });

  it("moves every photo_path into photo_url, because the column has only ever held a URL", () => {
    const path = tempDatabase();
    const early = new DatabaseSync(path);
    // Listings rows alone, for Purchases this test never needs.
    early.exec("PRAGMA foreign_keys = OFF");
    for (const file of readdirSync(MIGRATIONS)
      .filter((each) => each < "0010")
      .sort()) {
      early.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
      early
        .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, '')")
        .run(Number(file.slice(0, 4)));
    }
    const insert = early.prepare(
      `INSERT INTO listings (home_id, decision_id, slug, name, photo_path, recorded_at)
       VALUES (1, 1, ?, ?, ?, '2026-09-14T10:00:00.000Z')`,
    );
    insert.run("hay-plain-rug", "Hay Plain rug", "https://shop.example/hay.jpg");
    insert.run("jute-loop-rug", "Jute loop rug", null);
    early.close();

    const db = migrate(path);
    const rows = db
      .prepare("SELECT slug, photo_path, photo_url, photo_type, rating FROM listings ORDER BY id")
      .all();
    expect(rows).toEqual([
      {
        slug: "hay-plain-rug",
        photo_path: null,
        photo_url: "https://shop.example/hay.jpg",
        photo_type: null,
        rating: null,
      },
      {
        slug: "jute-loop-rug",
        photo_path: null,
        photo_url: null,
        photo_type: null,
        rating: null,
      },
    ]);
    db.close();
  });

  it("gives a Listing its Rating, its stored picture, and its hold, and refuses stars off the scale", () => {
    const db = migrate(":memory:");
    const columns = (db.prepare("PRAGMA table_info(listings)").all() as { name: string }[]).map(
      (column) => column.name,
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "photo_url",
        "photo_path",
        "photo_type",
        "photo_version",
        "rating",
        "rating_note",
        "held_reason",
        "held_note",
        "held_at",
      ]),
    );
    const listing = (rating: number | null, heldReason: string | null) =>
      db
        .prepare(
          `INSERT INTO listings (home_id, decision_id, slug, name, rating, held_reason, recorded_at)
           VALUES (1, 1, 'rug', 'Rug', ?, ?, '')`,
        )
        .run(rating, heldReason);
    db.exec("PRAGMA foreign_keys = OFF");
    expect(() => listing(6, null)).toThrow(/CHECK/);
    expect(() => listing(0, null)).toThrow(/CHECK/);
    expect(() => listing(null, "paused")).toThrow(/CHECK/);
    db.close();
  });

  it("drops the stored Home Folder path, since the server can't see the user's disk", () => {
    const db = migrate(":memory:");
    const columns = db.prepare("SELECT name FROM pragma_table_info('homes')").all();
    expect(columns.map((column) => column.name)).not.toContain("home_folder_path");
    expect(columns.map((column) => column.name)).toContain("slug");
    db.close();
  });

  it("creates the tables of slices 1 to 6", () => {
    const db = migrate(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
      "blueprint_pages",
      "blueprints",
      "change_log",
      "conflicts",
      "constraints",
      "decision_basis",
      "decision_evidence",
      "decisions",
      "deviations",
      "doors",
      "features",
      "flags",
      "guides",
      "homes",
      "items",
      "levels",
      "listing_checks",
      "listings",
      "migrations",
      "notes",
      "requirements",
      "rooms",
      "sessions",
      "settings",
      "state_changes",
      "surfaces",
      "walls",
      "windows",
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
