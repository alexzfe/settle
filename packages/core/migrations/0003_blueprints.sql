-- Slice 3: Blueprints. The uploaded file is kept in the data dir's uploads/ folder and every page
-- is rendered on upload to a PNG, 2000 px on its long edge, in rendered/. Both paths are relative
-- to the data dir, so the data dir can move.
--
-- A Blueprint value's source stays the JSON { blueprint, page, printed } of its <field>_src
-- column, naming the Blueprint by its slug, which never changes; core checks it names a page of
-- this table. Which Level a page shows is a column of the page (the build plan's page_levels),
-- so the Level is a real reference.

CREATE TABLE blueprints (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  -- the file's name as uploaded
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'png', 'jpeg')),
  file_path TEXT NOT NULL,
  page_count INTEGER NOT NULL CHECK (page_count >= 1),
  uploaded_at TEXT NOT NULL,
  UNIQUE (home_id, slug)
) STRICT;

-- text_lines is the page's text layer, a JSON list of { text, bbox, size, dir } with bbox in the
-- rendered PNG's pixels (top-left origin); empty for a scan or a photo.
CREATE TABLE blueprint_pages (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  blueprint_id INTEGER NOT NULL REFERENCES blueprints (id),
  page INTEGER NOT NULL CHECK (page >= 1),
  level_id INTEGER REFERENCES levels (id),
  png_path TEXT NOT NULL,
  -- the PNG's size in pixels (width and height columns would read as lengths with Provenance)
  width_px INTEGER NOT NULL,
  height_px INTEGER NOT NULL,
  text_lines TEXT NOT NULL DEFAULT '[]',
  UNIQUE (blueprint_id, page)
) STRICT;

CREATE INDEX blueprints_home ON blueprints (home_id);
CREATE INDEX blueprint_pages_blueprint ON blueprint_pages (blueprint_id);
