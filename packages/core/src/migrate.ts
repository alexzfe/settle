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

  const applied = appliedIds(db);
  const pending = listMigrations().filter((migration) => !applied.has(migration.id));
  if (pending.length === 0) return db;

  db.exec("BEGIN");
  try {
    for (const migration of pending) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, migration.file), "utf8"));
      // Prepared after the file runs: 0000_init is what creates the table.
      db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        new Date().toISOString(),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  return db;
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
