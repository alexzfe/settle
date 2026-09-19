-- The server stops storing a Home Folder path (docs/handoff/hosting.md, Q5 and Q6; ADR 0006). A
-- hosted server can't see the user's disk, and a Home has one folder on each computer, so the
-- path was a guess; the Home Folder is now set up by a command run inside it.
ALTER TABLE homes DROP COLUMN home_folder_path;
