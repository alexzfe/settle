import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// One level up from both src/ and dist/.
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");
const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface MigrateOptions {
  /** The folder of NNNN_snake_case.sql files; packages/core/migrations/ unless a test gives one. */
  migrations?: string;
}

interface Migration {
  id: number;
  file: string;
}

/**
 * Opens the database at `path` (a file, or ":memory:"), turns on WAL and foreign keys, and
 * applies every migration in packages/core/migrations/ not yet recorded in the `migrations`
 * table, all in one transaction. Returns the open database.
 *
 * It refuses a database that holds a migration this build doesn't have: a newer Settle migrated
 * it, and this one would misread or fail on the newer schema. Before anything pending runs on a
 * file database that already had migrations, the database is copied aside to
 * `<path>.before-<NNNN>`, NNNN the first pending migration; older `before-<NNNN>` copies are
 * removed once the migrations have committed, so a failed run leaves the previous one in place.
 *
 * Migrations run as SQLite's procedure for altering tables asks: foreign keys off, so a table can
 * be rebuilt (created anew, copied, the old one dropped, the new one renamed) without the drop
 * cascading to the rows that refer to it; then `foreign_key_check` before COMMIT, so a row left
 * pointing at nothing fails the whole run.
 */
export function migrate(path: string, options: MigrateOptions = {}): DatabaseSync {
  const folder = options.migrations ?? MIGRATIONS_DIR;
  // Another connection holding the write lock (an operator's sqlite3, a deploy's overlap) makes a
  // write wait for it, not fail at once.
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    // For a migration that hashes a token it stores (0021): the SHA-256 in hex, as tokenHash makes it.
    db.function("settle_sha256", { deterministic: true }, (text) =>
      createHash("sha256").update(String(text)).digest("hex"),
    );
    const migrations = listMigrations(folder);
    const applied = appliedIds(db);
    refuseNewer(path, migrations, applied);
    const pending = migrations.filter((migration) => !applied.has(migration.id));
    if (pending.length === 0) {
      adoptOlderKeys(db);
      return db;
    }
    const copy =
      path !== ":memory:" && applied.size > 0 ? copyAside(db, path, pending[0] as Migration) : null;
    applyAll(db, folder, pending);
    if (copy) removeOlderCopies(path, copy);
    adoptOlderKeys(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Takes in a Home key that v2.1.0 wrote into homes.token after a rollback (a new Home, or its
 * "New key…"), which this build doesn't hold yet: it becomes that Home's one key, kept by its hash
 * as 0021 keeps keys. One key replaces the Home's others because v2.1.0 has one key per Home, so
 * its "New key…" meant to cancel the rest. A key this build already holds (the copy it keeps in
 * step itself) changes nothing. The copy stays, for the next rollback. Runs on every start, since
 * 0021 runs only once.
 */
function adoptOlderKeys(db: DatabaseSync): void {
  const hasKeys = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'home_keys'")
    .get();
  if (!hasKeys) return;
  const unknown = db
    .prepare(
      `SELECT id, token FROM homes WHERE token IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM home_keys
         WHERE home_keys.home_id = homes.id AND home_keys.key_hash = settle_sha256(homes.token)
       )`,
    )
    .all() as { id: number; token: string }[];
  if (unknown.length === 0) return;
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const home of unknown) {
      db.prepare("DELETE FROM home_keys WHERE home_id = ?").run(home.id);
      db.prepare(
        "INSERT INTO home_keys (home_id, key_hash, created_at) VALUES (?, settle_sha256(?), ?)",
      ).run(home.id, home.token, now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** The database holds migrations this build doesn't have, so it refuses to open it. */
export class NewerDatabaseError extends Error {
  override name = "NewerDatabaseError";
}

/**
 * How long a write waits for another connection's lock before it fails. node:sqlite waits
 * synchronously, so the whole server (reads, /health, live updates) waits with it: long enough to
 * ride over an ordinary overlap, short enough not to fail a health check.
 */
const BUSY_TIMEOUT_MS = 2000;

function applyAll(db: DatabaseSync, folder: string, pending: Migration[]): void {
  // Does nothing inside a transaction, so it goes before BEGIN.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    try {
      for (const migration of pending) {
        db.exec(readFileSync(join(folder, migration.file), "utf8"));
        // Prepared after the file runs: 0000_init is what creates the table.
        db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(
          migration.id,
          new Date().toISOString(),
        );
      }
      const orphans = db.prepare("PRAGMA foreign_key_check").all();
      if (orphans.length > 0) {
        const tables = [...new Set(orphans.map((row) => `${row.table} → ${row.parent}`))];
        throw new Error(
          `Migrations ${pending.map((migration) => migration.file).join(", ")} left rows ` +
            `pointing at nothing (${tables.join(", ")}), so none of them was applied.`,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function refuseNewer(path: string, migrations: Migration[], applied: Set<number>): void {
  const known = new Set(migrations.map((migration) => migration.id));
  const unknown = [...applied].filter((id) => !known.has(id)).sort((a, b) => a - b);
  if (unknown.length === 0) return;
  const names = unknown.map((id) => String(id).padStart(4, "0"));
  const list =
    names.length === 1
      ? `migration ${names[0]}`
      : `migrations ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  throw new NewerDatabaseError(
    `This database was migrated by a newer Settle: it has ${list}, which this build doesn't ` +
      `know. Run the newer Settle again, or restore a backup from before that upgrade: ` +
      `${basename(path)}.before-${names[0]} in the data folder, if it is still there.`,
  );
}

/** Copies the database to `<path>.before-<NNNN>`, and returns the copy's path. */
function copyAside(db: DatabaseSync, path: string, first: Migration): string {
  const copy = `${path}.before-${String(first.id).padStart(4, "0")}`;
  rmSync(copy, { force: true });
  db.prepare("VACUUM INTO ?").run(copy);
  return copy;
}

/** Removes the `<path>.before-<NNNN>` copies other than `kept`; any other file is the operator's. */
function removeOlderCopies(path: string, kept: string): void {
  const prefix = `${basename(path)}.before-`;
  for (const file of readdirSync(dirname(path))) {
    const ours = file.startsWith(prefix) && /^\d{4}$/.test(file.slice(prefix.length));
    if (ours && file !== basename(kept)) rmSync(join(dirname(path), file));
  }
}

function listMigrations(folder: string): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(folder)) {
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
