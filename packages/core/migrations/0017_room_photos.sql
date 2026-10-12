-- Room Photos: a Photo is now of one Room or of one Item, exactly one, as 0015_photos.sql planned.
-- A Room's Photo may name the Wall of that Room it shows; an Item's Photo never names a Wall. That
-- the Wall is the Room's own is the operations' rule, since a CHECK cannot look across tables. The
-- Agent is told a Photo exists, with its Wall, date, and caption, and looks at one only when the
-- user asks, through view_photos.
--
-- SQLite can't make item_id nullable in place, so photos is rebuilt the usual way, as
-- 0013_settled.sql rebuilds state_changes: created anew, copied with every id kept, the old one
-- dropped, the new one renamed. Nothing refers to photos. documents keeps item_id NOT NULL.
CREATE TABLE photos_new (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  item_id INTEGER REFERENCES items (id),
  room_id INTEGER REFERENCES rooms (id),
  wall_id INTEGER REFERENCES walls (id),
  path TEXT NOT NULL,
  thumb_path TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('image/jpeg', 'image/png', 'image/webp')),
  version TEXT NOT NULL,
  taken_on TEXT NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL,
  CHECK ((item_id IS NULL) <> (room_id IS NULL)),
  CHECK (wall_id IS NULL OR room_id IS NOT NULL)
) STRICT;

INSERT INTO photos_new
  (id, home_id, item_id, path, thumb_path, type, version, taken_on, caption, created_at)
SELECT id, home_id, item_id, path, thumb_path, type, version, taken_on, caption, created_at
FROM photos;

DROP TABLE photos;
ALTER TABLE photos_new RENAME TO photos;
CREATE INDEX photos_item ON photos (item_id);
CREATE INDEX photos_room ON photos (room_id);
