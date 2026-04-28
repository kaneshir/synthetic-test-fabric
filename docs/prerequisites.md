# Prerequisites: What STF Requires to Actually Work

The framework provides the loop. **You provide the knowledge of your product.**
The value proposition is only as strong as what you put into the eight adapter
implementations. This document is honest about what that requires.

---

## The Core Principle

STF is a loop engine, not a turnkey QA solution. It orchestrates the phases and
enforces the interfaces. Everything that requires knowing your product —
seeding, simulating behaviour, measuring quality, interpreting results — lives in
your adapters. Stubbing those adapters gets you a working loop. It does not get
you test coverage, gap discovery, or any meaningful score.

The demo runs with stub-level adapters and produces an impressive-looking 9.0/10
score against a toy app with planted bugs. Against your real product with real
stakes, that score means nothing until your adapters mean something.

---

## Technical Prerequisites

These are minimum requirements. Missing any of them blocks the loop from running.

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 20 | Required for the orchestrator and all adapters |
| TypeScript | ≥ 5 | All adapter interfaces are typed |
| Playwright | ≥ 1.40 | Required for `BrowserAdapter.runSpecs()` |
| SQLite | — | Via `better-sqlite3`; bundled as a dependency |
| A test environment | — | Isolated from production — see below |

**Test environment isolation is non-negotiable.** STF seeds users, resets state,
and runs destructive operations across iterations. It must never run against
production data or a shared staging environment. You need an environment you
can seed and tear down without affecting anyone else.

---

## Adapter Prerequisites

Each adapter has real product-level requirements that go beyond writing the
TypeScript class.

---

### AppAdapter — the hardest one

```
seed()   — create seeded test entities
reset()  — tear down between iterations
verify() — assert state is what you expect
```

**What you need:**

- **Idempotent seeding.** You must be able to create the same users, accounts,
  and records on every iteration and get consistent results. If your backend
  assigns random IDs or has non-deterministic side effects on account creation,
  seeding is unreliable.

- **Teardown capability.** You must be able to wipe seeded state between
  iterations. In document databases this means deleting nested collections or
  documents. In a relational DB this means truncating or rolling back. In a
  multi-tenant SaaS this means having a designated test tenant you control
  fully.

- **No shared state with real users.** If seeded users share data (queues,
  inboxes, recommendation feeds) with real accounts, the simulation corrupts
  real data and real data corrupts simulation results.

**Cost to implement well:** 1–3 weeks depending on how clean your backend's
test account story is. If your product has no concept of test tenants or
environment isolation, AppAdapter implementation surfaces that gap first.

---

### SimulationAdapter — the value multiplier

```
run()            — simulate agent behaviour across ticks
exportEntities() — extract candidate flows from observed events
```

**What you need:**

- **A behavioural model of your users.** Who are they? What goals do they have?
  What sequences of actions do they take? What edge cases do they probe? Without
  this, your `run()` implementation records events that don't reflect real user
  behaviour, and everything downstream produces meaningless results.

- **`liveLlm: false` is not the goal.** The demo runs deterministically because
  it has no external dependencies. A production simulation should have `liveLlm:
  true` — Claude or Gemini driving agent decisions. Deterministic scripts miss
  the corner cases that LLM agents find because the LLM can reason about state
  and make novel choices.

- **BehaviorEvent quality drives everything.** The candidate flows extracted
  in `exportEntities()` come from the `screen_path`, `action`, and `outcome`
  fields your recorder writes. If every event has `screen_path: null` or
  `action: 'do_thing'`, the candidate flows are garbage and the generated specs
  test nothing useful.

- **The ERROR_422 events are the signal.** Outcomes that indicate unexpected
  app behaviour — silent failures, missing validation, unexpected state — are
  what the framework uses to identify gaps. If your simulation never records
  error outcomes because it only simulates happy paths, discovery_yield will
  always be 0.

**Cost to implement well:** 2–6 weeks for a real behavioural model covering
your primary user journeys. Ongoing cost: updating the model when the product
changes.

---

### BrowserAdapter — the test executor

```
runSpecs(project: 'regression' | 'generated-flows' | 'generate-flows')
```

**What you need:**

- **Stable, semantic UI selectors.** Generated specs target `data-key`
  attributes (or similar stable selectors). If your UI uses auto-generated
  class names, position-based selectors, or regularly restructures the DOM,
  generated specs become brittle immediately. Adding `data-key` or
  `data-testid` attributes to your UI is a prerequisite for generated specs
  that survive more than one sprint.

- **A headless-compatible app.** Playwright must be able to load your app in
  headless Chromium. Server-side rendering, OAuth redirects, native app bridges,
  and certain CDN configurations can block this. Verify your app is
  Playwright-compatible independently before wiring it here.

- **Generated specs write results to a known path.** Your adapter must write
  `flow-results.json` (regression) and `generated-flow-results.json` (generated
  flows) to the `iterRoot`. The orchestrator reads both to advance to SCORE.
  If either file is missing after TEST, the loop halts.

**Cost to implement well:** 1–2 weeks for the runner itself. The ongoing cost
is maintaining `data-key` discipline across your UI — which requires buy-in
from whoever writes frontend code.

---

### ScoringAdapter — the measure of meaning

```
score(iterRoot) → FabricScore
```

**What you need:**

