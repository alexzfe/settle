-- A Home's IANA time zone ("America/Santiago"), taken from the browser at create_home, and changed
-- on the About page (set_home_time_zone) or by the Agent through save_home. Core dates what it
-- dates itself (a Photo with no takenOn, a Fulfilment's bought on) and every day it shows in the
-- Home's day, not the server's UTC one. A Home made before has none, and its days stay UTC's until
-- the web sets the browser's zone the next time its owner opens it.
ALTER TABLE homes ADD COLUMN time_zone TEXT;
