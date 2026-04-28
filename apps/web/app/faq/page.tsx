// FAQ — for Managing Directors and other Atlas users who want to understand
// what they're looking at without reading the source.
//
// Five questions, each opinionated and grounded in how the system actually
// works (taxonomy file, scoring engine, cron schedule, fetch pipeline).
// Always-expanded sections so the page is print-friendly and Ctrl-F'able;
// a sticky table of contents at the top for jumping.
//
// Server component — no client interactivity needed. Authenticated like the
// rest of the app (requireUser).

import { requireUser } from '@/lib/auth';
import { AppShell } from '@/components/layout/app-shell';
import { Header, NavLinks } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────────
// Question metadata for the TOC and section anchors.
const QUESTIONS: Array<{ id: string; title: string; eyebrow: string }> = [
  {
    id: 'taxonomy',
    eyebrow: 'Q1',
    title: 'How does a taxonomy work? (CFT example)',
  },
  {
    id: 'grading',
    eyebrow: 'Q2',
    title: 'How are jobs graded — what do the weights and rubrics mean?',
  },
  {
    id: 'schedule',
    eyebrow: 'Q3',
    title: 'How does the schedule work, and what happens after a fetch?',
  },
  {
    id: 'low-volume',
    eyebrow: 'Q4',
    title: 'Why are there relatively few records and limited HIGH-confidence ones?',
  },
  {
    id: 'learning',
    eyebrow: 'Q5',
    title: 'Does the app learn from records over time?',
  },
];

