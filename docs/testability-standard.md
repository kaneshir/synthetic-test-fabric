# Testability Standard

This document is a required self-assessment before integrating STF. Read it before
reading the quickstart. Read it before scoping the work. Read it before committing
engineering time.

The standard is simple: if you can implement all eight adapters cleanly, your product
is testable. If you cannot, fix the product first. STF will not fix it for you — it
will only confirm, loudly, that you aren't there yet.

Use the [self-assessment checklist](#self-assessment-checklist) to find out where you
stand. Use the [readiness rubric](#readiness-rubric) to decide what to do next.

---

## How to read this document

Each of the eight adapters has a pass/fail table. A failing row is not an STF
problem — it is a product quality gap that exists independently of this framework.

**Hard floor adapters** (AppAdapter, SimulationAdapter, BrowserAdapter, ScoringAdapter,
FeedbackAdapter): failing rows here mean the loop produces results you cannot act on.
Fix these before starting.

**Production readiness adapters** (MemoryAdapter, Reporter, ScenarioPlanner): no-op
stubs are acceptable to start narrow. The tables below describe what production-ready
looks like, not what the loop requires to run. A no-op is acceptable *only* if no
other adapter in your integration depends on the no-op behavior — the moment another
adapter calls `resolveEntity()` and expects a real result, the stub is a bug.

> **Hard floor vs production readiness.** Failing a MemoryAdapter, Reporter, or
> ScenarioPlanner row does not block you from starting. Failing any AppAdapter,
> SimulationAdapter, BrowserAdapter, ScoringAdapter, or FeedbackAdapter row means
> your output is not trustworthy. Do not proceed past "start narrow" until those rows
> are green.

---

## AppAdapter

Owns seeding, teardown, and environment health. Everything downstream depends on this
being correct. A flawed AppAdapter produces corrupted behavior events, false scores,
and generated specs that test the wrong state.

| Signal | Passes | Needs work |
|--------|--------|------------|
| Seed speed | < 10s per iteration | > 30s — slow seeding makes iteration timing unreliable and CI timeouts likely |
| Reset scope | Wipes only seeded state, leaves nothing behind | Requires manual DB intervention, or deletes more than it should, or leaves residue that bleeds into the next iteration |
| User isolation | Seeded users share no data with real accounts | Seeded users appear in production feeds, queues, inboxes, or recommendation systems |
| Environment ownership | Dedicated test environment fully under your control — seed, reset, teardown at will | Shared staging with other developers or QA engineers; teardown requires coordination |
| Idempotency | Running seed twice produces the same result | Second seed creates duplicate records, conflicting IDs, or throws |

**What a failure here tells you:** your product has no concept of safe test state.
This is not a testing problem — it is a product architecture problem. Fix environment
isolation before everything else.

---

## SimulationAdapter

Encodes your knowledge of how users behave. The quality of your behavior events
determines the quality of your candidate flows, your generated specs, and your
discovery_yield score. A simulation that only records happy paths will never find
gaps.

| Signal | Passes | Needs work |
|--------|--------|------------|
| Agent diversity | ≥ 3 distinct agent IDs with different personas and goals per run | Single agent, or multiple agents with identical behavior |
| Screen coverage | ≥ 4 distinct screen_path values recorded per run | All events have screen_path: null, or every event lands on the same screen |
| Error probing | Agents explicitly attempt boundary conditions and record ERROR_* outcomes | No error outcomes ever recorded — discovery_yield will always be 0 regardless of real gaps |
| Cross-iteration novelty | Agents produce meaningfully different paths or probe different boundaries across iterations | Identical event sequence every run regardless of score, feedback, or persona adjustments |
| Event quality | action is a meaningful verb phrase; outcome_detail explains what actually happened | action: 'action', outcome_detail: null — events are uninterpretable |
| Behavioral model | Agents reflect how real users of your product behave, including failure modes and frustration paths | Agents only follow the tutorial happy path |

Note: deterministic scripts satisfy this standard. The criterion is breadth and
boundary probing, not LLM usage. `liveLlm: true` unlocks agents that reason about
novel paths; it is not required to pass this standard.

**What a failure here tells you:** you do not have a behavioral model of your users.
This is the most expensive gap to fill and the most valuable. Without it, generated
specs test structure, not behaviour.

---

## BrowserAdapter

Executes specs against the running app. The quality of your selectors determines
whether generated specs survive the next sprint. Brittle selectors mean constant
maintenance and eroding trust in the score.

| Signal | Passes | Needs work |
|--------|--------|------------|
| Selector stability | Every interactive element has a data-key or data-testid attribute that does not change between sprints | Selectors are auto-generated class names, nth-child positions, or text content that changes with copy edits |
| Headless compatibility | App loads fully in Playwright headless Chromium without manual intervention | App requires OAuth popup flow, native bridge handshake, or CDN that blocks headless user agents |
| Regression result file | flow-results.json written to iterRoot on both pass and fail — orchestrator asserts this file exists before advancing to SCORE | flow-results.json missing after TEST phase — orchestrator halts |
| Generated result file | generated-flow-results.json written when generated specs run — ScoringAdapter and FeedbackAdapter must read it to populate discovery_yield and failed_flows | generated-flow-results.json absent — non-fatal to the orchestrator, but discovery_yield silently stays 0 and failed_flows stays empty; the loop continues but does not improve |
| Test environment reachability | Playwright can reach the test environment URL from wherever the loop runs | CI runner has no network path to the test environment |

**What a failure here tells you:** your frontend has no testing contract. Adding
`data-key` or `data-testid` attributes requires buy-in from whoever writes UI code —
this is a team agreement, not a one-time task.

---

## ScoringAdapter

The score is only meaningful if it reflects something real. A score nobody acts on is
noise. A score with uncalibrated weights is misleading.

| Signal | Passes | Needs work |
|--------|--------|------------|
| Threshold agreement | Team has explicitly agreed what score on each dimension means "do not ship" | Score is computed and logged; nobody has discussed what a bad score means |
| Dimension calibration | Weights and formulas reflect your product's actual quality priorities | Default weights copied from demo without review or adjustment |
| coverage_delta accuracy | iterRoot sibling path resolution finds the previous iteration's results | coverage_delta always 0 because previous iterRoot path does not resolve |
| Regression suite integrity | Regression test suite covers flows that matter; a failing regression indicates a real product regression | Regression suite is trivial or empty — regression_health of 10/10 means nothing |

**What a failure here tells you:** your team has no shared definition of quality.
The score is a mirror — it reflects what you put into it.

---

## FeedbackAdapter

The loop only improves if feedback closes. A FeedbackAdapter that does not forward
failure information to the next simulation produces a score that plateaus after the
first iteration.

| Signal | Passes | Needs work |
|--------|--------|------------|
| Loop closure | AppAdapter.seed() receives the prior feedback's personaAdjustmentsPath and writes adjusted fixtures or persona configs for the current iteration; SimulationAdapter drives agents against those adjusted fixtures | seed() and simulation ignore personaAdjustmentsPath — each iteration seeds the same entities and runs the same agent paths regardless of prior score |
| Failed flows forwarded | failed_flows populated from generated-flow-results.json — gaps discovered in iteration N are probed again in iteration N+1 | failed_flows always empty — discovered gaps are never re-tested |
| Score-driven planning | ScenarioPlanner.plan() produces a different scenario when score degrades vs improves | Same scenario name returned regardless of score |

**What a failure here tells you:** you have a one-shot test runner, not an autonomous
loop. Without closed feedback, coverage_delta stays flat and discovery_yield does not
compound across iterations.

---

## Production readiness adapters

> No-op stubs are acceptable for starting narrow. The tables below describe production-
> ready behavior. Treat a no-op as acceptable only if no other adapter in your specific
> integration depends on the behavior being stubbed. The moment another adapter calls
> `resolveEntity()` expecting a real result and receives null, the stub is a bug.

### MemoryAdapter

| Signal | Production ready | Acceptable minimum | Needs work |
|--------|-----------------|-------------------|------------|
| Schema migration | `migrate()` applies all DDL idempotently on every open | No-op — no other adapter in this integration reads or writes via MemoryAdapter | No-op, but another adapter calls `resolveEntity()` and expects a real SeededEntity — receives null instead |
| Alias resolution | `resolveEntity()` returns the correct SeededEntity for all seeded aliases | No-op — alias lookup not used downstream in this integration | Any downstream adapter or spec generator depends on alias lookup and receives null |
| Event persistence | `writeEvent()` persists events to the correct DB path | No-op — no downstream consumer reads MemoryAdapter events in this integration | Events are expected by a reporter or feedback adapter and are silently lost |

### Reporter

| Signal | Production ready | Acceptable minimum |
|--------|-----------------|-------------------|
| Actionability | Output contains score, per-dimension breakdown, failed flow names, and a concrete recommended next action | Prints the overall score — sufficient for local development and early iteration |
| Routing | Report reaches the person who can act on it: Slack message, PagerDuty alert, dashboard write, or CI annotation | Logs to stdout only — acceptable until the loop runs in CI with real stakeholders |
| Regression alerting | Alerts only on score degradation or new regression failures — not on every run | Pings someone on every run regardless of whether anything changed |

### ScenarioPlanner

| Signal | Production ready | Acceptable minimum |
|--------|-----------------|-------------------|
| Feedback consumption | `plan()` reads the prior score and produces a different scenario when regressions are present vs when coverage is improving | Returns a fixed scenario name — acceptable until SimulationAdapter is wired to read persona_adjustments |
| Targeted adjustments | `personaAdjustments` names the specific agents and screen paths where failures occurred | Empty array — acceptable until feedback loop is fully wired |

---

## What failures tell you about your product

A failed row is a product quality signal, not a framework signal. The framework is
working correctly when it surfaces these. Do not work around them in the adapter
implementation — fix the underlying gap.

| Failed signal | Underlying product gap |
|---------------|----------------------|
| Seeding takes > 30s or isn't idempotent | No test data lifecycle ownership — nobody is responsible for test state |
| Can't reset without touching shared state | No environment isolation — test and production share infrastructure |
| Simulation only records happy paths | No behavioral model — the team has not mapped how users actually fail |
| No error outcomes in behavior events | Agents were built to succeed, not to probe — gap discovery is impossible |
| No stable selectors | Frontend has no testing contract — UI is built without test consumers in mind |
| Score nobody acts on | No shared quality definition — "done" is not defined |
| Feedback loop doesn't close | Iterations are independent — the system cannot learn |

---

## Self-assessment checklist

Fill this out before starting the integration. If a box cannot be checked, note what
needs to change and a realistic estimate. Do not start implementation until the minimum
bar rows are all checked.

**Minimum bar (all required before starting)**
- [ ] An isolated test environment exists that I can seed and reset without affecting real users
- [ ] I can create at least one test user deterministically and delete them afterward
- [ ] The app loads in a headless Chromium browser (verify: write a one-line spec that navigates to the URL and run `npx playwright test --browser=chromium smoke.spec.ts`)
- [ ] There is a network path from my CI runner to the test environment

**AppAdapter readiness**
- [ ] Seeding a full entity set takes < 10 seconds
- [ ] Reset removes only what seed created
- [ ] Seeded users cannot appear in production data views

**SimulationAdapter readiness**
- [ ] I can describe at least 3 distinct user journeys with error paths, not just happy paths
- [ ] I know which screens users visit and in what order
- [ ] I can identify at least 2 boundary conditions users hit in practice (empty fields, permission errors, rate limits)

**BrowserAdapter readiness**
- [ ] Interactive elements in the app have stable data-key or data-testid attributes (or I have a plan to add them)
- [ ] The app does not require OAuth popup or native bridge to load the first authenticated screen

**ScoringAdapter readiness**
- [ ] I have discussed with my team what score threshold means "do not ship"

**FeedbackAdapter readiness**
- [ ] I have a plan for how AppAdapter.seed() will consume personaAdjustmentsPath from prior feedback to write different fixtures for the next iteration

---

## Readiness rubric

### Do not start
One or more minimum bar items unchecked. Fix the product first.

- No isolated test environment
- Cannot seed and reset a single user journey deterministically
- App does not load in Playwright headless

**Stop here. Come back when these are resolved.**

---

### Start narrow
Minimum bar met. Hard floor adapter rows are green for at least one user journey.
MemoryAdapter, Reporter, and ScenarioPlanner may be no-op stubs.

- Pick one user journey with a clear start and end state
- Implement AppAdapter seed/reset for that journey only
- Write a SimulationAdapter that records 5–10 events including at least one error probe
- Wire BrowserAdapter to run one existing Playwright spec
- Run one iteration and verify: DB row count matches `behaviorEventsWritten`, score dimensions are non-zero, result files exist

Expand one adapter at a time once the narrow loop runs cleanly.

---

### Ready for production integration
All eight adapters meet their criteria.

- All hard floor pass/fail rows green
- MemoryAdapter lookup semantics match what downstream adapters expect
- Reporter routes output to the people who can act on it
- FeedbackAdapter loop closes — iteration N+1 probes what iteration N found
- Score thresholds are agreed, documented, and enforced in CI

---

## Related docs

- [prerequisites.md](./prerequisites.md) — cost estimates and timeline per adapter
- [adapter-contract.md](./adapter-contract.md) — full interface reference
- [quickstart.md](./quickstart.md) — wiring guide (read after this document)
