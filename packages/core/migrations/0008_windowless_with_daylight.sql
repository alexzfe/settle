-- windowless means a Room has no Windows *and* no glazed Door leading outside or onto an outdoor
-- Room: a glazed Door counts as a light source. Until daylight openings were read, the only way to
-- clear a Room's "Windows or windowless" Gap was to assert windowless, so Rooms whose only glazing
-- is a balcony door were recorded windowless and then read as having no daylight. Clear the flag
-- wherever a daylight opening is recorded; where it is true, it stays.
UPDATE rooms
SET windowless = 0
WHERE windowless = 1
  AND (
    EXISTS (
      SELECT 1 FROM windows w WHERE w.room_id = rooms.id AND w.archived_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM doors d
      WHERE d.room_a_id = rooms.id
        AND d.archived_at IS NULL
        AND d.glazed = 1
        AND d.side_b_kind IN ('outside', 'outdoor-room')
    )
  );
