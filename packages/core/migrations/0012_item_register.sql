-- An Item gains an owner's register (docs/handoff/item-page.md, Q6, Q15): when and where it was
-- bought, what was paid, how long the warranty runs, its serial number, and a manual or support
-- link. The free-text `price` becomes `price_paid`: it was never filled for a real Item, and
-- "price" alone is ambiguous between asking and paid. `listed_fields` names which of bought_from,
-- price_paid, and link were copied from the Listing bought and not edited since, as a JSON array.
--
-- Provenance gains Listed, the maker's or shop's figures (Q13), and only an Item's sizes may be
-- Listed: a Room's ceiling or a Wall's length never is. SQLite can't alter a CHECK, so `items` is
-- rebuilt: created anew, copied, the old one dropped, the new one renamed.
--
-- Migrations run with foreign keys on, in one transaction, where PRAGMA foreign_keys does nothing.
-- items is the only table that refers to items (replaced_by_item_id), so the copy leaves that
-- column empty and it is set again after the rename: dropping the old table then orphans no row,
-- and every reference is checked as it is set.
CREATE TEMP TABLE item_replacements AS
SELECT id, replaced_by_item_id FROM items WHERE replaced_by_item_id IS NOT NULL;

CREATE TABLE items_new (
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
  width_prov TEXT CHECK (width_prov IN ('measured', 'blueprint', 'listed', 'estimated')),
  width_src TEXT,
  depth_mm INTEGER,
  depth_prov TEXT CHECK (depth_prov IN ('measured', 'blueprint', 'listed', 'estimated')),
  depth_src TEXT,
  height_mm INTEGER,
  height_prov TEXT CHECK (height_prov IN ('measured', 'blueprint', 'listed', 'estimated')),
  height_src TEXT,
  colors TEXT,
  materials TEXT,
  condition TEXT CHECK (condition IN ('good', 'worn', 'damaged')),
  brand TEXT,
  model TEXT,
  price_paid TEXT,
  link TEXT,
  light TEXT,
  archived_at TEXT,
  archived_reason TEXT,
  replaced_by_item_id INTEGER REFERENCES items (id),
  bought_on TEXT,
  bought_from TEXT,
  warranty_until TEXT,
  serial_number TEXT,
  manual_link TEXT,
  listed_fields TEXT,
  UNIQUE (home_id, slug)
) STRICT;

INSERT INTO items_new (
  id, home_id, slug, name, category, quantity, room_id, wall_id, position_note,
  width_mm, width_prov, width_src, depth_mm, depth_prov, depth_src,
  height_mm, height_prov, height_src, colors, materials, condition, brand, model,
  price_paid, link, light, archived_at, archived_reason
)
SELECT
  id, home_id, slug, name, category, quantity, room_id, wall_id, position_note,
  width_mm, width_prov, width_src, depth_mm, depth_prov, depth_src,
  height_mm, height_prov, height_src, colors, materials, condition, brand, model,
  price, link, light, archived_at, archived_reason
FROM items;

DROP TABLE items;
ALTER TABLE items_new RENAME TO items;
CREATE INDEX items_home ON items (home_id);

UPDATE items
SET replaced_by_item_id = (
  SELECT replaced_by_item_id FROM temp.item_replacements WHERE item_replacements.id = items.id
)
WHERE id IN (SELECT id FROM temp.item_replacements);

DROP TABLE temp.item_replacements;
