# Concepts and Glossary

A shared vocabulary for everyone working with Synthetic Test Fabric — whether you're implementing adapters, writing personas, or reading the scored reports.

---

## Loop

The outermost unit of a fabric run. One loop contains one or more iterations. A loop has a stable `loopId` that persists across all its iterations, so iteration N+1 can read findings from iteration N.

```
loop-2026-04-26-001/
  iter-001/   ← first iteration
  iter-002/   ← second iteration (reads feedback from iter-001)
  iter-003/
```

Loops can run once (CI smoke) or continuously (nightly, always-on). The self-improvement signal compounds across iterations within a loop — the longer a loop runs, the more the planner knows about coverage gaps.

---

## Iteration

One complete pass through the eight-phase sequence: SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK.

Every iteration gets exactly one **run root** directory. At the end of an iteration, the framework produces a `FabricScore` and a `FabricFeedback` object. The feedback is read by the next iteration's planner.

---

## Run Root

The filesystem directory that owns all artifacts for one iteration. Every phase reads from and writes to the run root. No phase communicates with another phase directly — artifacts are the only coupling.

```
<run-root>/
  .lisa_memory/lisa.db
  mini-sim-export.json
  candidate_flows.yaml
  flow-results.json
  fabric-score.json
  fabric-feedback.json
```

The run root is ephemeral by default — it can be deleted after the iteration completes. The `importRun` step (if configured) persists what matters to a Postgres database before the directory is recycled.

See [run-root-contract.md](./run-root-contract.md) for the full artifact layout.

---

## Tick

One unit of simulation time. A single tick, one agent takes one action (navigates, clicks, submits, reads). A typical iteration runs 5–20 ticks. More ticks = more behavior events = more observed paths.

Ticks are not wall-clock seconds. They are logical time steps. The `SimulationAdapter` controls how much real time a tick takes — in LLM mode, a tick may take 2–5 seconds; in deterministic mode, milliseconds.

---

## Behavior Event

A single recorded action taken by a simulation agent during the RUN phase. Every event is a row in `lisa.db`'s `behavior_events` table.

Key fields:

| Field | Meaning |
|-------|---------|
| `simulation_id` | Which loop iteration this event belongs to |
| `agent_id` | Which synthetic user took this action |
| `tick` | When in the simulation this happened |
| `action` | What the agent did ("submitted application", "clicked apply") |
| `screen_path` | Which screen the agent was on |
| `event_kind` | `action`, `decision`, `flow_start`, `flow_end`, `verify_check`, `adversarial_probe` |
| `outcome` | `success`, `failure`, `skipped`, `blocked` |
| `persona_definition_id` | Which persona drove this behavior |

The full stream of behavior events for one iteration is the raw material for the ANALYZE phase. Screen paths are extracted from it; coverage is measured against it.

---

## Screen Path

A normalized representation of a URL or navigation destination that strips volatile segments (IDs, tokens, query params) to produce a stable key.

```
/jobs/abc123/apply  →  /jobs/:id/apply
/users/uid_7a2f8c9d →  /users/:id
/search?q=electrician → /search
```

Screen paths are the unit of coverage. The framework tracks which paths have been observed, which have been tested, and which are new. `normalizeScreenPath()` handles the normalization.

---

## Fixture Alias

A stable, human-readable name for a seeded entity. Instead of referring to a test account by its database ID (which changes every run), Playwright specs and simulation agents refer to it by alias.

```
account.primary_user    → uid_7a2f8c9d  (this run)
account.secondary_user  → uid_b3e1f2a4  (this run)
entity.primary_job        → job_c8d3e5f2  (this run)
```

Aliases are registered in `seeded_entities` in `lisa.db` during SEED. They are resolved by any code that sets `LISA_DB_ROOT` in the environment. Generated Playwright specs use `resolveCredentials('account.primary_user')` — never a hardcoded email.

This is what makes the test suite reproducible across runs even though entity IDs change every time.

---

## Persona

