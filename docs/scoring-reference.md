# Scoring Reference

`FabricScore` is the single number — and the six-dimension breakdown behind it — that the loop optimizes toward. This document explains how each dimension is computed, what drives it up and down, and what to do when it drops.

---

## Score structure

```typescript
interface FabricScore {
  simulationId: string;
  generatedAt: string;
  overall: number;        // 0–10, weighted average of dimensions
  dimensions: {
    persona_realism:   number;  // 0–10
    coverage_delta:    number;  // 0–10
    fixture_health:    number;  // 0–10
    discovery_yield:   number;  // 0–10
    regression_health: number;  // 0–10
    flow_coverage:     number;  // 0–10
  };
  flakiness?: { ... };    // populated if FlakinessTracker is wired
  adversarial?: { ... };  // populated if adversarial personas ran
  details: Record<string, unknown>;
}
```

`overall` is a weighted average. Default weights:

| Dimension | Default weight |
|-----------|---------------|
| `regression_health` | 30% |
| `flow_coverage` | 25% |
| `persona_realism` | 15% |
| `coverage_delta` | 15% |
| `fixture_health` | 10% |
| `discovery_yield` | 5% |

Weights are configurable in your `ScoringAdapter` implementation. A stability-focused product should weight `regression_health` higher; an early-stage product discovering new paths should weight `coverage_delta` and `discovery_yield` more.

---

## `persona_realism`

**What it measures:** Did the simulation agents reach their stated persona goals?

**How it's computed:** Ratio of `goals_reached` to `goals_attempted` across all personas in this iteration, scaled 0–10.

```
persona_realism = (goals_reached / goals_attempted) × 10
```

A goal is "reached" when the agent produces a `flow_end` event on a screen path that satisfies the goal condition. What "satisfies" means is product-defined in the `SimulationAdapter`.

**Score: 9–10 (healthy)**
Agents are navigating the product successfully. Personas are well-calibrated to the current product state.

**Score: 6–8 (watch)**
Some personas are not reaching their goals. Common causes: a flow that previously worked is now broken; a goal requires product state that wasn't seeded; LLM agent is struggling with an ambiguous goal.

**Score: < 6 (investigate)**
Most personas are failing to reach goals. Either the product is broken in a fundamental way, or the goals are systematically impossible given the seeded state. Check `validateEnvironment()` first.

**How to improve:**
- Check that seeded entities provide a path to every persona goal
- Rewrite vague goals as specific, actionable statements
- Increase tick count if personas need more steps to reach complex goals
- In deterministic mode, verify the behavior tree maps to the right actions

---

## `coverage_delta`

**What it measures:** How many new screen paths were discovered this iteration vs. the previous iteration.

**How it's computed:** The ANALYZE phase extracts novel paths not in `flows.yaml`. This count is normalized to 0–10 against a product-specific baseline (configurable: "what count of new paths per iteration is expected?").

```
coverage_delta = min(new_paths_found / expected_new_paths_per_iteration, 1.0) × 10
```

On the first iteration, `expected_new_paths` defaults to a value you configure. If no baseline is configured, the scorer uses the current iteration's count as the baseline for future iterations.

**Score: 8–10 (healthy early-stage)**
Simulation is finding new paths regularly. Personas are exploring. The test library is growing.

**Score: 5–7 (steady-state)**
Fewer new paths each iteration is normal as coverage matures. A product with 200 covered paths will naturally discover fewer new ones per run.

**Score: < 5 (stagnating)**
Simulation isn't finding new paths. Either the product surface is genuinely saturated (healthy if regression_health is also high) or personas are converging too narrowly. Add personas with different pressure profiles or force a different scenario.

**How to improve:**
- Add explorer personas (high `risk_tolerance`, low `urgency`)
- Run a different scenario that exercises less-covered product areas
- Increase tick count so agents have more steps to explore secondary flows
- Check that the ANALYZE step is running correctly — `candidate_flows.yaml` should have content after a healthy simulation

---

## `fixture_health`

**What it measures:** Are all seeded entities valid and internally consistent?

**How it's computed:** VERIFY runs explicit alias checks before simulation. After simulation, the scorer re-checks all aliases and validates relationships. `fixture_health` is the ratio of clean aliases to total aliases, scaled 0–10.

```
fixture_health = (clean_aliases / total_aliases) × 10
```

**Score: 10 (expected)**
All seeded entities resolved correctly. This should be 10 on every run. Anything below 10 means SEED is producing partial data.

**Score: < 10 (investigate immediately)**
Entity relationships are broken. Don't look at other dimensions until this is fixed — all coverage metrics are meaningless if the test state is invalid.

**How to fix:**
- Run `fab verify --root <iterRoot>` to see which alias failed
- Check `AppAdapter.seed()` for partial write failures (missing company record for an employer entity, missing profile for a user entity, etc.)
- Confirm `applyLisaDbMigrations()` ran before any seed writes

---

## `discovery_yield`

**What it measures:** Novel error outcomes discovered — new failure modes that haven't been seen in previous iterations.

**How it's computed:** Compares `behavior_events` with `outcome = 'failure'` or `'blocked'` against a running registry of known failure types. New failure types increment the yield count.

```
discovery_yield = min(new_failure_types / expected_yield_per_iteration, 1.0) × 10
```

**Score: 8–10 (healthy early-stage)**
Simulation is surfacing new error conditions. The product has edge cases being discovered.

