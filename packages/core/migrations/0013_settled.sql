-- The committed Decision state Locked is renamed Settled (docs/adr/0007-locked-renamed-settled.md):
-- every stored 'locked' becomes 'settled', in decisions.state, in the from and to of every
-- recorded state change, and in the Change Log's state entries. SQLite can't alter a CHECK, so
-- decisions and state_changes are rebuilt.
--
-- Migrations run with foreign keys on, in one transaction, where PRAGMA foreign_keys does nothing.
-- Nothing refers to state_changes, so it is rebuilt the usual way: created anew, copied, the old
-- one dropped, the new one renamed. Many tables refer to decisions, and renaming the old table out
-- of the way would carry their references with it. So decisions is copied aside, dropped, created
-- again under its own name, and refilled with the same ids. Deferring the foreign keys lets the
-- drop orphan the referring rows until the refill finds each its Decision again; any still
-- orphaned at COMMIT fail the migration.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE state_changes_new (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL REFERENCES decisions (id),
  from_state TEXT NOT NULL CHECK (from_state IN ('candidate', 'leaning', 'settled', 'rejected')),
  to_state TEXT NOT NULL CHECK (to_state IN ('candidate', 'leaning', 'settled', 'rejected')),
  session_id INTEGER REFERENCES sessions (id),
  origin TEXT NOT NULL,
  reason TEXT,
  at TEXT NOT NULL
) STRICT;

INSERT INTO state_changes_new
  (id, home_id, decision_id, from_state, to_state, session_id, origin, reason, at)
SELECT id, home_id, decision_id,
  CASE from_state WHEN 'locked' THEN 'settled' ELSE from_state END,
  CASE to_state WHEN 'locked' THEN 'settled' ELSE to_state END,
  session_id, origin, reason, at
FROM state_changes;

DROP TABLE state_changes;
ALTER TABLE state_changes_new RENAME TO state_changes;
CREATE INDEX state_changes_decision ON state_changes (decision_id);

CREATE TEMP TABLE decisions_copy AS SELECT * FROM decisions;

DROP TABLE decisions;

CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('design-direction', 'room-direction', 'room-use', 'palette',
    'room-color', 'purchase', 'other')),
  scope_room_id INTEGER REFERENCES rooms (id),
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'candidate'
    CHECK (state IN ('candidate', 'leaning', 'settled', 'rejected')),
  created_at TEXT NOT NULL,
  fulfilled_at TEXT,
  fulfilment TEXT,
  archived_at TEXT,
  UNIQUE (home_id, slug)
) STRICT;

INSERT INTO decisions
  (id, home_id, slug, kind, scope_room_id, title, statement, content, state, created_at,
    fulfilled_at, fulfilment, archived_at)
SELECT id, home_id, slug, kind, scope_room_id, title, statement, content,
  CASE state WHEN 'locked' THEN 'settled' ELSE state END,
  created_at, fulfilled_at, fulfilment, archived_at
FROM decisions_copy;

DROP TABLE decisions_copy;
CREATE INDEX decisions_home ON decisions (home_id);

-- The Change Log records each state change too, as JSON. Its prose (Session summaries, reasons)
-- is history and keeps the word it was written with.
UPDATE change_log SET old = '"settled"'
WHERE record_kind = 'decision' AND field = 'state' AND old = '"locked"';
UPDATE change_log SET new = '"settled"'
WHERE record_kind = 'decision' AND field = 'state' AND new = '"locked"';
