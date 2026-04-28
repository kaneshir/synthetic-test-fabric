# Schema Reference

All data shapes an adapter implementor touches, in one place. Every type here
is exported from `synthetic-test-fabric`. No source-diving required.

---

## Result types returned by adapters

### `SeededEntity`

Returned from `AppAdapter.seed()`. Represents one entity created during seeding.

```typescript
interface SeededEntity {
  alias: string;           // Fabric-assigned stable key, e.g. 'account.primary', 'user.1'
  id: string;              // App-assigned ID (auth subject, DB row ID, etc.)
  type: string;            // App-defined role string, e.g. 'member', 'admin', 'project'
  credentials?: {
    email: string;
    password: string;
  };
  meta?: Record<string, unknown>;  // Arbitrary adapter-defined key/value bag
}
```

Example:

```json
{
  "alias": "account.primary",
  "id": "usr_abc123",
  "type": "member",
  "credentials": { "email": "alice@example.com", "password": "Test1234!" },
  "meta": { "plan": "free", "region": "us-west" }
}
```

---

### `AppHealthResult`

Returned from `AppAdapter.validateEnvironment()`. Must never throw — surface
errors in the `errors` array instead.

```typescript
interface AppHealthResult {
  healthy: boolean;
  errors: string[];    // Fatal blockers — loop will not start if non-empty
  warnings: string[];  // Non-fatal notices — logged but loop continues
}
```

---

### `SimulationRunResult`

Returned from `SimulationAdapter.run()`.

```typescript
interface SimulationRunResult {
  simulationId: string;        // Stable ID for this run, used to query lisa.db
  ticksCompleted: number;      // Actual ticks executed (may be < requested on early exit)
  behaviorEventsWritten: number;
}
```

---

### `BrowserRunResult`

Returned from `BrowserAdapter.runSpecs()`. The adapter must write the results
file to disk before returning — the framework reads it immediately after.

```typescript
interface BrowserRunResult {
  passed: number;
  failed: number;
  total: number;
  resultsPath: string;  // Absolute path to the JSON results file on disk
}
```

The results file must be Playwright JSON reporter output. For the `regression`
project, `resultsPath` must equal `path.join(iterRoot, 'flow-results.json')`.
For `generated-flows`, any path under `iterRoot` is acceptable.

---

### `ScenarioPlan`

Returned from `ScenarioPlanner.plan()`. Drives the next iteration's seed call.

```typescript
interface ScenarioPlan {
  scenarioName: string;               // Passed to AppAdapter.seed() as config.scenarioName
  rationale: string;                  // Human-readable explanation, written to artifacts
  personaAdjustments: PersonaAdjustment[];
}
```

---

### `FabricReport`

Returned from `Reporter.report()`. Must not throw — surface errors in `content`.

```typescript
interface FabricReport {
  format: 'json' | 'console' | 'markdown' | 'ci';
  content: string;
}
```

---

## Scoring types

### `FabricScore`

Returned from `ScoringAdapter.score()`. Must also be written to
`path.join(iterRoot, 'fabric-score.json')`.

```typescript
interface FabricScore {
  simulationId: string;
  generatedAt: string;   // ISO 8601 timestamp
  overall: number;       // Weighted average of all dimensions, 0–10
  dimensions: {
    persona_realism:   number;  // 0–10
    coverage_delta:    number;  // 0–10
    fixture_health:    number;  // 0–10
    discovery_yield:   number;  // 0–10
    regression_health: number;  // 0–10
    flow_coverage:     number;  // 0–10
  };
  /** Populated when FlakinessTracker is wired. Omit if not used. */
  flakiness?: {
    quarantinedFlows: string[];
    topFlaky: Array<{
      flowName: string;
      failureRate: number;
      total: number;
      quarantined: boolean;
    }>;
  };
  /** Populated when adversarial personas ran. Omit if not used. */
  adversarial?: {
    probesAttempted: number;
    violationsFound: number;
    topViolations: string[];
  };
  details: Record<string, unknown>;  // Adapter-defined extra data; can be {}
}
```

---

## Feedback types

### `PersonaAdjustment`

Part of `FabricFeedback` and `ScenarioPlan`. Tells the next iteration's seed
how to shift persona pressure.

```typescript
interface PersonaAdjustment {
  persona_id: string;                                        // e.g. 'maria-chen'
  field: 'pressure.urgency' | 'pressure.financial' | 'trade';
  old_value: number | string;
  new_value: number | string;
  reason: string;
}
```

