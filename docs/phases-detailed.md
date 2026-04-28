# Phases — Detailed Orchestrator Behavior

What the orchestrator does in each phase, what files exist after it completes,
and what the run root looks like when a phase fails.

The loop order is:

```
validateEnvironment (pre-loop, once)
└── for each iteration:
    SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK → reporters → IMPORT → clean
```

Reporters run **after** FEEDBACK and **before** IMPORT. This means reporters
see the completed `fabric-feedback.json` in `iterRoot` if they need it.

---

## Pre-loop: `validateEnvironment`

**What the orchestrator does:**
Calls `AppAdapter.validateEnvironment()` once before starting any iteration.
If `healthy` is `false`, throws immediately — no iterations run, no
directories are created.

**On failure:** Nothing has been written. Safe to fix the environment and retry.

---

## SEED

**What the orchestrator does:**
1. Creates `<loopRoot>/iter-NNN/` and `<loopRoot>/iter-NNN/.lisa_memory/`
2. Passes previous iteration's `fabric-feedback.json` path as
   `personaAdjustmentsPath` (iteration 2+)
3. Calls `AppAdapter.seed(iterRoot, config)`

**Files present after success:**
- `iter-NNN/` directory exists
- `mini-sim-export.json` — written by `AppAdapter.seed()`
- `lisa.db` — created by `AppAdapter.seed()` via `applyLisaDbMigrations()`

**On failure:** `AppAdapter.seed()` throws → iteration aborts. The `iter-NNN/`
directory exists but `mini-sim-export.json` may be absent or partial. The next
run will attempt SEED again on a new iteration number — do not reuse a partially
seeded `iter-NNN/` directory.

---

## VERIFY

**What the orchestrator does:**
Calls `AppAdapter.verify(iterRoot)`.

**Files present after success:** Same as after SEED — VERIFY is read-only and
writes nothing itself.

**On failure:** `AppAdapter.verify()` throws → iteration aborts. `lisa.db` has
partial seeded entity rows. Safe to inspect for debugging but not reusable.

---

## RUN

**What the orchestrator does:**
1. Reads `simulation_id` from `mini-sim-export.json`
2. Starts `AnalysisWatcher` — a background poller that reads `lisa.db` every
   10 seconds and emits log events when new screen paths are discovered or
   error rates spike. It is informational only and does not affect the run.
3. Calls `SimulationAdapter.run(iterRoot, { ticks, liveLlm, simulationId })`
4. After `run()` returns (or throws), stops the watcher with a 5-second timeout

**`AnalysisWatcher` events logged:**
- `new_path` — a screen path appeared in `behavior_events` that wasn't seen
  in the prior tick window
- `error_spike` — more than a threshold percentage of events in a tick window
  have non-success outcomes

These are logged to console only. The watcher does not write files.

**Files present after success:**
- `behavior_events` rows in `lisa.db` — written by `SimulationAdapter`

**On failure:** `SimulationAdapter.run()` throws → iteration aborts. Watcher
is stopped. `lisa.db` may have partial event rows — safe to inspect.

---

## ANALYZE

**What the orchestrator does:**
1. Reads `mini-sim-export.json` to get the entity list
2. Calls `SimulationAdapter.exportEntities(iterRoot, entities)`

**Files present after success:**
- `candidate_flows.yaml` — written by `SimulationAdapter.exportEntities()` if
  the adapter produces one. If absent, GENERATE_FLOWS is skipped.

**On failure:** Throws → iteration aborts. GENERATE_FLOWS, TEST, SCORE, and
FEEDBACK do not run.

---

## GENERATE_FLOWS

**What the orchestrator does:**
1. Checks whether `candidate_flows.yaml` exists — if not, logs and skips
2. Calls `resolveProvider(flowModel, llmProvider)` to select an LLM provider
   using the 8-step resolution order (see `docs/orchestrator-reference.md`
   and `docs/env-vars.md`). If no provider is resolved, logs and skips (not an error)
3. Calls `BrowserAdapter.runSpecs({ project: 'generate-flows', allowFailures: true, llmProvider })`
   passing the resolved provider through — the adapter owns prompt construction,
   MCP wiring, and spec writing. Failures are caught and logged, never abort the iteration

**Files present after success:**
- Generated Playwright spec files (location is adapter-defined)

**Always non-fatal.** The TEST phase will still run the existing regression
suite even if this phase was skipped or failed.

