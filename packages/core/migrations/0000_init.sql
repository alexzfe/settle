-- Records every applied migration. migrate() applies all pending files in one transaction,
-- so a migration file holds no BEGIN or COMMIT of its own.
CREATE TABLE migrations (
  id INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;
