-- Slice 4: Decisions, their Basis and Evidence, Requirements, flags, Conflicts, and the record
-- of every state change. Listings, Guides, and Deviations wait for slice 6.
--
-- A Decision is Home-wide when scope_room_id is null. content is JSON validated per kind by core,
-- since a kind says what the platform does with a Decision (a Palette's colors, a Room color's
-- Surface and finish) and so what its content must hold; fulfilment is JSON of what was actually
-- done, set with fulfilled_at. Fulfilled is not a state: a Fulfilled Decision stays Locked.

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
    CHECK (state IN ('candidate', 'leaning', 'locked', 'rejected')),
  created_at TEXT NOT NULL,
  fulfilled_at TEXT,
  fulfilment TEXT,
  archived_at TEXT,
  UNIQUE (home_id, slug)
) STRICT;

-- The Decisions each Decision rests on, as given. The Design Direction in force is in every
-- other Decision's Basis automatically and is never stored here.
CREATE TABLE decision_basis (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL REFERENCES decisions (id),
  basis_decision_id INTEGER NOT NULL REFERENCES decisions (id),
  UNIQUE (decision_id, basis_decision_id),
  CHECK (decision_id <> basis_decision_id)
) STRICT;

-- source_id is the id of a row of notes, sessions, or decisions, by source_kind.
CREATE TABLE decision_evidence (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL REFERENCES decisions (id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('note', 'session', 'decision')),
  source_id INTEGER NOT NULL,
  stance TEXT NOT NULL CHECK (stance IN ('supports', 'undermines')),
  note TEXT,
  UNIQUE (decision_id, source_kind, source_id)
) STRICT;

-- A Purchase Decision's Requirements. reason_id is the id of the row the reason points at, in the
-- table reason_kind names (the Home's own id for 'home'); reason_field names one field of it.
CREATE TABLE requirements (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL REFERENCES decisions (id),
  position INTEGER NOT NULL CHECK (position >= 1),
  text TEXT NOT NULL,
  strength TEXT NOT NULL CHECK (strength IN ('must', 'prefer')),
  reason_kind TEXT NOT NULL CHECK (reason_kind IN ('decision', 'constraint', 'note', 'home',
    'room', 'wall', 'window', 'door', 'feature', 'surface', 'item')),
  reason_id INTEGER NOT NULL,
  reason_field TEXT,
  archived_at TEXT,
  UNIQUE (decision_id, position)
) STRICT;

-- A flag's slug is <decision slug>/flag-<n>. For 'reopened' and 'rejected', the source is the
-- Decision of the flagged one's Basis that changed.
CREATE TABLE flags (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL REFERENCES decisions (id),
  slug TEXT NOT NULL,
  cause TEXT NOT NULL CHECK (cause IN ('reopened', 'rejected', 'deviation', 'value_changed')),
  source_kind TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  raised_at TEXT NOT NULL,
  cleared_at TEXT,
  resolution TEXT CHECK (resolution IN ('keep', 'reopen', 'reject')),
  -- why it was cleared, when the user or the Agent said
  reason TEXT,
  UNIQUE (home_id, slug)
) STRICT;

-- A Conflict's slug is <decision slug>/conflict-<n>.
CREATE TABLE conflicts (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL REFERENCES decisions (id),
  slug TEXT NOT NULL,
  session_id INTEGER REFERENCES sessions (id),
  description TEXT NOT NULL,
  raised_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT CHECK (resolution IN ('keep', 'reopen', 'reject')),
  reason TEXT,
  UNIQUE (home_id, slug)
) STRICT;

-- Every state change. session_id is null and origin 'web' for a change from the web UI, which
-- may carry no reason; an Agent change always has its Session and a reason.
CREATE TABLE state_changes (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL REFERENCES decisions (id),
  from_state TEXT NOT NULL CHECK (from_state IN ('candidate', 'leaning', 'locked', 'rejected')),
  to_state TEXT NOT NULL CHECK (to_state IN ('candidate', 'leaning', 'locked', 'rejected')),
  session_id INTEGER REFERENCES sessions (id),
  origin TEXT NOT NULL,
  reason TEXT,
  at TEXT NOT NULL
) STRICT;

CREATE INDEX decisions_home ON decisions (home_id);
CREATE INDEX decision_basis_decision ON decision_basis (decision_id);
CREATE INDEX decision_basis_basis ON decision_basis (basis_decision_id);
CREATE INDEX decision_evidence_decision ON decision_evidence (decision_id);
CREATE INDEX requirements_decision ON requirements (decision_id);
CREATE INDEX flags_decision ON flags (decision_id);
CREATE INDEX conflicts_decision ON conflicts (decision_id);
CREATE INDEX state_changes_decision ON state_changes (decision_id);
