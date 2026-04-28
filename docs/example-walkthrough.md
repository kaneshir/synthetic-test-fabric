# A Full Iteration, End to End

This document walks through one complete iteration of the fabric loop — from an empty run root to a scored report — showing exactly what gets written where, what the data looks like, and what each step produces.

The product in this example is a job marketplace. Seekers browse and apply. Employers post jobs. The framework is wired to a test environment running locally.

---

## Before the loop starts

The orchestrator validates adapters and opens `lisa.db`:

```
$ fab orchestrate --iterations 1 --ticks 5

[fabric] ◉  loop-2026-04-26-001 starting
[fabric]    run root: /tmp/fabric-runs/loop-2026-04-26-001/iter-001
[fabric]    applying lisa.db migrations...
[fabric] ✓  schema version 4 applied
[fabric]    validating environment...
[fabric] ✓  environment healthy
```

The run root directory is created at this point:

```
/tmp/fabric-runs/loop-2026-04-26-001/iter-001/
  .lisa_memory/
    lisa.db    ← empty, migrations applied, ready for writes
```

---

## SEED

The `AppAdapter.seed()` is called with the scenario name selected by the planner (this is the first iteration, so it defaults to `baseline`).

**What happens inside seed:**

1. The simulation engine creates two synthetic users through the product's real registration flow — hitting the actual API, not bypassing it
2. A job record is created and associated with the employer
3. Each entity is written to `lisa.db` with a stable alias

**What gets written:**

`/tmp/fabric-runs/.../iter-001/.lisa_memory/lisa.db` — `seeded_entities` table:

```
alias                    entity_id                             type       credentials
────────────────────────────────────────────────────────────── ──────── ──────────────────────────────────────
account.primary_user   uid_7a2f8c9d                          seeker   maria.chen.test@example.com / pass123
account.secondary_user uid_b3e1f2a4                          employer hire@testco.example.com / pass123
entity.primary_job       job_c8d3e5f2                          job      —
```

`/tmp/fabric-runs/.../iter-001/mini-sim-export.json`:

```json
{
  "simulationId": "sim-2026-04-26-001",
  "seededAt": "2026-04-26T10:14:02.331Z",
  "entities": [
    {
      "alias": "account.primary_user",
      "id": "uid_7a2f8c9d",
      "type": "seeker",
      "credentials": { "email": "maria.chen.test@example.com", "password": "pass123" }
    },
    {
      "alias": "account.secondary_user",
      "id": "uid_b3e1f2a4",
      "type": "employer",
      "credentials": { "email": "hire@testco.example.com", "password": "pass123" }
    },
    {
      "alias": "entity.primary_job",
      "id": "job_c8d3e5f2",
      "type": "job"
    }
  ]
}
```

**Console output:**

```
[fabric] → SEED
[seed]     scenario: baseline
[seed]     seeding 2 seekers, 1 employer...
[seed]   ✓ seeker uid_7a2f8c9d  alias: account.primary_user
[seed]   ✓ employer uid_b3e1f2a4 alias: account.secondary_user
[seed]   ✓ job job_c8d3e5f2     alias: entity.primary_job
[seed]     3 entities written to lisa.db
[fabric] ✓  SEED complete (2.1s)
```

---

## VERIFY

`AppAdapter.verify()` reads `mini-sim-export.json` and re-checks every alias against `lisa.db`. This is a fail-closed gate — if SEED wrote garbage, VERIFY throws before any simulation runs.

```
[fabric] → VERIFY
[verify]   checking 3 aliases in lisa.db...
[verify] ✓ account.primary_user  → uid_7a2f8c9d
[verify] ✓ account.secondary_user → uid_b3e1f2a4
[verify] ✓ entity.primary_job      → job_c8d3e5f2
[fabric] ✓  VERIFY complete (0.1s)
```

If an alias were missing, VERIFY would throw:

```
Error: [verify] alias 'account.primary_user' not found in lisa.db
       Seed may have written partial data. Check AppAdapter.seed().
```

The loop aborts. Nothing downstream runs against bad state.

---

## RUN

