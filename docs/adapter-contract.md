# Adapter Contract

Adapters are the seam between Synthetic Test Fabric and your product. The
framework drives the loop; adapters do everything app-specific.

All adapter interfaces are exported from `synthetic-test-fabric`.

---

## AppAdapter

Owns the simulated world: seeding entities, verifying state, and validating
that the environment is healthy enough to run.

```typescript
interface AppAdapter {
  seed(iterRoot: string, config: {
    seekers: number;
    employers: number;
    employees: number;
    scenarioName?: string;
    personaAdjustmentsPath?: string;
  }): Promise<SeededEntity[]>;

  reset(iterRoot: string): Promise<void>;
  validateEnvironment(): Promise<AppHealthResult>;
  verify(iterRoot: string): Promise<void>;
  importRun(iterRoot: string, dbUrl: string): Promise<void>;
}
```

**`seed`** — Create synthetic users and state. Write seeded entity records to
`lisa.db` so downstream steps can resolve them by alias. Write
`mini-sim-export.json` to `iterRoot`.

**`verify`** — Fail-closed check. Must throw if any required alias is missing
from `lisa.db`. The framework aborts the iteration if this throws.

**`validateEnvironment`** — Called once before the loop starts. Return errors
for anything that would make the run impossible (missing binaries, services
down, etc.).

**`importRun`** — Optional. Write cross-run data to Postgres `fabric.db`.
Only called if `dbUrl` is configured. Safe to no-op.

---

## SimulationAdapter

Runs agent ticks and exports behaviour.

```typescript
interface SimulationAdapter {
  run(iterRoot: string, options: {
    ticks: number;
    liveLlm: boolean;
    simulationId?: string;
  }): Promise<SimulationRunResult>;

  exportEntities(iterRoot: string, entities: SeededEntity[]): Promise<void>;
  clean(iterRoot: string): Promise<void>;
}
```

**`run`** — Execute agent ticks. The framework passes `ticks` from
`OrchestratorOptions`. Write behaviour events to `lisa.db` if Phase 1 is
implemented. Return `ticksCompleted` and `behaviorEventsWritten`.

**`exportEntities`** — Called after `run`. Write any additional entity state
needed by the ANALYZE step (e.g. stub files for discovered paths).

---

## ScoringAdapter

Computes the six-dimensional `FabricScore` from run artifacts.

```typescript
interface ScoringAdapter {
  score(iterRoot: string): Promise<FabricScore>;
}
```

Must write `fabric-score.json` to `iterRoot`. The framework reads this file
after `score()` returns.

The six score dimensions: `persona_realism`, `coverage_delta`,
`fixture_health`, `discovery_yield`, `regression_health`, `flow_coverage`.
All are 0–10. `overall` is computed as a weighted average.

---

## FeedbackAdapter

Generates `FabricFeedback` that informs the next iteration's seed config.

```typescript
interface FeedbackAdapter {
  feedback(iterRoot: string, options: {
    score: FabricScore;
    loopId: string;
    iteration: number;
    previousIterRoot: string | null;
  }): Promise<FabricFeedback>;
}
```

Must write `fabric-feedback.json` to `iterRoot`.

---

## BrowserAdapter

Executes Playwright flows and generates new specs from discovered paths.

```typescript
interface BrowserAdapter {
  runSpecs(options: {
    iterRoot: string;
    project: string;
    allowFailures: boolean;
    /** Test-name filter passed to Playwright's --grep flag. Not a model name. */
    grep?: string;
    /** Retry each failing spec up to this many times with jitter. Default: 0 (no retry). */
    retryCount?: number;
    /** Base delay in ms between retries (exponential backoff + jitter applied). Default: 500. */
    retryDelayMs?: number;
    /** Flow names to skip entirely — quarantined flows passed from FlakinessTracker. */
    quarantinedFlows?: string[];
    /** LLM provider resolved by the framework for the generate-flows project. Adapters may ignore it. */
    llmProvider?: LlmProvider;
  }): Promise<BrowserRunResult>;
}
```

The framework calls `runSpecs` three times per iteration with different
`project` values:

| `project` | Purpose | `llmProvider` |
|-----------|---------|---------------|
| `generate-flows` | Generate new Playwright specs from `candidate_flows.yaml` | Set to the resolved provider — pass to your spec-generator subprocess |
| `generated-flows` | Execute newly generated flows (failures are non-fatal) | `undefined` |
| `regression` | Execute the full regression suite | `undefined` |

`llmProvider` is only populated for the `generate-flows` project. If you are
writing a `BrowserAdapter` that wraps a spec-generator subprocess, forward it
via `LISA_LLM_PROVIDER_ID` env or a CLI flag. If you do not use `generate-flows`,
you can safely ignore the field.

Write `flow-results.json` to `iterRoot` for the `regression` run. The framework
checks for this file after the TEST step.

---

## MemoryAdapter

Thin wrapper over `lisa.db` operations. No-op implementation is fine for v1.

```typescript
interface MemoryAdapter {
  migrate(dbPath: string): void;
  writeEvent(dbPath: string, event: RecorderInput): void;
  resolveEntity(dbPath: string, alias: string): SeededEntity | null;
  listEntities(dbPath: string, simulationId: string): SeededEntity[];
}
```

---

## Reporter

Publishes score output after each iteration.

```typescript
interface Reporter {
  report(score: FabricScore, iterRoot: string): Promise<FabricReport>;
}
```

Multiple reporters can be registered. Common implementations: console,
GitHub PR comment, Slack webhook, HTML file.

---

## ScenarioPlanner

Recommends the next scenario based on the current score.

```typescript
interface ScenarioPlanner {
  plan(score: FabricScore, iterRoot: string): Promise<ScenarioPlan>;
}
```

Return `scenarioName` and `personaAdjustments`. The framework passes these
to `AppAdapter.seed()` in the next iteration.

---

## Wiring it together

```typescript
import { FabricOrchestrator, makeLoopId } from 'synthetic-test-fabric';
import type { OrchestratorAdapters, OrchestratorOptions } from 'synthetic-test-fabric';

const adapters: OrchestratorAdapters = {
  app:        new MyAppAdapter(),
  simulation: new MySimulationAdapter(),
  scoring:    new MyScoringAdapter(),
  feedback:   new MyFeedbackAdapter(),
  memory:     new MyMemoryAdapter(),
  browser:    new MyBrowserAdapter(),
  reporters:  [new ConsoleReporter()],
  planner:    new MyScenarioPlanner(),
};

const options: OrchestratorOptions = {
  loopId:     makeLoopId(),
  iterations: 3,
  ticks:      5,
  liveLlm:    false,
  seekers:    2,
  employers:  1,
  employees:  1,
};

const orchestrator = new FabricOrchestrator(adapters);
await orchestrator.run(options);
```

See `demo/adapters.ts` for a complete no-dependency reference implementation.