---

### `FabricFeedback`

Returned from `FeedbackAdapter.feedback()`. Must also be written to
`path.join(iterRoot, 'fabric-feedback.json')`.

```typescript
interface FabricFeedback {
  schema_version: 1;
  loop_id: string;
  iteration: number;
  simulation_id: string;
  previous_iteration_root: string | null;
  generated_specs: string[];         // Spec filenames generated this iteration
  score_snapshot: FabricScore;
  failed_flows: Array<PlaywrightFailedFlow & { suggested_scenario: string | null }>;
  persona_adjustments: PersonaAdjustment[];
}
```

Where `PlaywrightFailedFlow` is:

```typescript
interface PlaywrightFailedFlow {
  spec_title: string;     // Full test title from Playwright output
  spec_file: string;      // Absolute path to the spec file
  screen_path: string;    // Normalized path label, e.g. 'seeker/jobs/job_detail'
  failure_reason: string; // First 300 chars of the Playwright error message
}
```

---

## Event recording types

### `RecorderInput`

Passed to `BehaviorEventRecorder.record()`. The recorder assigns `event_id`,
`sequence_in_tick`, and `recorded_at` — do not set these yourself.

```typescript
type RecorderInput = {
  execution_id: string;           // Unique per logical operation; used for idempotency.
                                  // Duplicate (execution_id, execution_state) pairs are
                                  // silently ignored — safe to retry writes.
  simulation_id: string;          // Must match the simulationId from SimulationRunResult
  agent_id: string;               // e.g. 's1', 'agent-42'
  entity_id: string;              // App entity ID (matches SeededEntity.id)
  persona_definition_id: string | null;
  tick: number;
  sim_time: string;               // ISO 8601 timestamp for the simulated moment
  action: string;                 // Human-readable description of what the agent did
  reasoning: string | null;
  event_source: 'agent' | 'orchestrator' | 'fixture' | 'verify' | 'flow';
  event_kind: 'action' | 'decision' | 'fixture_setup' | 'flow_start' | 'flow_end' | 'verify_check' | 'adversarial_probe';
  execution_state: 'started' | 'completed' | 'cancelled' | 'failed' | 'fallback' | null;
  outcome: BehaviorOutcome;       // Use BEHAVIOR_OUTCOMES constants — never raw strings
  outcome_detail: string | null;
  screen_path: string | null;     // e.g. 'seeker/jobs/apply' — must not start with '['
  entity_refs: string | null;     // JSON object string, e.g. '{"user_id":"usr_123"}'
}
```

---

### `BEHAVIOR_OUTCOMES`

The complete set of valid outcome values. Always use these constants when
calling `recorder.record()` — raw strings will fail the SQLite CHECK constraint.

| Constant | Value | When to use |
|----------|-------|-------------|
| `SUCCESS` | `'success'` | Operation completed as expected |
| `SKIPPED` | `'skipped'` | Agent chose not to act this tick |
| `BLOCKED` | `'blocked'` | App prevented the action (non-error) |
| `TIMEOUT` | `'timeout'` | Operation exceeded time limit |
| `CANCELLED` | `'cancelled'` | Operation was cancelled mid-flight |
| `LLM_FALLBACK` | `'llm_fallback'` | Agent fell back to deterministic logic |
| `ERROR_400` | `'error_400'` | HTTP 400 Bad Request |
| `ERROR_401` | `'error_401'` | HTTP 401 Unauthorized |
| `ERROR_403` | `'error_403'` | HTTP 403 Forbidden |
| `ERROR_404` | `'error_404'` | HTTP 404 Not Found |
| `ERROR_409` | `'error_409'` | HTTP 409 Conflict |
| `ERROR_422` | `'error_422'` | HTTP 422 Unprocessable Entity |
| `ERROR_429` | `'error_429'` | HTTP 429 Rate Limited |
| `ERROR_500` | `'error_500'` | HTTP 500 Internal Server Error |
| `ERROR_503` | `'error_503'` | HTTP 503 Service Unavailable |
| `ERROR_UNKNOWN` | `'error_unknown'` | Any other error condition |

Use `classifyOutcome(error)` to map an HTTP error or exception to the right
constant automatically.

