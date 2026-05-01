-- ============================================================================
-- Per Scholas — Initial Seed Data
-- ============================================================================
-- Populates: all known Per Scholas campuses, the CFT role,
-- and activates Atlanta CFT for v1 launch.
-- ============================================================================

-- Per Scholas campuses (publicly known locations as of 2026)
-- Reconciled 2026-04-28 against perscholas.org/locations/ canonical list.
-- 25 active markets representing 31 sites (multi-site markets like NYC, LA,
-- Pittsburgh, Bay Area, Cincinnati collapse to one row each — geofences
-- fully overlap so separate rows would just duplicate fetches).
-- Tampa kept as inactive=FALSE (was in the original BRIEF §3 plan; not in
-- the current canonical list, retained for history per the append-only philosophy).
INSERT INTO campuses (id, name, address, city, state, lat, lng, default_radius_miles, active) VALUES
  ('atlanta',           'Per Scholas Atlanta',                  '233 Peachtree St NE, Suite 650, Atlanta, GA 30303',                'Atlanta',       'GA', 33.7596, -84.3880, 100, TRUE),
  ('baltimore',         'Per Scholas Baltimore',                '509 South Exeter Street, Suite 220, Baltimore, MD 21202',          'Baltimore',     'MD', 39.2843, -76.6021,  50, TRUE),
  ('boston',            'Per Scholas Greater Boston',           '255 Main Street, 8th Floor, Cambridge, MA 02142',                  'Cambridge',     'MA', 42.3623, -71.0843,  50, TRUE),
  -- 'new_york_city' merges the prior Bronx + Brooklyn campuses (see
  -- migration 0004_merge_nyc.sql). Brooklyn address used because that's
  -- the operational HQ Per Scholas surfaces to MDs. Default radius
  -- bumped to 100mi (was 50) to cover the full metro including NJ/CT/LI.
  ('new_york_city',     'Per Scholas New York City',            '630 Flushing Ave, Brooklyn, NY 11206',                             'Brooklyn',      'NY', 40.7008, -73.9432, 100, TRUE),
  ('buffalo',           'Per Scholas Buffalo',                  '726 Exchange St., Suite 610, Buffalo, NY 14210',                   'Buffalo',       'NY', 42.8826, -78.8723,  50, TRUE),
  ('charlotte',         'Per Scholas Charlotte',                '129 West Trade St, Suite 1210, Charlotte, NC 28208',               'Charlotte',     'NC', 35.2272, -80.8430,  50, TRUE),
  ('chicago',           'Per Scholas Chicago',                  '200 W. Monroe, Suite 1401, Chicago, IL 60606',                     'Chicago',       'IL', 41.8807, -87.6326,  50, TRUE),
  ('cincinnati',        'Per Scholas Cincinnati',               '800 William L. Mallory, Sr. Street, Cincinnati, OH 45214',         'Cincinnati',    'OH', 39.1057, -84.5340,  50, TRUE),
  ('columbus',          'Per Scholas Columbus',                 '215 N. Front Street, Columbus, OH 43215',                          'Columbus',      'OH', 39.9656, -83.0011,  50, TRUE),
  ('dallas',            'Per Scholas Dallas',                   '600 North Pearl St., Suite 1950, Dallas, TX 75201',                'Dallas',        'TX', 32.7860, -96.7989,  60, TRUE),
  ('denver',            'Per Scholas Colorado',                 '1777 S Harrison Street, Suite 350, Denver, CO 80210',              'Denver',        'CO', 39.6849, -104.9374, 50, TRUE),
  ('detroit',           'Per Scholas Detroit',                  '3031 W. Grand Blvd., Suite 545, Detroit, MI 48202',                'Detroit',       'MI', 42.3741, -83.0841,  50, TRUE),
  ('houston',           'Per Scholas Houston',                  '4201 Main St, Houston, TX 77002',                                  'Houston',       'TX', 29.7322, -95.3768,  60, TRUE),
  ('indianapolis',      'Per Scholas Indianapolis',             '1635 W. Michigan St., Indianapolis, IN 46222',                     'Indianapolis',  'IN', 39.7770, -86.1844,  50, TRUE),
  ('kansas_city',       'Per Scholas Kansas City',              '300 E 39th St., Kansas City, MO 64111',                            'Kansas City',   'MO', 39.0561, -94.5828,  50, TRUE),
  ('los_angeles',       'Per Scholas Los Angeles',              '1149 S Hill Street, Suite 450, Los Angeles, CA 90015',             'Los Angeles',   'CA', 34.0407, -118.2641, 60, TRUE),
  -- 'national_capital' id retained for FK stability — actual address moved to Silver Spring, MD.
  ('national_capital',  'Per Scholas National Capital Region',  '1400 Spring Street, Suite 501, Silver Spring, MD 20910',           'Silver Spring', 'MD', 38.9907, -77.0289,  50, TRUE),
  ('newark',            'Per Scholas Newark',                   '12 Lombardy Street, 5th Floor, Newark, NJ 07102',                  'Newark',        'NJ', 40.7409, -74.1685,  50, TRUE),
  ('orlando',           'Per Scholas Orlando',                  '201 S. Orange Avenue, Suite 640, Orlando, FL 32801',               'Orlando',       'FL', 28.5393, -81.3789,  50, TRUE),
  ('philadelphia',      'Per Scholas Philadelphia',             '1800 John F Kennedy Blvd, Suite 1801, Philadelphia, PA 19103-7434','Philadelphia',  'PA', 39.9536, -75.1701,  50, TRUE),
  ('phoenix',           'Per Scholas Phoenix',                  '3003 N Central Ave, Suite 1150, Phoenix, AZ 85012',                'Phoenix',       'AZ', 33.4870, -112.0739, 60, TRUE),
  ('pittsburgh',        'Per Scholas Pittsburgh',               '200 First Avenue, Suite 203, Pittsburgh, PA 15222',                'Pittsburgh',    'PA', 40.4393, -79.9967,  50, TRUE),
  ('san_francisco_bay', 'Per Scholas Bay Area',                 '1200 O''Brien Drive, Menlo Park, CA 94025',                        'Menlo Park',    'CA', 37.4842, -122.1428, 50, TRUE),
  ('seattle',           'Per Scholas Seattle',                  '2101 4th Ave, Suite 600, Seattle, WA 98121',                       'Seattle',       'WA', 47.6131, -122.3409, 50, TRUE),
  ('st_louis',          'Per Scholas St. Louis',                '20 S. Sarah Street, St. Louis, MO 63108',                          'St. Louis',     'MO', 38.6398, -90.2531,  50, TRUE),
  -- Tampa: deactivated 2026-04-28 — not in canonical list. Preserved for history.
  ('tampa',             'Per Scholas Tampa',                    '500 N Westshore Blvd, Tampa, FL 33609',                            'Tampa',         'FL', 27.9510, -82.5236,  50, FALSE)