A description of a synthetic user — their goals, constraints, and pressure. Personas are defined in YAML and loaded by the `SimulationAdapter`. In LLM mode, the agent uses the persona description to make decisions. In deterministic mode, it maps to a behaviour tree.

Personas are the primary lever for steering coverage. Different pressure profiles (high urgency, low risk tolerance) produce different traversal paths. A well-designed persona library produces coverage that resembles real user behavior.

See [persona-yaml-reference.md](./persona-yaml-reference.md) for the full schema.

---

## Pressure

A set of numeric modifiers (0–1) attached to a persona that shape how the simulation agent behaves:

- **`financial`** — how much financial stress the user is under. High = moves fast, less exploration.
- **`urgency`** — how time-constrained the user is. High = ignores secondary flows, focuses on goal.
- **`risk_tolerance`** — how adventurous the user is. High = tries unusual paths, back-button mid-flow. Low = sticks to the obvious happy path.

Pressure is not a fuzzing knob. It is a behavioral model.

---

## Scenario

A named configuration for a seed run. Scenarios configure `AppAdapter.seed()` to create a specific product state: "employer has posted a job and is reviewing applications", "seeker is mid-application with an incomplete profile", "new user, no prior activity".

The `ScenarioPlanner` selects which scenario to run next based on the `FabricFeedback` from the previous iteration. A product defines its own scenario catalog; the framework calls into it.

---

## FabricScore

The structured output of the SCORE phase. Contains an `overall` (0–10) and six dimensions, each 0–10. Written to `fabric-score.json` in the run root.

| Dimension | Measures |
|-----------|---------|
| `persona_realism` | Did agents reach their stated goals? |
| `coverage_delta` | New screen paths discovered vs previous run |
| `fixture_health` | Seeded entities all resolved correctly |
| `discovery_yield` | New error outcomes found (not known regressions) |
| `regression_health` | Previously passing flows still passing |
| `flow_coverage` | Playwright pass rate across all executed flows |

The score is the single number the loop optimizes toward. Every adapter change that meaningfully affects product quality will move at least one dimension.

---

## FabricFeedback

The structured output of the FEEDBACK phase. Contains the current score, any regressions found, coverage gaps identified, persona pressure adjustment recommendations, and the recommended scenario for the next iteration. Written to `fabric-feedback.json`.

The feedback is the communication channel between one iteration and the next. Without it, every iteration starts blind. With it, the loop steers itself.

---

## Candidate Flow

A novel screen path discovered during ANALYZE that hasn't been turned into a Playwright spec yet. Candidate flows live in `candidate_flows.yaml`. During GENERATE_FLOWS, each candidate flow becomes a `.spec.ts` file in the product's `flows/` directory. On the next iteration, it is part of the regression suite.

---

## Adapter Seam

The boundary between the framework and the product. The framework owns the loop; the product owns the adapter implementations. The eight adapter interfaces are the seam. No product code lives in the framework; no framework code lives in the product.

This boundary is what makes the framework product-neutral. It was the first design invariant established and the one most important to preserve.

---

## lisa.db

A SQLite database created fresh for each iteration in `<run-root>/.lisa_memory/lisa.db`. It is the shared memory between all phases in one iteration. Seeded entities, behavior events, screen paths, and flow results all live here.

The schema is applied by `applyLisaDbMigrations()` at loop start. The `LISA_DB_ROOT` environment variable tells all subprocesses (Playwright workers, simulation scripts) where to find it.

---

## Run Root vs. lisa.db

These are often confused:

| | Run Root | lisa.db |
|---|---|---|
| What it is | Filesystem directory | SQLite database inside the run root |
| What it holds | All iteration artifacts (JSON, YAML, spec files) | Structured event/entity data (rows) |
| Who writes to it | All adapters (files) | BehaviorEventRecorder + MemoryAdapter (rows) |
| How you read it | `fs.readFileSync` | SQLite query via better-sqlite3 |

The run root is the envelope. `lisa.db` is the most important thing inside the envelope.
