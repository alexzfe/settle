-- Slice 6 follow-up: why a Deviation was accepted ("only size in stock", "over budget but the
-- last one"), so a compromise reads as a considered one later. Optional; older rows have none.
ALTER TABLE deviations ADD COLUMN reason TEXT;
