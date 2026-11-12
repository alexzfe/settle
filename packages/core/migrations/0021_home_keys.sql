-- A Home's keys, each stored as its SHA-256 and never as given, as every other token is (0019), so a
-- copy of the database or a backup opens no Home. A Home has one key per Home Folder: setting up a
-- folder makes a new key for it, shown only then, and rotating cancels them all. The key each Home
-- had in homes.token is kept, by its hash, so every Home Folder set up before keeps working.
-- settle_sha256 is the SHA-256 in hex, as tokenHash makes it; migrate.ts gives it to SQLite.
CREATE TABLE home_keys (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX home_keys_home ON home_keys (home_id);

INSERT INTO home_keys (home_id, key_hash, created_at)
SELECT id, settle_sha256(token), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM homes
WHERE token IS NOT NULL;

-- homes.token keeps its key for one release, so a rollback to v2.1.0, which reads only it, leaves
-- every Home Folder working: users never need a new key because of a rollback. This build keeps it
-- in step (the first folder's key while it is empty, emptied when keys are cancelled), and
-- migrate.ts takes in any key v2.1.0 writes there. A later migration empties and drops it, once
-- no rollback past this release is wanted.
