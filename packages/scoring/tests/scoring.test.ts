import { describe, it, expect } from 'vitest';
import { scoreJob, haversineMiles } from '../src/index';
import type { Taxonomy, JobPayload, CampusContext } from '../src/types';
import cftTaxonomyJson from '../../taxonomy/schemas/cft.json' assert { type: 'json' };

const taxonomy = cftTaxonomyJson as unknown as Taxonomy;

const atlantaCampus: CampusContext = {
  id: 'atlanta',
  name: 'Per Scholas Atlanta',
  lat: 33.7596,
  lng: -84.3880,
  radiusMiles: 100,
};

function makeJob(overrides: Partial<JobPayload>): JobPayload {
  return {
    id: 'test_job',
    title: 'Test Job',
    organization: 'Test Co',
    description_text: '',
    lats_derived: [33.7596],
    lngs_derived: [-84.3880],
    ai_experience_level: '0-2',
    ai_key_skills: [],
    ...overrides,
  };
}

describe('haversineMiles', () => {
  it('returns 0 for same point', () => {
    expect(haversineMiles(33.75, -84.38, 33.75, -84.38)).toBeCloseTo(0, 1);
  });
  it('Atlanta to Macon is ~80mi', () => {
    const d = haversineMiles(33.7596, -84.3880, 32.8407, -83.6324);
    expect(d).toBeGreaterThan(70);
    expect(d).toBeLessThan(90);
  });
});

