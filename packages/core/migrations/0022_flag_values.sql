-- A value_changed flag keeps the value its source field held before the change that raised it and
-- the value it holds now, each as JSON (a length or color with its Provenance, text, a number), so
-- the Agent can say "the ceiling was re-measured from 2.95 m to 2.90 m" when the user weighs the
-- flag. NULL for the other causes, for a flag raised before this migration, and for a value that
-- was empty.
ALTER TABLE flags ADD COLUMN old_value TEXT;
ALTER TABLE flags ADD COLUMN new_value TEXT;
