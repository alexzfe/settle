-- Documents: files the user keeps with an Item and adds on the web, to prove the purchase (a
-- receipt, a warranty) or to read how to use the thing (a manual). The Agent is told a Document
-- exists, with its kind and name, but never reads it. Each is one file, a PDF as it came or an
-- image the browser shrank, stored under uploads/<home>/documents/<id>.<ext>. type is the media
-- type sniffed from the bytes; version changes exactly when they do, for the browser cache. name
-- is the optional one-line name; created_at is the upload day, kept for the change log only.
--
-- The table is documents, not item_documents: Room Documents, should they come, make item_id
-- nullable beside a new room_id, as for photos.
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes (id),
  item_id INTEGER NOT NULL REFERENCES items (id),
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'warranty', 'manual', 'other')),
  name TEXT,
  path TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  bytes INTEGER NOT NULL,
  version TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX documents_item ON documents (item_id);