describe('scoreJob — high-confidence happy paths', () => {
  it('Tier A direct synonym + many core skills + industry + cert + watchlist → HIGH', () => {
    const job = makeJob({
      title: 'Critical Facilities Technician',
      organization: 'QTS Data Centers',
      description_text:
        'Maintain UPS, generator, ATS, chiller, CRAC, BMS systems. Execute SOPs and MOPs. NFPA 70E required. Mission critical 24/7 data center.',
      ai_key_skills: ['UPS', 'Generator', 'CRAC', 'BMS'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('HIGH');
    expect(r.titleTier).toBe('A');
    expect(r.coreMatched.length).toBeGreaterThanOrEqual(5);
    expect(r.employerHit).toBe(true);
  });

  it('Tier A "Data Center Technician" scores HIGH with rich description', () => {
    const job = makeJob({
      title: 'Data Center Technician',
      organization: 'Microsoft',
      description_text:
        'Entry-level DC ops. UPS, ATS, generator, chiller, CRAH, PDU, BMS, EPMS. SOP, MOP, OSHA 10, NFPA 70E. Hyperscale uptime.',
      ai_key_skills: ['UPS', 'ATS', 'Generator', 'CRAH', 'BMS'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('HIGH');
    expect(r.tags).toContain('WATCHLIST_EMPLOYER');
  });
});

describe('scoreJob — Tier B verification', () => {
  it('Tier B "Building Engineer" with strong skills → MEDIUM or HIGH', () => {
    const job = makeJob({
      title: 'Building Engineer',
      organization: 'JLL',
      description_text:
        'Operate chillers, monitor BMS, maintain UPS and generator, execute SOPs. EPA 608 required. NFPA 70E preferred. Mission critical client.',
      ai_key_skills: ['HVAC', 'Chiller', 'BMS', 'UPS', 'Generator'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(['MEDIUM', 'HIGH']).toContain(r.confidence);
    expect(r.titleTier).toBe('B');
  });

  it('Tier B with NO core skills → reduced title score, low confidence', () => {
    const job = makeJob({
      title: 'Maintenance Technician',
      organization: 'Random Co',
      description_text: 'General maintenance work. Pumps and valves.',
      ai_key_skills: ['Maintenance'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.titleScore).toBe(taxonomy.title_tiers.B.score_if_unverified);
  });
});

describe('scoreJob — exclusions', () => {
  it('excludes "Senior" titles', () => {
    const job = makeJob({
      title: 'Senior Critical Facilities Engineer',
      description_text: 'Lead UPS, generator operations.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
    expect(r.rejectionReason).toMatch(/senior/i);
  });

  it('excludes "Bachelor\'s degree required"', () => {
    const job = makeJob({
      title: 'Data Center Technician',
      description_text: 'Bachelor\'s degree required. Mission critical operations.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
  });

  it('excludes "5+ years required"', () => {
    const job = makeJob({
      title: 'Data Center Technician',
      description_text: 'Minimum 5 years required.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
  });

  it('rejects experience level 5-10', () => {
    const job = makeJob({
      title: 'Data Center Technician',
      ai_experience_level: '5-10',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
  });

  it('rejects job outside campus radius', () => {
    const job = makeJob({
      title: 'Data Center Technician',
      lats_derived: [40.7128], // NYC
      lngs_derived: [-74.0060],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
    expect(r.rejectionReason).toMatch(/radius/i);
  });
});

describe('scoreJob — Tier C/D tagging', () => {
  it('Tier C → BAS_TRACK tag', () => {
    const job = makeJob({
      title: 'Building Automation Technician',
      description_text: 'BACnet, Modbus, PID control. NFPA 70E.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.titleTier).toBe('C');
    expect(r.tags).toContain('BAS_TRACK');
  });

  it('Tier D requires healthcare context', () => {
    const job = makeJob({
      title: 'Stationary Engineer',
      description_text: 'Operate boilers and chillers in commercial building.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    // No healthcare context → reject
    expect(r.confidence).toBe('REJECT');
  });

  it('Tier D with healthcare context → tagged HEALTHCARE_TRACK', () => {
    const job = makeJob({
      title: 'Plant Operations Engineer',
      organization: 'Emory Healthcare',
      description_text: 'Hospital UPS, generator, chiller. EPA 608. SOPs.',
      linkedin_org_industry: 'Hospitals and Health Care',
      ai_key_skills: ['UPS', 'Generator', 'Chiller'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.titleTier).toBe('D');
    expect(r.tags).toContain('HEALTHCARE_TRACK');
  });
});

describe('scoreJob — bonus skill gating', () => {
  it('manufacturing-floor maintenance does NOT score on bonus skills alone', () => {
    const job = makeJob({
      title: 'Maintenance Technician',
      description_text:
        'Industrial pumps, valves, pneumatics, hydraulics. P&ID. Paper mill maintenance.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    // Has Tier B title + bonus matches but no core or industry → bonus should be zero
    expect(r.bonusMatched.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §A1 — word-boundary matching for short skill tokens.
// Substring matching produces silent false positives for 3-letter acronyms.
// These tests pin the new whole-word behavior (with optional trailing 's' for plurals).
// ─────────────────────────────────────────────────────────────────────────────
describe('scoreJob — §A1 word-boundary skill matching', () => {
  it('"sop" does NOT match the substring inside "philosopher"', () => {
    const job = makeJob({
      title: 'Critical Facilities Technician',
      description_text: 'The lead philosopher reviews documents.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.coreMatched).not.toContain('SOP');
  });

  it('"sop" DOES match "follow the SOP for shutdown" and the plural "SOPs"', () => {
    const singular = makeJob({
      title: 'Critical Facilities Technician',
      description_text: 'Follow the SOP for shutdown procedures.',
    });
    expect(scoreJob(singular, taxonomy, atlantaCampus).coreMatched).toContain('SOP');

    const plural = makeJob({
      title: 'Critical Facilities Technician',
      description_text: 'Author and execute SOPs for site operations.',
    });
    expect(scoreJob(plural, taxonomy, atlantaCampus).coreMatched).toContain('SOP');
  });

  it('"ats" does NOT match "thermostats" but DOES match "(ATS)"', () => {
    const noMatch = makeJob({
      title: 'Critical Facilities Technician',
      description_text: 'Adjust the thermostats in the office area.',
    });
    expect(scoreJob(noMatch, taxonomy, atlantaCampus).coreMatched).not.toContain('ATS');

    const match = makeJob({
      title: 'Critical Facilities Technician',
      description_text: 'Maintain the automatic transfer switch (ATS) gear.',
    });
    expect(scoreJob(match, taxonomy, atlantaCampus).coreMatched).toContain('ATS');
  });

  it('"bas" does NOT match "basement" but DOES match "BAS controls"', () => {
    const noMatch = makeJob({
      title: 'Critical Facilities Technician',
      description_text: 'Repair pumps in the basement utility area.',
    });
    expect(scoreJob(noMatch, taxonomy, atlantaCampus).coreMatched).not.toContain('BMS/BAS');

    const match = makeJob({
      title: 'Critical Facilities Technician',
      description_text: 'Operate BAS controls and HVAC equipment.',
    });
    expect(scoreJob(match, taxonomy, atlantaCampus).coreMatched).toContain('BMS/BAS');
  });

  it('long-form phrase still matches as substring (UPS via "uninterruptible power supply")', () => {
    const job = makeJob({
      title: 'Critical Facilities Technician',
      // Use only the long-form so we verify substring mode, not the 3-char "ups" form.
      description_text: 'Maintain the uninterruptible power supply equipment.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.coreMatched).toContain('UPS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §A2 — regex experience disqualifier with proximity gate.
// max_years_allowed: 3 (per Imran 2026-04-27). Reject only when captured years
// exceed the threshold AND a 'required'-class word sits within ±50 chars.
// ─────────────────────────────────────────────────────────────────────────────
describe('scoreJob — §A2 regex experience disqualifier', () => {
  it('does NOT reject "5+ years preferred" (no required-class word nearby)', () => {
    const job = makeJob({
      title: 'Critical Facilities Technician',
      description_text: '5+ years preferred. Will train the right candidate.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).not.toBe('REJECT');
  });

  it('does NOT reject "minimum of three years" (3 ≤ max_years_allowed=3)', () => {
    const job = makeJob({
      title: 'Critical Facilities Technician',
      description_text: 'Minimum of three years experience required in facilities work.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).not.toBe('REJECT');
  });

  it('DOES reject "four years required" (spelled-out, exceeds threshold)', () => {
    const job = makeJob({
      title: 'Data Center Technician',
      description_text: 'Four years required for this role. Mission critical environment.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
    expect(r.rejectionReason).toMatch(/years experience/i);
  });

  it('DOES reject "5 to 7 years of experience required"', () => {
    const job = makeJob({
      title: 'Data Center Technician',
      description_text: '5 to 7 years of experience required in critical environments.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
  });

  it('DOES reject "five (5) years\' experience required" (paren-form digit)', () => {
    const job = makeJob({
      title: 'Data Center Technician',
      description_text: "We need five (5) years' experience required in mission critical work.",
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
  });

  it('DOES reject the "5+ years required, or 4 years experience plus a Bachelor\'s" alternative form (v1 simplification)', () => {
    const job = makeJob({
      title: 'Data Center Technician',
      description_text:
        "5+ years required, or 4 years experience plus a Bachelor's. Mission critical environment.",
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
  });

  it('does NOT reject incidental "for four years already" with no nearby required-word', () => {
    const job = makeJob({
      title: 'Critical Facilities Technician',
      description_text:
        // "required" appears, but it is >50 chars from the "four years" capture.
        'We have operated for four years already, building a strong team. Friendly culture, growth opportunities, paid training, and many other perks. Submit your resume — references required only at offer stage.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).not.toBe('REJECT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §A5 — hyperscaler 'engineer' titles. Microsoft/Google/Meta/AWS use
// "Data Center Engineer" instead of "Data Center Technician" for entry-level
// roles. These were previously falling through to "no tier match" → REJECT.
// ─────────────────────────────────────────────────────────────────────────────
describe('scoreJob — §A5 hyperscaler engineer titles', () => {
  it('"Data Center Engineer" at Microsoft with rich description → HIGH, Tier A', () => {
    const job = makeJob({
      title: 'Data Center Engineer',
      organization: 'Microsoft',
      description_text:
        'Mission critical 24/7 data center operations. UPS, ATS, generator, chiller, BMS, EPA 608, OSHA 10, NFPA 70E. Hyperscale uptime.',
      ai_key_skills: ['UPS', 'Generator', 'BMS'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('HIGH');
    expect(r.titleTier).toBe('A');
    expect(r.tags).toContain('WATCHLIST_EMPLOYER');
  });

  it('"Data Center Operations Engineer I" at Google → ≥ MEDIUM, Tier A', () => {
    const job = makeJob({
      title: 'Data Center Operations Engineer I',
      organization: 'Google',
      description_text:
        'Entry-level mission critical data center role. UPS, generator, chiller, BMS, SOPs. NFPA 70E preferred.',
      ai_key_skills: ['UPS', 'Generator', 'Chiller'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(['MEDIUM', 'HIGH']).toContain(r.confidence);
    expect(r.titleTier).toBe('A');
  });

  it('"Data Center Engineer III" at Microsoft → REJECTED via seniority exclusion (runs before tier matching)', () => {
    const job = makeJob({
      title: 'Data Center Engineer III',
      organization: 'Microsoft',
      description_text: 'Senior-level data center role.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
    expect(r.rejectionReason).toMatch(/iii/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §A4 — Tier D healthcare context: include watchlist-employer match in any
// `is_healthcare: true` category as a healthcare signal. Catches roles like
// "Stationary Engineer" at Northside Hospital where the description writer
// said "our facility" instead of "the hospital".
// ─────────────────────────────────────────────────────────────────────────────
describe('scoreJob — §A4 Tier D healthcare-employer gate', () => {
  it('Tier D "Stationary Engineer" at Emory Healthcare with vague description → passes Tier D gate via employer match', () => {
    const job = makeJob({
      title: 'Stationary Engineer',
      organization: 'Emory Healthcare',
      // No "hospital" / "medical center" wording, no linkedin_org_industry.
      description_text: 'Operate boilers, chillers, and UPS at our facility. SOPs and EPA 608.',
      ai_key_skills: ['UPS', 'Chiller'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.titleTier).toBe('D');
    expect(r.confidence).not.toBe('REJECT');
  });

  it('Tier D "Stationary Engineer" at Acme Manufacturing with no healthcare anywhere → still REJECTED', () => {
    const job = makeJob({
      title: 'Stationary Engineer',
      organization: 'Acme Manufacturing',
      description_text: 'Operate boilers and chillers in commercial building.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.confidence).toBe('REJECT');
    expect(r.rejectionReason).toMatch(/healthcare/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §A3 — track tagging decoupled from tier selection. Tags fire via top-level
// rules (taxonomy.tags) regardless of titleTier. Tier C/D `tag` field stays
// as a fallback. The legacy HEALTHCARE_CONTEXT tag is gone.
// ─────────────────────────────────────────────────────────────────────────────
describe('scoreJob — §A3 rule-based tag application', () => {
  it('Tier A "Critical Facilities Technician" with BACnet + Modbus + PLC → BAS_TRACK (rule fires regardless of tier)', () => {
    const job = makeJob({
      title: 'Critical Facilities Technician',
      organization: 'QTS Data Centers',
      description_text:
        'Maintain UPS, generator, BMS systems. BACnet integration, Modbus comms, PLC programming exposure.',
      ai_key_skills: ['UPS', 'BACnet', 'Modbus', 'PLC'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.titleTier).toBe('A');
    expect(r.tags).toContain('BAS_TRACK');
  });

  it('Tier A job at Emory Healthcare → HEALTHCARE_TRACK (NOT the retired HEALTHCARE_CONTEXT)', () => {
    const job = makeJob({
      title: 'Critical Facilities Technician',
      organization: 'Emory Healthcare',
      description_text: 'Maintain UPS, generator, chiller. Mission critical operations.',
      ai_key_skills: ['UPS', 'Generator'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.titleTier).toBe('A');
    expect(r.tags).toContain('HEALTHCARE_TRACK');
    expect(r.tags).not.toContain('HEALTHCARE_CONTEXT');
  });

  it('Tier C "Building Automation Technician" with NO matching skills → still BAS_TRACK via tier fallback', () => {
    const job = makeJob({
      title: 'Building Automation Technician',
      organization: 'Random Co',
      // Deliberately NO BACnet/Modbus/PLC/etc., so the rule does NOT fire.
      description_text: 'General automation work.',
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.titleTier).toBe('C');
    expect(r.tags).toContain('BAS_TRACK');
  });

  it('Tier D job at hospital employer with no "hospital" word in description → HEALTHCARE_TRACK via §A4 employer path', () => {
    const job = makeJob({
      title: 'Stationary Engineer',
      organization: 'Northside Hospital',
      // Vague description: no healthcare phrase, no industry.
      description_text: 'Operate boilers, chillers, and UPS at our facility. SOPs and EPA 608.',
      ai_key_skills: ['UPS', 'Chiller'],
    });
    const r = scoreJob(job, taxonomy, atlantaCampus);
    expect(r.titleTier).toBe('D');
    expect(r.tags).toContain('HEALTHCARE_TRACK');
  });
});
