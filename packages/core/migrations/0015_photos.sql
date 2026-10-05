-- Photos: dated pictures the user takes of an Item and adds on the web, several to an Item and
-- usually one. The Agent is told a Photo exists, with its date and caption, but never sees it.
-- The browser shrinks each one before upload and sends a thumbnail beside it, so both files are
-- stored as they came, under uploads/<home>/photos/<id>.<ext> and <id>-thumb.<ext>. type is the
-- media type sniffed from the photo's bytes; version changes exactly when they do, for the
-- browser cache. taken_on is when it was taken (YYYY-MM-DD), else the day it was added.
--
-- The table is photos, not item_photos: Room Photos, when they come, make item_id nullable beside
-- a new room_id, with a CHECK that exactly one is set.
CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  item_id INTEGER NOT NULL REFERENCES items (id),
  path TEXT NOT NULL,
  thumb_path TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('image/jpeg', 'image/png', 'image/webp')),
  version TEXT NOT NULL,
  taken_on TEXT NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX photos_item ON photos (item_id);
