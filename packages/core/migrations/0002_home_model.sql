-- Slice 2: the rest of the Home model. The Home's own facts, the Room's fields, and the tables
-- for Walls, Windows, Doors, Surfaces, Features, Items, Constraints, and Notes.
--
-- A value with Provenance is a column triple: <field>_mm (whole millimetres), <field>_prov
-- ('measured' | 'blueprint' | 'estimated'), and <field>_src (JSON { blueprint, page, printed },
-- present only for Blueprint Provenance). A color is one JSON object
-- { name, brand, code, lrv, hex, provenance } wherever it appears.

ALTER TABLE homes ADD COLUMN tenure TEXT CHECK (tenure IN ('owned', 'rented', 'other'));
ALTER TABLE homes ADD COLUMN planned_stay TEXT
  CHECK (planned_stay IN ('under-1-year', '1-3-years', '3-10-years', 'indefinitely'));
ALTER TABLE homes ADD COLUMN building_type TEXT
  CHECK (building_type IN ('house', 'apartment', 'other'));
ALTER TABLE homes ADD COLUMN building_era TEXT;
ALTER TABLE homes ADD COLUMN lift INTEGER CHECK (lift IN (0, 1));
ALTER TABLE homes ADD COLUMN lift_door_width_mm INTEGER;
ALTER TABLE homes ADD COLUMN lift_door_width_prov TEXT
  CHECK (lift_door_width_prov IN ('measured', 'blueprint', 'estimated'));
ALTER TABLE homes ADD COLUMN lift_door_width_src TEXT;
ALTER TABLE homes ADD COLUMN lift_car_depth_mm INTEGER;
ALTER TABLE homes ADD COLUMN lift_car_depth_prov TEXT
  CHECK (lift_car_depth_prov IN ('measured', 'blueprint', 'estimated'));
ALTER TABLE homes ADD COLUMN lift_car_depth_src TEXT;
ALTER TABLE homes ADD COLUMN access_width_mm INTEGER;
ALTER TABLE homes ADD COLUMN access_width_prov TEXT
  CHECK (access_width_prov IN ('measured', 'blueprint', 'estimated'));
ALTER TABLE homes ADD COLUMN access_width_src TEXT;
ALTER TABLE homes ADD COLUMN access_note TEXT;

-- JSON lists of the fixed-list values; empty when not recorded.
ALTER TABLE rooms ADD COLUMN functions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE rooms ADD COLUMN outdoor INTEGER NOT NULL DEFAULT 0 CHECK (outdoor IN (0, 1));
ALTER TABLE rooms ADD COLUMN ceiling_height_mm INTEGER;
ALTER TABLE rooms ADD COLUMN ceiling_height_prov TEXT
  CHECK (ceiling_height_prov IN ('measured', 'blueprint', 'estimated'));
ALTER TABLE rooms ADD COLUMN ceiling_height_src TEXT;
ALTER TABLE rooms ADD COLUMN times_of_use TEXT NOT NULL DEFAULT '[]';
ALTER TABLE rooms ADD COLUMN windowless INTEGER NOT NULL DEFAULT 0 CHECK (windowless IN (0, 1));
ALTER TABLE rooms ADD COLUMN archived_at TEXT;
ALTER TABLE rooms ADD COLUMN archived_reason TEXT;

-- Why a change was made, when the write said: an override of Provenance, a removal.
ALTER TABLE change_log ADD COLUMN reason TEXT;

-- A Wall's slug is its address, <room slug>/wall-<position>.
CREATE TABLE walls (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  room_id INTEGER NOT NULL REFERENCES rooms (id),
  slug TEXT NOT NULL,
  position INTEGER NOT NULL,
  length_mm INTEGER,
  length_prov TEXT CHECK (length_prov IN ('measured', 'blueprint', 'estimated')),
  length_src TEXT,
  facing TEXT CHECK (facing IN ('n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw')),
  beyond_kind TEXT NOT NULL DEFAULT 'unknown' CHECK (beyond_kind IN ('room', 'outside', 'unknown')),
  beyond_room_id INTEGER REFERENCES rooms (id),
  label TEXT,
  obstruction TEXT CHECK (obstruction IN ('open', 'partly', 'heavily')),
  deciduous INTEGER CHECK (deciduous IN (0, 1)),
  archived_at TEXT,
  UNIQUE (home_id, slug),
  UNIQUE (room_id, position)
) STRICT;

-- wall_id is null for a roof window.
CREATE TABLE windows (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  room_id INTEGER NOT NULL REFERENCES rooms (id),
  slug TEXT NOT NULL,
  wall_id INTEGER REFERENCES walls (id),
  roof_facing TEXT CHECK (roof_facing IN ('n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw')),
  kind TEXT CHECK (kind IN ('standard', 'bay', 'roof')),
  width_mm INTEGER,
  width_prov TEXT CHECK (width_prov IN ('measured', 'blueprint', 'estimated')),
  width_src TEXT,
  height_mm INTEGER,
  height_prov TEXT CHECK (height_prov IN ('measured', 'blueprint', 'estimated')),
  height_src TEXT,
  sill_height_mm INTEGER,
  sill_height_prov TEXT CHECK (sill_height_prov IN ('measured', 'blueprint', 'estimated')),
  sill_height_src TEXT,
  offset_mm INTEGER,
  offset_prov TEXT CHECK (offset_prov IN ('measured', 'blueprint', 'estimated')),
  offset_src TEXT,
  glass TEXT CHECK (glass IN ('clear', 'obscured', 'tinted', 'filmed')),
  archived_at TEXT,
  UNIQUE (home_id, slug)
) STRICT;