ON CONFLICT (id) DO NOTHING;

-- NOTE: For changes after seed (address corrections, new markets, etc.), edit
-- this file AND apply the same change to the live DB via the admin UI or SQL.
-- Multi-site markets (NYC's five boroughs + Long Island + Staten Island; LA
-- has main + Boyle Heights; Pittsburgh has main + Glassport; Cincinnati has
-- main + Covington KY; Bay Area is Menlo Park) are collapsed to one row per
-- market because per-site geofences fully overlap and would just duplicate
-- fetches. NYC specifically: 'new_york_city' uses the Brooklyn HQ address
-- with a 100mi radius covering all five boroughs + Newark + Long Island +
-- the close NJ/CT suburbs that Per Scholas grads commute into.

-- ============================================================================
-- Roles
-- ============================================================================
INSERT INTO roles (id, name, description, soc_codes, cip_codes, certifications, active) VALUES
  ('cft', 'Critical Facilities Technician',
   'Maintains and protects mission-critical infrastructure for high-availability environments including data centers, telecom, and healthcare. UCI 2137 — 15-week, 412.5-hour program.',
   '["49-2095", "49-9041", "51-8013"]'::jsonb,
   '["15.0503", "47.0101", "47.0201"]'::jsonb,
   '["OSHA-10", "NFPA 70E", "EPA 608"]'::jsonb,
   TRUE)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Campus-Role activations
-- For fresh deploys: only Atlanta×CFT is active (v1 launch). Other markets
-- are seeded as inactive so they appear in the admin UI and can be flipped
-- on individually. Quota math at full activation (25 markets × 80 jobs ×
-- MWF cron) is ~26,000/mo, slightly over the 20k Ultra cap — keep ~15
-- pairs active or drop cron frequency. See docs/runbook.md.
-- ============================================================================
INSERT INTO campus_roles (campus_id, role_id, active, notes) VALUES
  ('atlanta', 'cft', TRUE, 'v1 launch role. Activate other campuses by setting active=TRUE here or via admin UI.'),
  ('baltimore', 'cft', FALSE, 'Add when ready'),
  ('boston', 'cft', FALSE, 'Add when ready'),
  ('new_york_city', 'cft', FALSE, 'Add when ready'),
  ('buffalo', 'cft', FALSE, 'Add when ready'),
  ('charlotte', 'cft', FALSE, 'Add when ready'),
  ('chicago', 'cft', FALSE, 'Add when ready'),
  ('cincinnati', 'cft', FALSE, 'Add when ready'),
  ('columbus', 'cft', FALSE, 'Add when ready'),
  ('dallas', 'cft', FALSE, 'Add when ready'),
  ('denver', 'cft', FALSE, 'Add when ready'),
  ('detroit', 'cft', FALSE, 'Add when ready'),
  ('houston', 'cft', FALSE, 'Add when ready'),
  ('indianapolis', 'cft', FALSE, 'Add when ready'),
  ('kansas_city', 'cft', FALSE, 'Add when ready'),
  ('los_angeles', 'cft', FALSE, 'Add when ready'),
  ('national_capital', 'cft', FALSE, 'Add when ready'),
  ('newark', 'cft', FALSE, 'Add when ready'),
  ('orlando', 'cft', FALSE, 'Add when ready'),
  ('philadelphia', 'cft', FALSE, 'Add when ready'),
  ('phoenix', 'cft', FALSE, 'Add when ready'),
  ('pittsburgh', 'cft', FALSE, 'Add when ready'),
  ('san_francisco_bay', 'cft', FALSE, 'Add when ready'),
  ('seattle', 'cft', FALSE, 'Add when ready'),
  ('st_louis', 'cft', FALSE, 'Add when ready'),
  ('tampa', 'cft', FALSE, 'Tampa not in canonical Per Scholas list as of 2026-04-28; preserved for history.')
ON CONFLICT (campus_id, role_id) DO NOTHING;

-- NOTE: The active CFT taxonomy is loaded from packages/taxonomy/schemas/cft.json
-- by the seed-taxonomy.ts script (run after migrations).
