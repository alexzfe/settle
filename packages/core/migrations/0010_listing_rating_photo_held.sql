-- The Listing board: a Listing gains the Agent's Rating with its one-line reason, a stored
-- picture kept apart from the link it came from, and Held — kept for reference but not buyable
-- now (docs/handoff/listing-board.md, docs/adr/0005-core-fetches-listing-images.md).
--
-- photo_path has only ever held a remote URL, written straight in by record_listing, so every
-- value moves into photo_url and photo_path is emptied. From here photo_path holds a path under
-- the data dir, photo_type the type sniffed from the bytes there (never inferred from the URL),
-- and photo_version changes whenever those bytes change, so the web can defeat the browser cache.
-- No existing Listing gets a Rating: the Agent judges each one when it next records it.
ALTER TABLE listings ADD COLUMN photo_url TEXT;
ALTER TABLE listings ADD COLUMN photo_type TEXT;
ALTER TABLE listings ADD COLUMN photo_version TEXT;
ALTER TABLE listings ADD COLUMN rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
ALTER TABLE listings ADD COLUMN rating_note TEXT;
ALTER TABLE listings ADD COLUMN held_reason TEXT CHECK (
  held_reason IS NULL
  OR held_reason IN ('out-of-stock', 'discontinued', 'too-expensive-now', 'other')
);
ALTER TABLE listings ADD COLUMN held_note TEXT;
ALTER TABLE listings ADD COLUMN held_at TEXT;

UPDATE listings SET photo_url = photo_path, photo_path = NULL WHERE photo_path IS NOT NULL;