-- One Door is shared by the two Rooms it joins. Side A is the Room it was first recorded from;
-- side B is another Room (indoor or outdoor), outside, or unknown. The offset runs along side A's
-- Wall. wall_a_id is null only for an outdoor Room without Walls.
CREATE TABLE doors (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  slug TEXT NOT NULL,
  room_a_id INTEGER NOT NULL REFERENCES rooms (id),
  wall_a_id INTEGER REFERENCES walls (id),
  side_b_kind TEXT NOT NULL CHECK (side_b_kind IN ('room', 'outdoor-room', 'outside', 'unknown')),
  room_b_id INTEGER REFERENCES rooms (id),
  wall_b_id INTEGER REFERENCES walls (id),
  clear_width_mm INTEGER,
  clear_width_prov TEXT CHECK (clear_width_prov IN ('measured', 'blueprint', 'estimated')),
  clear_width_src TEXT,
  height_mm INTEGER,
  height_prov TEXT CHECK (height_prov IN ('measured', 'blueprint', 'estimated')),
  height_src TEXT,
  offset_mm INTEGER,
  offset_prov TEXT CHECK (offset_prov IN ('measured', 'blueprint', 'estimated')),
  offset_src TEXT,
  glazed INTEGER CHECK (glazed IN (0, 1)),
  no_door INTEGER CHECK (no_door IN (0, 1)),
  archived_at TEXT,
  UNIQUE (home_id, slug)
) STRICT;

-- A Room's Surface (its slug <room slug>/<part>), or with wall_id a whole-Wall exception to its
-- walls Surface (<wall slug>/surface). materials is a JSON list of { material, where }.
CREATE TABLE surfaces (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  slug TEXT NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms (id),
  part TEXT NOT NULL CHECK (part IN ('walls', 'ceiling', 'floor', 'woodwork')),
  wall_id INTEGER REFERENCES walls (id),
  materials TEXT,
  color TEXT,
  finish TEXT,
  UNIQUE (home_id, slug)
) STRICT;

-- light is JSON { role, colorTemperature, brightness, dimming, cri }.
CREATE TABLE features (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  room_id INTEGER NOT NULL REFERENCES rooms (id),
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('radiator', 'fireplace', 'built-in-storage', 'fitted-units',
    'beam-or-column', 'light-point', 'tiling-or-panelling', 'other')),
  description TEXT,
  wall_id INTEGER REFERENCES walls (id),
  position_note TEXT,
  width_mm INTEGER,
  width_prov TEXT CHECK (width_prov IN ('measured', 'blueprint', 'estimated')),
  width_src TEXT,
  height_mm INTEGER,
  height_prov TEXT CHECK (height_prov IN ('measured', 'blueprint', 'estimated')),
  height_src TEXT,
  depth_mm INTEGER,
  depth_prov TEXT CHECK (depth_prov IN ('measured', 'blueprint', 'estimated')),
  depth_src TEXT,
  light TEXT,
  archived_at TEXT,
  archived_reason TEXT,
  replaced_by_feature_id INTEGER REFERENCES features (id),
  UNIQUE (home_id, slug)
) STRICT;

-- room_id is null for an Unplaced Item. colors is a JSON list of colors, materials a JSON list
-- of text.
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('seating', 'tables', 'beds', 'storage', 'lighting',
    'rugs', 'textiles', 'art-and-mirrors', 'decor', 'plants', 'appliances', 'electronics',
    'outdoor', 'other')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  room_id INTEGER REFERENCES rooms (id),
  wall_id INTEGER REFERENCES walls (id),
  position_note TEXT,
  width_mm INTEGER,
  width_prov TEXT CHECK (width_prov IN ('measured', 'blueprint', 'estimated')),
  width_src TEXT,
  depth_mm INTEGER,
  depth_prov TEXT CHECK (depth_prov IN ('measured', 'blueprint', 'estimated')),
  depth_src TEXT,
  height_mm INTEGER,
  height_prov TEXT CHECK (height_prov IN ('measured', 'blueprint', 'estimated')),
  height_src TEXT,
  colors TEXT,
  materials TEXT,
  condition TEXT CHECK (condition IN ('good', 'worn', 'damaged')),
  brand TEXT,
  model TEXT,
  price TEXT,
  link TEXT,
  light TEXT,
  archived_at TEXT,
  archived_reason TEXT,
  replaced_by_item_id INTEGER REFERENCES items (id),
  UNIQUE (home_id, slug)
) STRICT;

CREATE TABLE constraints (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  slug TEXT NOT NULL,
  text TEXT NOT NULL,
  archived_at TEXT,
  archived_reason TEXT,
  UNIQUE (home_id, slug)
) STRICT;

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  slug TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (home_id, slug)
) STRICT;

CREATE INDEX walls_room ON walls (room_id);
CREATE INDEX windows_room ON windows (room_id);
CREATE INDEX doors_home ON doors (home_id);
CREATE INDEX surfaces_room ON surfaces (room_id);
CREATE INDEX features_room ON features (room_id);
CREATE INDEX items_home ON items (home_id);