```typescript
import { BEHAVIOR_OUTCOMES, classifyOutcome } from 'synthetic-test-fabric';

// Direct use
recorder.record({ ..., outcome: BEHAVIOR_OUTCOMES.SUCCESS });

// From a caught error
try {
  await api.doSomething();
  recorder.record({ ..., outcome: BEHAVIOR_OUTCOMES.SUCCESS });
} catch (err) {
  recorder.record({ ..., outcome: classifyOutcome(err) });
}
```

---

## `BehaviorEventRecorder` API

The recorder handles batching, sequencing, and idempotent writes to `lisa.db`.
Use it in `SimulationAdapter.run()` to emit events.

```typescript
class BehaviorEventRecorder {
  /**
   * Get or create the singleton for this dbPath + mode combination.
   * Call once at the start of SimulationAdapter.run() and reuse the instance.
   *
   * mode 'simulation' — warnings are logged; dropped events do not throw.
   * mode 'fabric'     — errors throw immediately; use for framework-internal events.
   */
  static getInstance(dbPath: string, mode: 'fabric' | 'simulation'): BehaviorEventRecorder;

  /**
   * Enqueue a behavior event. Flushes automatically when the queue reaches 50
   * events or after 100 ms, whichever comes first.
   *
   * Throws if simulation_id is missing and mode is 'fabric'.
   * Duplicate (execution_id, execution_state) pairs are silently ignored.
   */
  record(input: RecorderInput): void;

  /**
   * Synchronously flush all queued events to disk.
   * Call at the end of SimulationAdapter.run() before returning.
   */
  flush(): void;

  /**
   * Close all open database connections and clear all instances.
   * The orchestrator does NOT call this automatically. You must call it:
   *   - In your test harness teardown between in-process test runs.
   *   - In SimulationAdapter.clean() if running multiple iterations in-process
   *     and you need a fresh DB connection each time.
   * The recorder holds open SQLite connections until reset() is called.
   */
  static reset(): void;

  /** Number of events dropped due to missing simulation_id or write errors. */
  get dropped(): number;
}
```

**Call ordering in `SimulationAdapter.run()`:**

```typescript
async run(iterRoot, options) {
  const dbPath = path.join(iterRoot, '.lisa_memory', 'lisa.db');
  const recorder = BehaviorEventRecorder.getInstance(dbPath, 'simulation');

  for (let tick = 0; tick < options.ticks; tick++) {
    // ... run agent logic ...
    recorder.record({ simulation_id: options.simulationId, tick, ... });
  }

  recorder.flush();  // Always flush before returning
  return { simulationId: options.simulationId, ticksCompleted: options.ticks, behaviorEventsWritten: ... };
}
```

---

## Error contract

Which adapter methods must throw, which must return errors, and what the
orchestrator does in each case.

| Method | On failure | Orchestrator behavior |
|--------|-----------|----------------------|
| `AppAdapter.validateEnvironment()` | Return `{ healthy: false, errors: [...] }` — **must not throw** | Aborts loop before first iteration |
| `AppAdapter.seed()` | Throw | Aborts current iteration |
| `AppAdapter.verify()` | Throw | Aborts current iteration |
| `AppAdapter.reset()` | May throw | Not called by the framework — invoke manually if you need cleanup between iterations |
| `AppAdapter.importRun()` | Throw | Aborts current iteration (awaited without catch inside IMPORT step) |
| `SimulationAdapter.run()` | May throw | Aborts current iteration |
| `SimulationAdapter.exportEntities()` | May throw | Aborts current iteration |
| `SimulationAdapter.clean()` | May throw | Logged; loop continues |
| `ScoringAdapter.score()` | Throw | Aborts current iteration |
| `FeedbackAdapter.feedback()` | Throw | Aborts current iteration |
| `BrowserAdapter.runSpecs()` — `allowFailures: false` | Throw on test failures | Aborts current iteration |
| `BrowserAdapter.runSpecs()` — `allowFailures: true` | **Must not throw** — return failed count | Loop continues to SCORE |
| `MemoryAdapter.*` | Framework-internal; behavior depends on caller | Varies |
| `Reporter.report()` | **Must not throw** — surface errors in `content` | Logged; does not affect score |
| `ScenarioPlanner.plan()` | — | Not called by the framework in the current loop — wire manually if using planner-driven scenario selection |

**Idempotency requirement:** `seed()` and `verify()` must be safe to call
multiple times with the same inputs. Use `INSERT OR IGNORE` / `UPSERT` patterns.
Do not assume a clean database — a previous failed iteration may have partially
seeded data.
