-- Slice 5b: the automatic Basis entries are stored, no longer computed.
--
-- decision_basis holds the Decisions each Decision rests on, given or automatic, one row per pair.
-- automatic is 1 for the Design Direction in force when the Decision was created (in every Basis
-- but a Design Direction's), and for the Palette in force when the Decision started using its
-- colors (a Room color, or a Purchase with a Requirement whose reason is that Palette); 0 for the
-- Decisions given. An automatic entry changes only when the user keeps or Reopens the Decision
-- after a flag from that entry (it then rests on the one in force, if any), or when a Room
-- color's changed color is checked against another Palette; a Decision without one gets it on its
-- next save or state change. This replaces the comment on decision_basis in 0004. No backfill:
-- automatic entries were never stored before.

ALTER TABLE decision_basis ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0
  CHECK (automatic IN (0, 1));
