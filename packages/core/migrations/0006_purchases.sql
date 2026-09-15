-- Slice 6: Purchases. The Guides of a Purchase, its Listings with a check per Requirement, the
-- Deviations recorded when it is Fulfilled, and the field a value_changed flag's source changed.
--
-- A Requirement's id is its identity: its position never changes and is never reused, even once
-- it is Archived, so a Listing check and a Deviation point at it by requirement_id.

-- One row per Purchase with Guides. quick_lines is a JSON list of the AI's own Quick Guide lines;
-- the Quick Guide itself is assembled from the Requirements and never stored whole.
-- written_at is when the Full Guide was last written; requirements_changed_at is when a
-- Requirement was first added, changed, or Archived after that, so the Full Guide is out of date
-- while it is set. lan_token names the Quick Guide on the LAN listener, which serves only
-- /guide/<lan_token>; it is random and never changes.
CREATE TABLE guides (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL UNIQUE REFERENCES decisions (id),
  -- <decision slug>/guides
  slug TEXT NOT NULL,
  quick_lines TEXT NOT NULL DEFAULT '[]',
  full_markdown TEXT,
  written_at TEXT,
  requirements_changed_at TEXT,
  lan_token TEXT NOT NULL UNIQUE,
  UNIQUE (home_id, slug)
) STRICT;

-- dimensions is JSON { width, depth, height } in millimetres, as the listing states them.
CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL REFERENCES decisions (id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  price TEXT,
  dimensions TEXT,
  photo_path TEXT,
  recorded_at TEXT NOT NULL,
  UNIQUE (home_id, slug)
) STRICT;

CREATE TABLE listing_checks (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  listing_id INTEGER NOT NULL REFERENCES listings (id),
  requirement_id INTEGER NOT NULL REFERENCES requirements (id),
  result TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'unknown')),
  note TEXT,
  UNIQUE (listing_id, requirement_id)
) STRICT;

-- A Deviation's slug is <decision slug>/deviation-<n>.
CREATE TABLE deviations (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  decision_id INTEGER NOT NULL REFERENCES decisions (id),
  slug TEXT NOT NULL,
  requirement_id INTEGER NOT NULL REFERENCES requirements (id),
  text TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (home_id, slug)
) STRICT;

-- For a value_changed flag: source_kind is the Requirement reason kind of the changed record
-- (wall, door, home…), source_id its id, and source_field the field that changed.
ALTER TABLE flags ADD COLUMN source_field TEXT;

CREATE INDEX listings_decision ON listings (decision_id);
CREATE INDEX listing_checks_listing ON listing_checks (listing_id);
CREATE INDEX deviations_decision ON deviations (decision_id);