**Score: 4–7 (steady-state)**
Normal for a mature product. Most failure modes are known. This score naturally decreases over time as the system maps the failure landscape.

**Score: < 4 with new product areas shipping**
New features should produce new failure modes. If `coverage_delta` is high (new paths found) but `discovery_yield` is low, the new paths are happy-path only — consider adding adversarial personas to probe them.

**How to improve:**
- Add adversarial personas to actively probe new flows
- Run scenarios that target recently changed product areas
- Add personas with extreme pressure values that reveal edge cases (zero `risk_tolerance` + max `urgency`)

---

## `regression_health`

**What it measures:** Are the previously passing flows still passing?

**How it's computed:** Compares the current `flow-results.json` against the previous iteration's results. Flows that passed before and fail now are regressions.

```
regression_health = (passing_flows / total_regression_flows) × 10
```

Where `total_regression_flows` is flows from `flows.yaml` (not newly generated flows). Newly generated flows are not included in regression health — they haven't established a "previously passing" baseline yet.

**Score: 9–10 (healthy)**
No regressions or minimal. Previously known flows are stable.

**Score: 7–8 (warning)**
1–2 flows are failing that previously passed. Check git log for recent changes to those code paths.

**Score: < 7 (stop and investigate)**
Multiple regressions. This is the score gate dimension — `overall` will likely drop below threshold. Identify which flows are failing (check `fabric-score.json`'s `details.failingFlows`), run `fab flows --grep <failing-flow>` to reproduce, and check recent deployments.

**This is the most important dimension.** A system where `regression_health` stays high is a system where the product is not breaking. Protect it.

**How to improve:**
- Never quarantine a flow just to raise this score — quarantine is for flakiness, not regressions
- Investigate and fix the underlying product issue
- If the regression is in a flow that is intentionally changing (redesign, feature removal), delete the old spec and let GENERATE_FLOWS create a new one

---

## `flow_coverage`

**What it measures:** What percentage of the known flow catalog is currently passing?

**How it's computed:** `passed / total` from `flow-results.json`, scaled 0–10.

```
flow_coverage = (flows_passed / flows_total) × 10
```

Unlike `regression_health` (which only cares about regressions), `flow_coverage` includes all flows — including ones that have never passed. A new flow that fails on its first run drops `flow_coverage` but doesn't affect `regression_health`.

**Score: 9–10 (healthy)**
Almost all known flows are passing. The product is covering its known surface area cleanly.

**Score: 7–8 (investigate)**
Some flows are failing. Check `flow-results.json` for which ones.

**Score: < 7 (significant coverage gap)**
Multiple flows failing. May be a product issue (regressions) or a test infrastructure issue (Playwright not connecting, wrong base URL, locators stale). Distinguish between "product broke" (fix the product) and "test infrastructure broke" (fix the adapter).

**How to improve:**
- Confirm `BrowserAdapter.runSpecs()` is pointing at the correct base URL
- Check for recently changed UI that invalidated generated locators
- Run `fab flows --root <iterRoot>` to debug specific failures in isolation

---

## The `flakiness` summary

Populated when `FlakinessTracker` is wired. Not a scored dimension — it is informational:

```json
"flakiness": {
  "quarantinedFlows": ["seeker-notifications", "employer-bulk-invite"],
  "topFlaky": [
    { "flowName": "seeker-notifications", "failureRate": 0.42, "total": 12, "quarantined": true },
    { "flowName": "employer-analytics", "failureRate": 0.18, "total": 11, "quarantined": false }
  ]
}
```

Quarantined flows are excluded from `flow_coverage` and `regression_health` computation — they can't drag the score down, but they are tracked so you can fix them deliberately.

A high quarantine count is a signal that test infrastructure needs attention, not that the product is broken.

---

## The `adversarial` summary

Populated when adversarial personas ran:

```json
"adversarial": {
  "probesAttempted": 14,
  "violationsFound": 2,
  "topViolations": [
    "Empty 'trade' field accepted on job application submission",
    "Seeker user accessed /employer/analytics without 403"
  ]
}
```

`violationsFound > 0` is always worth reviewing. A violation is an adversarial probe that succeeded when it should have been blocked — a validation gap or access control issue.

---

## Interpreting scores over time

The score trend is more informative than any single score.

**Score rising over iterations:** Coverage growing, regressions stable. Healthy loop.

**Score flat after 3+ iterations:** Coverage saturation in current personas' domain. Add personas in unexplored areas or force a new scenario.

**Score dropping suddenly:** Usually a regression (`regression_health` drops) or adapter breakage (`fixture_health` drops). Check which dimension dropped first.

**Score oscillating:** Flakiness in the test infrastructure. Check the quarantine list — flaky flows affect `flow_coverage` until quarantined.

---

## CI threshold recommendations

| Stage | Recommended threshold | Why |
|-------|----------------------|-----|
| PR smoke | 6.0 | Early-stage — don't block PRs over coverage gaps |
| Merge to develop | 7.5 | Regression gate — any regression below this warrants investigation |
| Staging deploy | 8.0 | High confidence before going to staging |
| Production deploy | 8.5 | Near-zero tolerance for regressions |

These are starting points. Calibrate based on your risk tolerance and how mature your persona library is. A new product on its third iteration should have a lower threshold than a mature product on its 50th.
