-- 0004_merge_nyc.sql
--
-- Merge the Brooklyn campus into the existing Bronx campus, then rename
-- the merged campus to 'new_york_city' to match how Per Scholas operates
-- the metro (one NYC market, not two boroughs).
--
-- Brooklyn was added then marked inactive in earlier work; this finishes
-- the consolidation. Brooklyn's address is used for the merged campus
-- because that's the operational HQ Per Scholas wants to surface to
-- Managing Directors. metro_label stays 'New York' (correct for both AJD
-- and TheirStack location filters; the 100mi radius covers all five
-- boroughs + Newark + Long Island + parts of NJ/CT).
--
-- Strategy:
--   1. Drop Brooklyn's duplicate pair rows (already inactive)
--   2. Defensive: fold any Brooklyn-keyed FK data into Bronx
--   3. Delete Brooklyn campus row
--   4. Rename id 'bronx' → 'new_york_city' across the 4 referencing
--      tables. We drop FKs, do the cascade UPDATE, recreate FKs in the
--      same migration so the schema stays consistent.
--   5. Update the campus row with Brooklyn's address + coords + city
--
-- AUDIT-LOG NOTE: historical audit_log entries with metadata mentioning
-- 'bronx' or 'brooklyn' are NOT migrated (jsonb metadata, not FK). Those
-- entries reflect what was true at the time and are correct as historical
-- record. New audit_log entries will use 'new_york_city'.

BEGIN;

-- 1. Brooklyn's inactive pair rows
DELETE FROM campus_roles WHERE campus_id = 'brooklyn';

-- 2. Defensive sweep
UPDATE job_scores SET campus_id = 'bronx' WHERE campus_id = 'brooklyn';
UPDATE fetch_runs SET campus_id = 'bronx' WHERE campus_id = 'brooklyn';
UPDATE users      SET home_campus_id = 'bronx' WHERE home_campus_id = 'brooklyn';

-- 3. Delete the now-empty Brooklyn campus row
DELETE FROM campuses WHERE id = 'brooklyn';

-- 4. Rename bronx → new_york_city
ALTER TABLE job_scores   DROP CONSTRAINT job_scores_campus_id_fkey;
ALTER TABLE campus_roles DROP CONSTRAINT campus_roles_campus_id_fkey;
ALTER TABLE fetch_runs   DROP CONSTRAINT fetch_runs_campus_id_fkey;
ALTER TABLE users        DROP CONSTRAINT users_home_campus_id_fkey;

UPDATE campuses     SET id = 'new_york_city'             WHERE id = 'bronx';
UPDATE job_scores   SET campus_id = 'new_york_city'      WHERE campus_id = 'bronx';
UPDATE campus_roles SET campus_id = 'new_york_city'      WHERE campus_id = 'bronx';
UPDATE fetch_runs   SET campus_id = 'new_york_city'      WHERE campus_id = 'bronx';
UPDATE users        SET home_campus_id = 'new_york_city' WHERE home_campus_id = 'bronx';

ALTER TABLE job_scores   ADD CONSTRAINT job_scores_campus_id_fkey
  FOREIGN KEY (campus_id) REFERENCES campuses(id);
ALTER TABLE campus_roles ADD CONSTRAINT campus_roles_campus_id_fkey
  FOREIGN KEY (campus_id) REFERENCES campuses(id);
ALTER TABLE fetch_runs   ADD CONSTRAINT fetch_runs_campus_id_fkey
  FOREIGN KEY (campus_id) REFERENCES campuses(id);
ALTER TABLE users        ADD CONSTRAINT users_home_campus_id_fkey
  FOREIGN KEY (home_campus_id) REFERENCES campuses(id) ON DELETE SET NULL;

-- 5. Update the merged campus to use Brooklyn's address + coords
UPDATE campuses
SET
  name = 'Per Scholas New York City',
  city = 'Brooklyn',
  state = 'NY',
  address = '630 Flushing Ave, Brooklyn, NY 11206',
  lat = 40.7008,
  lng = -73.9432,
  metro_label = 'New York',
  default_radius_miles = 100,
  active = TRUE
WHERE id = 'new_york_city';

COMMIT;
