-- Slice 1: Homes with their Levels and Rooms, Sessions, the change log, and app settings.
-- Only the columns slice 1 needs; later migrations add the rest of the build plan's schema.

CREATE TABLE homes (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  latitude REAL NOT NULL,
  home_folder_path TEXT
) STRICT;

CREATE TABLE levels (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  storey INTEGER NOT NULL,
  UNIQUE (home_id, slug)
) STRICT;

CREATE TABLE rooms (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  level_id INTEGER NOT NULL REFERENCES levels (id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (home_id, slug)
) STRICT;

-- A Session slug is unique across every Home, not only its own, so a slug sent to another
-- Home's endpoint can never name a Session there.
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  slug TEXT NOT NULL UNIQUE,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  -- JSON list of Skill names, in the order they joined
  skills TEXT NOT NULL,
  -- JSON list of the opening's blocks already delivered to this Session
  opening_sent TEXT NOT NULL,
  -- JSON { changed, open, next }, written by close_session
  summary TEXT
) STRICT;

CREATE TABLE change_log (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  at TEXT NOT NULL,
  -- the Session slug, or 'web'
  origin TEXT NOT NULL,
  record_kind TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  record_slug TEXT NOT NULL,
  -- null when the record was created; old and new are JSON
  field TEXT,
  old TEXT,
  new TEXT
) STRICT;

CREATE INDEX change_log_home ON change_log (home_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