export default async function FAQPage() {
  const user = await requireUser();

  return (
    <AppShell
      header={
        <Header
          subtitle={<span className="text-sm text-gray-500">FAQ · How Atlas works</span>}
          meta="A short, plain-English guide to the taxonomy, scoring, schedule, and limits."
          nav={
            <NavLinks
              email={user.email}
              active="faq"
              showAdminLink={user.role === 'admin'}
            />
          }
        />
      }
      footer={<Footer />}
    >
      {/* Lead */}
      <section>
        <h1 className="text-2xl sm:text-3xl font-bold text-night tracking-tight">
          Frequently asked questions
        </h1>
        <p className="text-sm text-gray-600 mt-2 max-w-3xl leading-relaxed">
          Atlas turns live job postings into a labor-market signal for each Per Scholas
          campus and role. The pieces below explain how that pipeline works — what's encoded
          in a taxonomy, how a job ends up labelled HIGH or REJECT, when the fetcher runs,
          and what the dashboard numbers can and can't tell you.
        </p>
      </section>

      {/* Table of contents */}
      <Card>
        <div className="p-5 sm:p-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
            On this page
          </div>
          <ol className="space-y-2">
            {QUESTIONS.map(q => (
              <li key={q.id} className="flex items-baseline gap-3 text-sm">
                <span className="text-[11px] font-mono text-gray-400 w-6">{q.eyebrow}</span>
                <a
                  href={`#${q.id}`}
                  className="text-royal hover:text-navy underline-offset-2 hover:underline transition-colors duration-150"
                >
                  {q.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </Card>

      {/* Q1 — taxonomy */}
      <FaqSection id="taxonomy" eyebrow="Q1" title="How does a taxonomy work? (CFT example)">
        <p>
          A <em>taxonomy</em> is a JSON file that encodes what a "good fit" looks like for one
          role. Atlas keeps one active taxonomy per role; the active CFT taxonomy is
          versioned (currently <code className="text-night">cft v1.1.3</code>) and stored
          in the <code className="text-night">taxonomies</code> table. Every score the engine
          produces references the exact version it was scored against, so we can replay or
          rescore safely.
        </p>
        <p>
          A taxonomy has six conceptual blocks. Here are the CFT values to make it concrete:
        </p>

        <h4 className="font-semibold text-night mt-5 mb-2">1. Title tiers</h4>
        <p>
          Tiered phrase lists that match against the job title. Each tier carries a different
          score and gating rule.
        </p>
        <ul className="list-disc pl-5 space-y-1 marker:text-gray-300">
          <li>
            <strong>Tier A (40 pts)</strong> — direct synonyms. Phrases like{' '}
            <em>"data center technician"</em>, <em>"critical facilities technician"</em>,{' '}
            <em>"engineering operations technician"</em> (Amazon's preferred title for
            DC techs).
          </li>
          <li>
            <strong>Tier B (25 pts)</strong> — family match (e.g. <em>"maintenance technician"</em>,{' '}
            <em>"facilities engineer"</em>). Two-stage demotion: drops to 0 if the description
            has no industry context (data center / mission critical / 24/7 / etc.), and
            drops to 10 if industry context is present but fewer than 4 core skills are.
          </li>
          <li>
            <strong>Tier C (20 pts)</strong> — Building Automation track. Tagged{' '}
            <code className="text-night text-xs">BAS_TRACK</code>.
          </li>
          <li>
            <strong>Tier D (25 pts)</strong> — Healthcare track (<em>"stationary engineer"</em>,{' '}
            <em>"hospital engineering technician"</em>). Only counts if the description or
            employer has healthcare context. Tagged{' '}
            <code className="text-night text-xs">HEALTHCARE_TRACK</code>.
          </li>
        </ul>

        <h4 className="font-semibold text-night mt-5 mb-2">2. Title exclusions</h4>
        <p>
          Hard-reject substrings on the title. Includes seniority markers (<em>senior, lead,
          principal, manager, director, iii</em>), wrong disciplines (<em>software engineer,
          electrical engineer, network architect</em>), and controls-programming roles.
          These run before tier matching.
        </p>

        <h4 className="font-semibold text-night mt-5 mb-2">3. Description disqualifiers</h4>
        <p>
          Hard-reject phrases on the description, plus a regex-based experience filter that
          rejects when a captured year-count is &gt; <code className="text-night">3</code>{' '}
          AND a "required"-class word appears within 50 characters. Also catches credential
          requirements like "Bachelor's required" or "P.E. license required".
        </p>

        <h4 className="font-semibold text-night mt-5 mb-2">4. Skill blocks</h4>
        <p>Three weighted pools, capped per pool:</p>
        <ul className="list-disc pl-5 space-y-1 marker:text-gray-300">
          <li>
            <strong>Core skills</strong> — curriculum-confirmed (UPS, ATS, PDU, Switchgear,
            HVAC, EPA 608, Chiller, BMS/BAS, NFPA 70E, OSHA 10, LOTO, MOP/EOP/SOP,
            Preventative Maintenance, Multimeter, …). +8 pts each, capped at 40.
          </li>
          <li>
            <strong>Specialized skills</strong> — hands-on lab skills (PLC, Ladder Logic, VFD,
            BACnet, Modbus, P&amp;ID, Hot/Cold Aisle, Containment, …). +4 pts each, capped at 20.
          </li>
          <li>
            <strong>Bonus skills</strong> — supporting topics (CMMS, Pneumatics, Valves, …).
            +1 pt each, capped at 5. Only counts if at least one core skill OR industry
            phrase also matched, to suppress manufacturing-floor false positives.
          </li>
        </ul>

        <h4 className="font-semibold text-night mt-5 mb-2">5. Context, certs, employer watchlist</h4>
        <ul className="list-disc pl-5 space-y-1 marker:text-gray-300">
          <li>
            <strong>Industry context</strong> — phrases like <em>"mission critical"</em>,{' '}
            <em>"data center"</em>, <em>"24/7"</em>, <em>"uptime"</em>. +3 pts each, capped at 10.
          </li>
          <li>
            <strong>Certifications</strong> — OSHA 10, NFPA 70E, EPA 608. +5 pts each,
            capped at 15.
          </li>
          <li>
            <strong>Employer watchlist</strong> — grouped industries (<em>hyperscale_cloud</em>,{' '}
            <em>colocation_wholesale</em>, <em>healthcare</em>, <em>telecom</em>, …). +5 pts
            for any substring match against the job's organization. Industries flagged{' '}
            <code className="text-night text-xs">is_healthcare</code> also satisfy the
            Tier D healthcare gate.
          </li>
        </ul>

        <h4 className="font-semibold text-night mt-5 mb-2">6. Scoring thresholds</h4>
        <p>
          Final cutoffs (tunable from <strong>Admin → Score thresholds</strong> without a
          redeploy): <Badge tone="royal" variant="soft" size="sm">HIGH ≥ 75</Badge>{' '}
          <Badge tone="ocean" variant="soft" size="sm">MEDIUM ≥ 50</Badge>{' '}
          <Badge tone="yellow" variant="soft" size="sm">LOW ≥ 30</Badge>{' '}
          <Badge tone="gray" variant="soft" size="sm">REJECT &lt; 30</Badge>.
        </p>
      </FaqSection>

      {/* Q2 — grading */}
      <FaqSection
        id="grading"
        eyebrow="Q2"
        title="How are jobs graded — what do the weights and rubrics mean?"
      >
        <p>
          For each job posting, the scoring engine runs the active taxonomy against the job's
          title and description and produces a single integer score. The pipeline:
        </p>
        <ol className="list-decimal pl-5 space-y-2 marker:text-gray-400">
          <li>
            <strong>Hard rejects first.</strong> If the title hits any seniority or
            wrong-discipline exclusion, score is 0 and the job is REJECT with a recorded
            reason. Same for credential / experience disqualifiers in the description.
          </li>
          <li>
            <strong>Title tier match.</strong> Tier A wins outright if it matches. Tier B
            applies the two-stage demotion. Tier D requires healthcare context. Tier C tags
            as BAS_TRACK.
          </li>
          <li>
            <strong>Skill matching.</strong> Word-boundary substring match against the job's
            description. Core / specialized / bonus pools each score and cap independently.
          </li>
          <li>
            <strong>Context, certs, and employer match.</strong> Each pool adds points up to
            its cap; there's no double-counting between certs and skill blocks (de-duplicated
            in v1.1.3).
          </li>
          <li>
            <strong>Distance gate.</strong> If the job's resolved location is outside the
            campus's commute radius (default 50mi), it's rejected with{' '}
            <em>"Outside Nmi radius"</em>.
          </li>
          <li>
            <strong>Threshold bucketing.</strong> The total maps to HIGH / MEDIUM / LOW /
            REJECT using the role's active thresholds.
          </li>
        </ol>
        <p>
          The full formula for CFT is shown in the taxonomy file under{' '}
          <code className="text-night">scoring.formula</code>:{' '}
          <code className="text-night text-xs">
            title (0–40) + core (0–40) + specialized (0–20) + bonus (0–5) + industry (0–10) +
            certs (0–15) + employer (0–5) − experience_penalty
          </code>
          . A clean Tier-A data center technician posting with all the right skills and a
          watchlist hit lands well into HIGH territory; a generic Tier-B maintenance role
          with no industry context lands in REJECT thanks to the v1.1.3 collapse.
        </p>
        <p>
          Every score row records what matched: which title phrase, which skills, which
          certs, which employer watchlist category, and the rejection reason if any. Click
          a row in the focused-detail jobs table to see the full breakdown.
        </p>
      </FaqSection>

      {/* Q3 — schedule */}
      <FaqSection
        id="schedule"
        eyebrow="Q3"
        title="How does the schedule work, and what happens after a fetch?"
      >
        <p>
          The Job API fetches run on a GitHub Actions cron schedule:{' '}
          <strong>Mon / Wed / Fri at 9am ET</strong>. The cron calls a single Vercel
          endpoint that runs every active campus × role pair sequentially.
        </p>
        <p>For each (campus, role) pair, a fetch run does this:</p>
        <ol className="list-decimal pl-5 space-y-2 marker:text-gray-400">
          <li>
            <strong>Predictive quota guard.</strong> Estimates how many records the run will
            consume; refuses if doing so would push the monthly Job API quota below the
            15% reserve. Manual fetches enforce the same gate.
          </li>
          <li>
            <strong>Job API call.</strong> Queries the live ATS index for the active campus
            location (city + full state name + radius) over a rolling 7-day window of newly
            posted jobs.
          </li>
          <li>
            <strong>Persist new jobs.</strong> Inserts into the{' '}
            <code className="text-night">jobs</code> table on first sight; updates{' '}
            <code className="text-night">last_seen_at</code> on every re-sighting. Keeps a
            history — postings are immutable except for activity flags.
          </li>
          <li>
            <strong>Score every returned job.</strong> Scores are immutable rows in{' '}
            <code className="text-night">job_scores</code> referencing the exact taxonomy
            version. A rescore creates a new row, not an overwrite.
          </li>
          <li>
            <strong>Reconcile <code className="text-night">still_active</code>.</strong>{' '}
            After the cron has run for ALL pairs, jobs that no campus saw this round are
            marked <code className="text-night">still_active = false</code>. (Manual fetches
            don't trigger reconciliation — only the full cron does, to avoid false
            "expirations" from a partial run.)
          </li>
          <li>
            <strong>Record fetch_run + quota snapshot.</strong> Captures status, duration,
            jobs_returned, jobs_new, scores_computed, and the response's quota headers.
          </li>
          <li>
            <strong>Audit log.</strong> Every fetch is recorded with trigger type
            (scheduled / manual / rescore) and the user (or "system" for cron).
          </li>
        </ol>
        <p>
          You can watch this play out on <strong>Admin → Recent fetch runs</strong>. Manual
          fetches are throttled at one per (campus, role) per 24 hours.
        </p>
      </FaqSection>

      {/* Q4 — low volume */}
      <FaqSection
        id="low-volume"
        eyebrow="Q4"
        title="Why are there relatively few records and limited HIGH-confidence ones?"
      >
        <p>
          Atlas trades volume for precision by design. A few overlapping reasons combine into
          the small steady-state numbers you see:
        </p>
        <ul className="list-disc pl-5 space-y-2 marker:text-gray-300">
          <li>
            <strong>Source window is 7 days.</strong> Each fetch only looks at postings new
            to the source's ATS index in the last week. With cron running 3× a week, the
            30-day rolling pipeline is roughly 13 fetches × ~50 jobs/fetch — not the entire
            internet of jobs.
          </li>
          <li>
            <strong>Geographic narrowing.</strong> Each fetch is scoped to the campus's
            local market (city + state, with a haversine distance filter at the campus's
            commute radius). Roles in cities outside that radius never enter Atlas.
          </li>
          <li>
            <strong>Strict entry-level gate.</strong> Title exclusions reject any "senior",
            "lead", "manager", "principal", or level-III posting before scoring even starts.
            For CFT, these are the bulk of what real-world ATS feeds are advertising — they
            simply aren't in scope for new graduates.
          </li>
          <li>
            <strong>Description disqualifiers.</strong> "5+ years experience required",
            "Bachelor's required", and "P.E. license required" all reject. These eliminate
            another large chunk of nominally-on-title postings.
          </li>
          <li>
            <strong>HIGH cutoff is intentionally strict.</strong>{' '}
            <code className="text-night">≥ 75</code> means the job has multiple alignment
            signals: a proper Tier A title, several core skills, industry context, a cert
            or two. A clean Tier B match with sparse evidence lands in MEDIUM or LOW, not
            HIGH. That's deliberate — you're seeing the tail of the distribution that's
            worth a Managing Director's attention.
          </li>
          <li>
            <strong>Dedup by job, not by sighting.</strong> The pipeline stats and
            leaderboards count unique (job, campus) pairs. A posting seen by three fetches
            counts as one.
          </li>
        </ul>
        <p>
          If a campus shows zero records, the most common cause is "no qualifying jobs in
          the radius this window" — not a bug. The aggregate landing's "Light" or "Sparse"
          market-signal label is exactly that read.
        </p>
      </FaqSection>

      {/* Q5 — learning */}
      <FaqSection
        id="learning"
        eyebrow="Q5"
        title="Does the app learn from records over time?"
      >
        <p>
          <strong>Atlas is not a model — it's a deterministic rules engine driven by an
            editable taxonomy.</strong> The same job scored against the same taxonomy
          version always gets the same number. There's no training loop, no embeddings,
          no gradient updates.
        </p>
        <p>What does evolve over time:</p>
        <ul className="list-disc pl-5 space-y-2 marker:text-gray-300">
          <li>
            <strong>Admins tune the taxonomy.</strong> The{' '}
            <strong>Admin → Score thresholds</strong> editor lets admins adjust HIGH /
            MEDIUM / LOW cutoffs based on what they're seeing. The{' '}
            <strong>Admin → Employer watchlist</strong> editor adds or removes employers
            and creates new industry buckets. Each save creates a new patch version of
            the taxonomy and the next fetch uses it. Older scores stay pinned to the
            version they were scored under.
          </li>
          <li>
            <strong>Curriculum changes propagate.</strong> When a Per Scholas course
            updates its skill list, the taxonomy file is updated to match — adding new
            forms (e.g. singular vs. plural variants), bumping versions, and rescoring
            historical jobs. We've already shipped v1.0 → v1.1.0 → v1.1.1 → v1.1.2 →
            v1.1.3 in this fashion.
          </li>
          <li>
            <strong>Real-world false positives drive precision passes.</strong> When an
            admin spot-checks a flagged job and finds it's not actually a fit (e.g. the
            Cushman maintenance posting that triggered v1.1.3), they document the
            evidence and a precision rule lands in the next taxonomy version.
          </li>
        </ul>
        <p>
          So the right way to think about it: Atlas gets smarter <em>because someone
          edits it</em>, not on its own. The dashboard is the audit surface that makes
          those decisions visible. If you see a job flagged HIGH that shouldn't be — or
          a clear fit that landed REJECT — that's the signal to improve the taxonomy.
        </p>
      </FaqSection>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One Q+A section. Card-shelled, anchor-linked, with a small "Q1" eyebrow.
// scroll-mt offsets the sticky header so anchor jumps land below it.
function FaqSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card>
        <div className="p-5 sm:p-6">
          <div className="flex items-baseline gap-3 flex-wrap mb-3">
            <span className="text-[11px] font-mono text-gray-400">{eyebrow}</span>
            <h2 className="text-lg sm:text-xl font-semibold text-night tracking-tight">
              {title}
            </h2>
          </div>
          <div className="prose-faq text-sm text-gray-700 leading-relaxed space-y-3 max-w-3xl">
            {children}
          </div>
        </div>
      </Card>
    </section>
  );
}
