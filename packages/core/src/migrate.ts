import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// One level up from both src/ and dist/.
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");
const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

interface Migration {
  id: number;
  file: string;
}

/**
 * Opens the database at `path` (a file, or ":memory:"), turns on WAL and foreign keys, and
 * applies every migration in packages/core/migrations/ not yet recorded in the `migrations`
 * table, all in one transaction. Returns the open database.
 */
export function migrate(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  // For a migration that hashes a token it stores (0021): the SHA-256 in hex, as tokenHash makes it.
  db.function("settle_sha256", { deterministic: true }, (text) =>
    createHash("sha256").update(String(text)).digest("hex"),
  );

  const applied = appliedIds(db);
  const pending = listMigrations().filter((migration) => !applied.has(migration.id));
  if (pending.length > 0) {
    inTransaction(db, () => {
      for (const migration of pending) {
        db.exec(readFileSync(join(MIGRATIONS_DIR, migration.file), "utf8"));
        // Prepared after the file runs: 0000_init is what creates the table.
        db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(
          migration.id,
          new Date().toISOString(),
        );
      }
    });
  }
  adoptOlderKeys(db);
  return db;
}

/** Runs `work` in one transaction; on failure rolls back, closes the database, and rethrows. */
function inTransaction(db: DatabaseSync, work: () => void): void {
  db.exec("BEGIN");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}

/**
 * Takes in a Home key that a Settle from before 0021 wrote into homes.token after a rollback (a
 * new Home, or its "New key…"): the key becomes that Home's one key, kept by its hash as 0021 keeps
 * keys, and the plain copy is emptied. One key replaces the Home's others because that older
 * Settle has one key per Home, so its "New key…" meant to cancel the rest. Runs on every start,
 * since 0021 runs only once.
 */
function adoptOlderKeys(db: DatabaseSync): void {
  const hasKeys = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'home_keys'")
    .get();
  if (!hasKeys) return;
  const older = db.prepare("SELECT id, token FROM homes WHERE token IS NOT NULL").all() as {
    id: number;
    token: string;
  }[];
  if (older.length === 0) return;
  const now = new Date().toISOString();
  inTransaction(db, () => {
    for (const home of older) {
      db.prepare("DELETE FROM home_keys WHERE home_id = ?").run(home.id);
      db.prepare(
        "INSERT INTO home_keys (home_id, key_hash, created_at) VALUES (?, settle_sha256(?), ?)",
      ).run(home.id, home.token, now);
      db.prepare("UPDATE homes SET token = NULL WHERE id = ?").run(home.id);
    }
  });
}

function listMigrations(): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql")) continue;
    const number = MIGRATION_FILE.exec(file)?.[1];
    if (number === undefined) {
      throw new Error(`Migration ${file} must be named NNNN_snake_case.sql`);
    }
    const id = Number(number);
    const clash = migrations.find((migration) => migration.id === id);
    if (clash) throw new Error(`Migrations ${clash.file} and ${file} share the number ${number}`);
    migrations.push({ id, file });
  }
  return migrations.sort((a, b) => a.id - b.id);
}

function appliedIds(db: DatabaseSync): Set<number> {
  const table = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'migrations'")
    .get();
  if (!table) return new Set();
  const rows = db.prepare("SELECT id FROM migrations").all();
  return new Set(rows.map((row) => Number(row.id)));
}
