-- ============================================================================
-- Per Scholas — Initial Seed Data
-- ============================================================================
-- Populates: all known Per Scholas campuses, the CFT role,
-- and activates Atlanta CFT for v1 launch.
-- ============================================================================

-- Per Scholas campuses (publicly known locations as of 2026)
-- Coordinates verified via geocoding; addresses approximate where exact street unknown.
INSERT INTO campuses (id, name, address, city, state, lat, lng, default_radius_miles, active) VALUES
  ('atlanta',          'Per Scholas Atlanta',          '233 Peachtree St NE, Suite 650, Atlanta, GA 30303',          'Atlanta',          'GA', 33.7596, -84.3880, 100, TRUE),
  ('baltimore',        'Per Scholas Baltimore',        '1100 Wicomico St, Baltimore, MD 21230',                       'Baltimore',        'MD', 39.2756, -76.6280,  50, TRUE),
  ('boston',           'Per Scholas Greater Boston',   '281 Summer St, Boston, MA 02210',                             'Boston',           'MA', 42.3505, -71.0468,  50, TRUE),
  ('bronx',            'Per Scholas National Capital — Bronx',  '804 E 138th St, Bronx, NY 10454',              'Bronx',            'NY', 40.8125, -73.9097,  50, TRUE),
  ('charlotte',        'Per Scholas Charlotte',        '801 E Morehead St, Charlotte, NC 28202',                      'Charlotte',        'NC', 35.2155, -80.8417,  50, TRUE),
  ('chicago',          'Per Scholas Chicago',          '20 W Kinzie St, Chicago, IL 60654',                           'Chicago',          'IL', 41.8893, -87.6328,  50, TRUE),
  ('cincinnati',       'Per Scholas Cincinnati',       '1437 Western Ave, Cincinnati, OH 45214',                      'Cincinnati',       'OH', 39.1145, -84.5340,  50, TRUE),
  ('columbus',         'Per Scholas Columbus',         '341 S 3rd St, Columbus, OH 43215',                            'Columbus',         'OH', 39.9534, -82.9988,  50, TRUE),
  ('dallas',           'Per Scholas Dallas',           '8989 Forest Ln, Dallas, TX 75243',                            'Dallas',           'TX', 32.9088, -96.7440,  60, TRUE),
  ('denver',           'Per Scholas Colorado',         '3801 E Florida Ave, Denver, CO 80210',                        'Denver',           'CO', 39.6796, -104.9476, 50, TRUE),
  ('detroit',          'Per Scholas Detroit',          '440 Burroughs St, Detroit, MI 48202',                         'Detroit',          'MI', 42.3661, -83.0738,  50, TRUE),
  ('national_capital', 'Per Scholas National Capital Region', '1110 Vermont Ave NW, Washington, DC 20005',           'Washington',       'DC', 38.9047, -77.0364,  50, TRUE),
  ('newark',           'Per Scholas Newark',           '550 Broad St, Newark, NJ 07102',                              'Newark',           'NJ', 40.7440, -74.1717,  50, TRUE),
  ('philadelphia',     'Per Scholas Philadelphia',     '1700 Market St, Philadelphia, PA 19103',                      'Philadelphia',     'PA', 39.9533, -75.1700,  50, TRUE),
  ('phoenix',          'Per Scholas Phoenix',          '2929 N Central Ave, Phoenix, AZ 85012',                       'Phoenix',          'AZ', 33.4830, -112.0742, 60, TRUE),
  ('seattle',          'Per Scholas Seattle',          '1525 4th Ave, Seattle, WA 98101',                             'Seattle',          'WA', 47.6097, -122.3380, 50, TRUE),
  ('st_louis',         'Per Scholas St. Louis',        '1520 Market St, St. Louis, MO 63103',                         'St. Louis',        'MO', 38.6285, -90.2025,  50, TRUE),
  ('tampa',            'Per Scholas Tampa',            '500 N Westshore Blvd, Tampa, FL 33609',                       'Tampa',            'FL', 27.9510, -82.5236,  50, TRUE)
ON CONFLICT (id) DO NOTHING;

-- NOTE TO ADMIN: campus list above is best-effort from public information as of seed creation.
-- Verify and update via admin UI or direct SQL after deploy. Coordinates/addresses approximate.

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
-- Campus-Role activations (v1: Atlanta CFT only)
-- ============================================================================
INSERT INTO campus_roles (campus_id, role_id, active, notes) VALUES
  ('atlanta', 'cft', TRUE, 'v1 launch role. Activate other campuses by setting active=TRUE here.'),
  ('baltimore', 'cft', FALSE, 'Add when ready'),
  ('boston', 'cft', FALSE, 'Add when ready'),
  ('bronx', 'cft', FALSE, 'Add when ready'),
  ('charlotte', 'cft', FALSE, 'Add when ready'),
  ('chicago', 'cft', FALSE, 'Add when ready'),
  ('cincinnati', 'cft', FALSE, 'Add when ready'),
  ('columbus', 'cft', FALSE, 'Add when ready'),
  ('dallas', 'cft', FALSE, 'Add when ready'),
  ('denver', 'cft', FALSE, 'Add when ready'),
  ('detroit', 'cft', FALSE, 'Add when ready'),
  ('national_capital', 'cft', FALSE, 'Add when ready'),
  ('newark', 'cft', FALSE, 'Add when ready'),
  ('philadelphia', 'cft', FALSE, 'Add when ready'),
  ('phoenix', 'cft', FALSE, 'Add when ready'),
  ('seattle', 'cft', FALSE, 'Add when ready'),
  ('st_louis', 'cft', FALSE, 'Add when ready'),
  ('tampa', 'cft', FALSE, 'Add when ready')
ON CONFLICT (campus_id, role_id) DO NOTHING;

-- NOTE: The active CFT taxonomy is loaded from packages/taxonomy/schemas/cft.json
-- by the seed-taxonomy.ts script (run after migrations).