---

## TEST

**What the orchestrator does:**

**Step 1 — generated-flows (non-fatal):**
Calls `BrowserAdapter.runSpecs({ project: 'generated-flows', allowFailures: true })`.
Failures are caught and logged. This tests the newly generated specs.

**Step 2 — regression:**
Behavior differs based on `allowRegressionFailures`:

`allowRegressionFailures: true` (CLI default):
1. Deletes `flow-results.json` if it exists (prevents stale data from
   satisfying the post-run check)
2. Calls `BrowserAdapter.runSpecs({ project: 'regression', allowFailures: true })`
3. After the call, asserts `flow-results.json` exists and contains ≥1 test
   result — if not, throws (Playwright likely crashed before running)

`allowRegressionFailures: false` (demo default):
1. Calls `BrowserAdapter.runSpecs({ project: 'regression', allowFailures: false })`
2. Any thrown error (from adapter or from test failures) aborts the iteration

**Files present after success:**
- `flow-results.json` — written by `BrowserAdapter.runSpecs()` for the
  regression run. Must be Playwright JSON reporter output.
- `generated-flow-results.json` — written by `BrowserAdapter.runSpecs()` for
  the generated-flows run (optional, location adapter-defined).

**On failure:** If SCORE never runs, `fabric-score.json` is absent.
`flow-results.json` may be absent (Playwright crashed) or present but partial.

---

## SCORE

**What the orchestrator does:**
Calls `ScoringAdapter.score(iterRoot)` and captures the returned `FabricScore`.

**Files present after success:**
- `fabric-score.json` — must be written by `ScoringAdapter.score()`

**On failure:** `ScoringAdapter.score()` throws → iteration aborts. FEEDBACK
and IMPORT do not run. The `FabricScore` is not returned to the caller.

---

## FEEDBACK

**What the orchestrator does:**
Calls `FeedbackAdapter.feedback(iterRoot, { score, loopId, iteration, previousIterRoot })`.

`previousIterRoot` is the `iterRoot` of iteration `N-1`, or `null` for the
first iteration.

**Files present after success:**
- `fabric-feedback.json` — must be written by `FeedbackAdapter.feedback()`.
  Used by the next iteration's SEED as `personaAdjustmentsPath`.

**On failure:** Throws → iteration aborts. IMPORT does not run. The next
iteration will start without persona adjustment data.

---

## Reporters (after FEEDBACK, before IMPORT)

**What the orchestrator does:**
Calls each registered `Reporter.report(score, iterRoot)` in order. Errors from
reporters are caught and logged — they never abort the iteration.

**Files present after success:** Reporter-defined (e.g. HTML report, CI
summary). None required by the framework.

---

## IMPORT

**What the orchestrator does:**
If `dbUrl` is configured, calls `AppAdapter.importRun(iterRoot, dbUrl)`.
If `dbUrl` is omitted, logs a skip message and returns — not an error.

**On failure:** `AppAdapter.importRun()` throws → iteration aborts.

---

## Post-iteration cleanup

**What the orchestrator does:**
1. Calls `SimulationAdapter.clean(iterRoot)` — errors are caught and logged,
   never abort
2. Updates the `current` symlink: `<loopRoot>/current → iter-NNN/`

The `current` symlink is updated **only after all phases complete** (including
IMPORT). A failed iteration does not update `current`.

---

## What "iteration aborts" means

When any phase throws, the iteration stops immediately. The orchestrator does
**not** catch iteration-level errors — `run()` rejects with the error.
Subsequent iterations do not run.

The `iter-NNN/` directory is preserved on failure. Its contents reflect how
far the iteration progressed:

| Files present | Last completed phase |
|---------------|---------------------|
| Nothing (only dir) | Failed before/during SEED |
| `mini-sim-export.json`, `lisa.db` (seeded_entities rows) | SEED |
| Same as SEED | VERIFY (read-only) |
| `lisa.db` (behavior_events rows) | RUN |
| `candidate_flows.yaml` | ANALYZE |
| Generated spec files | GENERATE_FLOWS |
| `flow-results.json` | TEST |
| `fabric-score.json` | SCORE |
| `fabric-feedback.json` | FEEDBACK |

These files are safe to inspect for debugging. Do not attempt to resume from
a partially completed `iter-NNN/` — start a new iteration.
