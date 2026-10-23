import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { create } from "tar";
import { loadConfig } from "./config.js";

// settle backup: the data dir as one .tar.gz, written to stdout, safe while the server runs.
// The database is copied by SQLite's online backup, so the copy is consistent however busy the
// server is; uploads/ and rendered/ are copied as they are, and files are only ever added or
// removed whole. Restore by unpacking it into an empty data dir:
//
//   docker exec <container> node packages/server/dist/backup.js > settle.tgz
//   tar xzf settle.tgz -C <empty data dir>
//
// Messages go to stderr, since stdout is the archive.

const DATABASE = "settle.sqlite";
const FOLDERS = ["uploads", "rendered"];

export async function writeBackup(dataDir: string, out: NodeJS.WritableStream): Promise<void> {
  const database = join(dataDir, DATABASE);
  if (!existsSync(database)) {
    throw new Error(`There is no Settle database at ${database}. Is SETTLE_DATA_DIR right?`);
  }
  const staging = mkdtempSync(join(tmpdir(), "settle-backup-"));
  try {
    const source = new DatabaseSync(database);
    try {
      await backup(source, join(staging, DATABASE));
    } finally {
      source.close();
    }
    // The folders go in through links, followed, so nothing is copied twice.
    const folders = FOLDERS.filter((folder) => existsSync(join(dataDir, folder)));
    for (const folder of folders) symlinkSync(join(dataDir, folder), join(staging, folder));
    await pipeline(
      create({ gzip: true, cwd: staging, follow: true, portable: true }, [DATABASE, ...folders]),
      out,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    if (process.stdout.isTTY) {
      throw new Error(
        "settle backup writes a .tar.gz to stdout: send it to a file, as in " +
          "node packages/server/dist/backup.js > settle-backup.tgz",
      );
    }
    await writeBackup(loadConfig().dataDir, process.stdout);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