`SimulationAdapter.run()` executes 5 ticks. Each tick, the simulation agent (in LLM mode, driven by the persona's goals; in deterministic mode, driven by a behaviour tree) takes an action and records a `behavior_event` row.

The seeker persona — Maria Chen, high financial pressure, 6-week deadline — proceeds directly toward her goal.

**`lisa.db` `behavior_events` table after 5 ticks:**

```
tick  action                          screen_path              outcome    event_kind
────  ──────────────────────────────  ───────────────────────  ─────────  ──────────
1     navigate to /login              /login                   success    action
1     login as primary_user         /login                   success    action
1     arrive at /dashboard            /dashboard               success    flow_end
2     navigate to /jobs               /jobs                    success    action
2     search "electrician near me"    /jobs/search             success    action
3     view job job_c8d3e5f2           /jobs/:id                success    action
3     click apply                     /jobs/:id/apply          success    action
4     fill application form           /applications/new        success    action
4     submit application              /applications/new        success    action
4     arrive at /applications         /applications            success    flow_end
5     navigate to /profile            /profile/seeker          success    action
5     update skills section           /profile/seeker/skills   success    action
```

**Console output:**

```
[fabric] → RUN
[sim]      tick 1/5  — 2 events
[sim]      tick 2/5  — 2 events
[sim]      tick 3/5  — 3 events
[sim]      tick 4/5  — 3 events
[sim]      tick 5/5  — 2 events
[sim]      total: 12 behavior events written
[fabric] ✓  RUN complete (8.3s, simulationId: sim-2026-04-26-001)
```

---

## ANALYZE

`BrowserAdapter.analyze()` (or the framework's built-in analyzer) reads the `behavior_events` from `lisa.db`, reconstructs traversal sequences, and identifies paths not yet in `flows.yaml`.

Maria's session produced three distinct paths:

1. `login → dashboard` (already in flows.yaml — skip)
2. `jobs → search → job/:id → apply → applications` (NEW)
3. `profile → profile/skills` (NEW)

**`/tmp/fabric-runs/.../iter-001/candidate_flows.yaml`:**

```yaml
version: 1
discoveredAt: "2026-04-26T10:14:14.881Z"
simulationId: sim-2026-04-26-001
candidates:
  - id: seeker-search-and-apply
    path:
      - screen: /jobs
        action: navigate
      - screen: /jobs/search
        action: search "electrician"
      - screen: /jobs/:id
        action: view_job
      - screen: /jobs/:id/apply
        action: click_apply
      - screen: /applications/new
        action: fill_and_submit
      - screen: /applications
        action: confirm_submitted
    persona: maria-chen
    novelScore: 0.92
    description: "Seeker searches for a trade job, views a listing, and completes an application"

  - id: seeker-profile-skills-update
    path:
      - screen: /profile/seeker
        action: navigate
      - screen: /profile/seeker/skills
        action: update_skills
    persona: maria-chen
    novelScore: 0.61
    description: "Seeker updates the skills section of their profile"
```

**Console output:**

```
[fabric] → ANALYZE
[analyze]  12 behavior events → 3 traversal paths
[analyze]  1 path already in flows.yaml (skipped)
[analyze]  2 novel paths → candidate_flows.yaml
[fabric] ✓  ANALYZE complete (0.3s)
```

---

## GENERATE_FLOWS

`BrowserAdapter.generateFlows()` takes `candidate_flows.yaml` and produces Playwright specs.

**Without lisa-mcp** (selector-based): The adapter maps path steps to known `data-testid` selectors from a static map maintained alongside the adapter.

**With lisa-mcp** (LLM inference): The adapter spawns the lisa-mcp MCP server, navigates each screen via `lisa_navigate`, calls `lisa_explore_screen` to get live element keys, and builds locators from real DOM state. This produces specs that stay accurate even as the UI changes.

**Generated spec: `flows/seeker-search-and-apply.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { resolveCredentials } from '../helpers/lisa-db';

test('seeker searches and applies to a job', async ({ page }) => {
  const seeker = resolveCredentials('account.primary_user');

  await page.goto('/login');
  await page.locator('[data-key="login_email_input"]').fill(seeker.email);
  await page.locator('[data-key="login_password_input"]').fill(seeker.password);
  await page.locator('[data-key="login_submit_button"]').click();
  await expect(page).toHaveURL('/dashboard');

  await page.goto('/jobs');
  await page.locator('[data-key="job_search_input"]').fill('electrician');
  await page.locator('[data-key="job_search_submit"]').click();
  await expect(page.locator('[data-key="job_result_item"]').first()).toBeVisible();

  await page.locator('[data-key="job_result_item"]').first().click();
  await expect(page).toHaveURL(/\/jobs\/.+/);

  await page.locator('[data-key="apply_button"]').click();
  await expect(page).toHaveURL(/\/jobs\/.+\/apply/);

  await page.locator('[data-key="application_cover_letter"]').fill(
    'I am interested in this electrician role.'
  );
  await page.locator('[data-key="application_submit"]').click();
  await expect(page).toHaveURL('/applications');
  await expect(page.locator('[data-key="application_success_banner"]')).toBeVisible();
});
```

Note: `resolveCredentials('account.primary_user')` reads from `lisa.db` using the `LISA_DB_ROOT` environment variable. The spec never hardcodes an email address.

**Console output:**

```
[fabric] → GENERATE_FLOWS
[generate] processing 2 candidate flows...
[generate] ✓ seeker-search-and-apply → flows/seeker-search-and-apply.spec.ts
[generate] ✓ seeker-profile-skills-update → flows/seeker-profile-skills-update.spec.ts
[fabric] ✓  GENERATE_FLOWS complete (1.4s)
```

---

## TEST

`BrowserAdapter.runSpecs()` invokes Playwright. The framework sets `LISA_DB_ROOT` and `LISA_MEMORY_DIR` in the subprocess environment so specs can resolve aliases.

Two rounds run:
1. **New flows** — the two generated specs, `allowFailures: true` (failures are non-fatal on first run)
2. **Regression suite** — all flows in `flows/`, `allowFailures: false`

**Console output:**

```
[fabric] → TEST
[test]     running 2 new flows (allowFailures: true)...
[test]   ✓  seeker-search-and-apply (3.2s)
[test]   ✓  seeker-profile-skills-update (1.8s)
[test]     running 6 regression flows (allowFailures: false)...
[test]   ✓  seeker-login (0.9s)
[test]   ✓  employer-post-job (2.1s)
[test]   ✓  seeker-view-profile (1.2s)
[test]   ✓  employer-view-applications (1.7s)
[test]   ✗  seeker-view-notifications (1.1s)  ← FAILED
[test]   ✓  seeker-logout (0.5s)
[test]     8 total · 7 passed · 1 failed
[fabric] ✓  TEST complete (12.5s)
```

**`/tmp/fabric-runs/.../iter-001/flow-results.json`:**

```json
{
  "suites": [
    { "title": "seeker-search-and-apply", "status": "passed", "duration": 3200 },
    { "title": "seeker-profile-skills-update", "status": "passed", "duration": 1800 },
    { "title": "seeker-login", "status": "passed", "duration": 900 },
    { "title": "employer-post-job", "status": "passed", "duration": 2100 },
    { "title": "seeker-view-profile", "status": "passed", "duration": 1200 },
    { "title": "employer-view-applications", "status": "passed", "duration": 1700 },
    { "title": "seeker-view-notifications", "status": "failed", "duration": 1100,
      "error": "Timed out waiting for [data-key=\"notification_list_item\"]" },
    { "title": "seeker-logout", "status": "passed", "duration": 500 }
  ]
}
```

---

## SCORE

`ScoringAdapter.score()` reads `flow-results.json`, `lisa.db`, and `mini-sim-export.json`, and produces a `FabricScore`.

**`/tmp/fabric-runs/.../iter-001/fabric-score.json`:**

```json
{
  "simulationId": "sim-2026-04-26-001",
  "generatedAt": "2026-04-26T10:14:31.220Z",
  "overall": 8.1,
  "dimensions": {
    "persona_realism":   9.0,
    "coverage_delta":    8.5,
    "fixture_health":   10.0,
    "discovery_yield":   7.5,
    "regression_health": 7.0,
    "flow_coverage":     8.75
  },
  "details": {
    "flowsPassed": 7,
    "flowsFailed": 1,
    "flowsTotal": 8,
    "newPathsDiscovered": 2,
    "failingFlows": ["seeker-view-notifications"],
    "personaGoalsReached": 9,
    "personaGoalsAttempted": 10
  }
}
```

Why `regression_health` is 7.0: `seeker-view-notifications` was previously passing and is now failing. This is a regression — something changed. It gets weighted more heavily than a new flow failing for the first time.

**Console output:**

```
[fabric] → SCORE
[score]    overall:           8.1
[score]    persona_realism:   9.0   ✓
[score]    coverage_delta:    8.5   ✓  (+2 new paths)
[score]    fixture_health:   10.0   ✓
[score]    discovery_yield:   7.5
[score]    regression_health: 7.0   ⚠  seeker-view-notifications regressed
[score]    flow_coverage:     8.75
[fabric] ✓  SCORE complete (0.2s)
```

---

## FEEDBACK

`FeedbackAdapter.feedback()` reads the score and writes a structured recommendation for the next iteration.

**`/tmp/fabric-runs/.../iter-001/fabric-feedback.json`:**

```json
{
  "schema_version": 1,
  "loop_id": "loop-2026-04-26-001",
  "iteration": 1,
  "simulation_id": "sim-abc123",
  "previous_iteration_root": null,
  "generated_specs": [
    "flows/seeker-browse-jobs.spec.ts",
    "flows/seeker-apply.spec.ts"
  ],
  "score_snapshot": {
    "simulationId": "sim-abc123",
    "generatedAt": "2026-04-26T10:14:31.900Z",
    "overall": 8.1,
    "dimensions": {
      "persona_realism": 8.5,
      "coverage_delta": 9.0,
      "fixture_health": 10.0,
      "discovery_yield": 7.2,
      "regression_health": 6.0,
      "flow_coverage": 8.0
    },
    "details": {}
  },
  "failed_flows": [
    {
      "spec_title": "seeker views notifications",
      "spec_file": "flows/seeker-view-notifications.spec.ts",
      "screen_path": "home > notifications",
      "failure_reason": "Timed out waiting for notification_list_item",
      "suggested_scenario": "baseline"
    }
  ],
  "persona_adjustments": []
}
```

**Console output:**

```
[fabric] → FEEDBACK
[feedback] regression flagged: seeker-view-notifications
[feedback] recommended scenario for next iteration: baseline
[fabric] ✓  FEEDBACK complete (0.1s)

─────────────────────────────────────────
  loop-2026-04-26-001  ·  iter-001 done
  overall score:  8.1  (threshold: 8.0  ✓)
  regression:     seeker-view-notifications  ← investigate
  new flows:      2 added to flows.yaml
  next scenario:  baseline
─────────────────────────────────────────
[fabric] ◉  loop complete  (25.4s total)
```

---

## After the iteration

The run root now contains:

```
/tmp/fabric-runs/loop-2026-04-26-001/iter-001/
  .lisa_memory/
    lisa.db                        ← seeded entities + 12 behavior events
  mini-sim-export.json             ← seeded entity list
  candidate_flows.yaml             ← 2 newly discovered paths
  flow-results.json                ← 8 flows, 7 passed, 1 failed
  fabric-score.json                ← overall 8.1, six dimensions
  fabric-feedback.json             ← regression flagged, scenario recommendation
```

Two new Playwright specs were committed to `flows/`. The next iteration will include them in the regression suite. The loop continues.

---

## What you act on

From this one iteration, you know:

1. `seeker-view-notifications` is broken. Check the git log for changes to the notifications component or API. Run `fab smoke --grep seeker-view-notifications` to reproduce locally.
2. Two new coverage paths were discovered and generated. They passed on first run.
3. The score cleared the 8.0 threshold — CI passes.

This is the full picture from a 25-second run. The system found a real regression, extended coverage, and handed you a specific thing to investigate. No one wrote a regression script to find the notification bug. The system found it because Maria Chen's persona always checks her notifications on her way out.