- **A definition of "good."** The six scoring dimensions (regression_health,
  flow_coverage, discovery_yield, persona_realism, fixture_health,
  coverage_delta) each need calibration against your product. What does a 7/10
  `persona_realism` mean for your simulation? What threshold on `regression_health`
  means "do not ship"? Without this, the score is an arbitrary number.

- **Regression results you trust.** `regression_health` and `flow_coverage` are
  only meaningful if the regression test suite covers flows that matter. If you
  seed the suite with trivial tests that always pass, 10/10 is meaningless.

- **The `coverage_delta` feedback loop requires multiple iterations.** The first
  run always produces 0 for coverage_delta. The dimension only has signal after
  iteration 2+, when there is a previous run to compare against. Do not treat
  a single-iteration score as representative.

**Cost to implement well:** 1 week to wire. Ongoing cost: calibrating thresholds
against reality as your product evolves.

---

### FeedbackAdapter — the learning loop

```
feedback(iterRoot, { score, loopId, iteration, previousIterRoot }) → FabricFeedback
```

**What you need:**

- **The loop must close.** The feedback adapter's output is only useful if the
  next iteration's simulation actually reads it and changes its behaviour. If
  your `SimulationAdapter.run()` ignores `persona_adjustments` and runs the
  same script every time, coverage_delta stays flat and the system does not
  improve. Without a working feedback loop, STF is a one-shot test runner with
  extra steps.

- **LLM-driven feedback is the intended path.** The framework supports calling
  Gemini or an ollama-hosted model to analyse the score and generate adjusted
  persona configurations. This is what makes the loop self-improving. The demo
  uses a stub feedback adapter that writes a static JSON file.

**Cost to implement well:** 1–2 weeks for a working Gemini/LLM feedback call.
The hard part is structuring the prompt so that persona adjustments actually
produce better simulation coverage in the next run.

---

## What "Effective" Requires

A working adapter set gets you a loop that executes. An *effective* one produces
results you can act on. The difference:

| Capability | Stub adapters | Effective adapters |
|------------|--------------|-------------------|
| Loop runs without error | ✓ | ✓ |
| Score is non-zero | ✓ | ✓ |
| Score reflects real product quality | ✗ | ✓ |
| Gaps found are real gaps in your product | ✗ | ✓ |
| Generated specs survive a UI change | ✗ | ✓ |
| Iteration 2 is measurably better than iteration 1 | ✗ | ✓ |
| A VP or QA lead can act on the output | ✗ | ✓ |

---

## Realistic Implementation Timeline

These are honest estimates, not marketing numbers.

| Phase | What you build | Effort |
|-------|---------------|--------|
| Stub wiring | 8 adapters that return valid shapes; loop runs end-to-end | 1–2 days |
| Basic real AppAdapter | Seeding + teardown against your actual backend | 1–3 weeks |
| Basic real BrowserAdapter | Playwright runner against your actual app | 3–5 days |
| Behavioural simulation (deterministic) | Scripted agent journeys covering primary flows | 1–2 weeks |
| Behavioural simulation (LLM-driven) | Claude/Gemini agents making real decisions | 2–4 weeks |
| Meaningful scoring | Calibrated dimensions that reflect product quality | 1 week |
| Working feedback loop | Score → persona adjustment → improved next run | 1–2 weeks |
| **Total to first real signal** | | **4–8 weeks** |
| **Total to production quality** | | **2–3 months** |

---

## What STF Cannot Do For You

- **It cannot model behaviour it has not been taught.** If your simulation never
  probes a flow, that flow will never appear in generated specs and will never
  be scored. The system only finds what agents are directed to explore.

- **It cannot substitute for a stable test environment.** If your staging
  environment is flaky, has shared state, or drifts from production, STF
  amplifies that instability — every iteration inherits the same environmental
  noise.

- **It cannot write your adapter implementations.** The framework provides the
  interfaces. Domain knowledge of your product, its data model, its user
  behaviour, and its failure modes lives with your team and must be encoded into
  the adapters manually.

- **It cannot validate that generated specs test the right things.** Generated
  specs prove that UI elements exist and respond. They do not verify business
  logic correctness, data integrity, or security properties. Human review of
  generated specs before they enter the regression suite is strongly recommended.

---

## How to Start

Start narrow. Do not attempt to cover your entire product on the first
integration.

1. Pick one user journey with a clear start and end state (e.g. login →
   complete a task → log out).
2. Implement AppAdapter seed/reset for the entities in that journey only.
3. Write a minimal SimulationAdapter that records 5–10 events covering that
   journey.
4. Wire BrowserAdapter to run one existing Playwright spec file.
5. Run one iteration. Check the score. Check the DB row count.

Once that loop runs cleanly end-to-end with real data, expand one adapter at a
time. The framework will surface gaps in your implementation clearly through
the phase lifecycle — a failing VERIFY means your seed is wrong, a missing
flow-results.json means your browser runner is broken, a flat coverage_delta
means your feedback loop is not closing.

Before writing a line of adapter code, complete the self-assessment in
[testability-standard.md](./testability-standard.md). It tells you whether your
product is ready for this integration and exactly what needs to change if it isn't.

See [quickstart.md](./quickstart.md) for the wiring steps and
[adapter-contract.md](./adapter-contract.md) for the full interface reference.
