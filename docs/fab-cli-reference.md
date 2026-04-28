# fab CLI Reference

`fab` is the command-line interface for Synthetic Test Fabric. It reads a `fabric.config.ts` (or `.js`, `.mjs`, `.cjs`) from your current directory and runs any phase of the loop, individually or all at once.

```bash
npx fab <command> [options]
```

---

## Setup

`fab` ships as a binary in the `synthetic-test-fabric` package:

```bash
npm install synthetic-test-fabric
```

Create a config file in your project root:

```typescript
// fabric.config.ts
import type { FabricConfig } from 'synthetic-test-fabric';
import { MyAppAdapter } from './fabric/app-adapter';
import { MySimulationAdapter } from './fabric/sim-adapter';
// ... other adapters

export default {
  adapters: {
    app:        new MyAppAdapter(),
    simulation: new MySimulationAdapter(),
    scoring:    new MyScoringAdapter(),
    feedback:   new MyFeedbackAdapter(),
    memory:     new MyMemoryAdapter(),
    browser:    new MyBrowserAdapter(),
    reporters:  [new ConsoleReporter()],
    planner:    new MyScenarioPlanner(),
  },
  defaults: {
    ticks:      10,
    iterations: 3,
    seekers:    2,
    employers:  1,
    employees:  1,
  },
  baselineDir: './visual-baselines',
} satisfies FabricConfig;
```

`tsx` must be available to load `.ts` config files:

```bash
npm install --save-dev tsx
```

---

## Commands

---

### `fab orchestrate`

Run the full loop: SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK, repeated for `--iterations` iterations.

```bash
npx fab orchestrate [options]
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--iterations <n>` | `1` | Number of loop iterations to run |
| `--ticks <n>` | `10` | Simulation ticks per iteration |
| `--seekers <n>` | `2` | Seeker personas to seed |
| `--employers <n>` | `1` | Employer personas to seed |
| `--employees <n>` | `0` | Employee personas to seed |
| `--scenario <name>` | planner decides | Force a specific scenario instead of using the planner |
| `--live-llm` | `false` | Enable live LLM calls during simulation |
| `--root <dir>` | temp dir | Base directory for run roots (created if absent) |
| `--config <path>` | `fabric.config.ts` | Path to config file |

**Examples:**

```bash
# Standard run — 3 iterations, default settings from config
npx fab orchestrate

# Fast CI run — 1 iteration, no live LLM (default)
npx fab orchestrate --iterations 1

# Deep exploration — 10 iterations, live LLM, large agent pool
npx fab orchestrate --iterations 10 --ticks 20 --seekers 5 --employers 3 --live-llm

# Force a specific scenario
npx fab orchestrate --scenario offer_negotiation
```

---

### `fab fresh`

One-shot fresh run: seed → verify → optionally run flows and compute score. Creates a temporary run root, performs the requested phases, and removes it on success (unless `--keep` is set).

```bash
npx fab fresh [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--flows` | Run Playwright flows after seeding |
| `--plan` | Compute score and generate feedback JSON after seeding |
| `--scenario <name>` | Named scenario for the seed step |
| `--root <dir>` | Use a specific run root directory (created if absent) |
| `--keep` | Keep run root on success (always kept on failure) |
| `--seekers <n>` | Seeker count (default: 2) |
| `--employers <n>` | Employer count (default: 1) |
| `--employees <n>` | Employee count (default: 0) |
| `--config <path>` | Path to config file |

Use when the run root is corrupted, when you want to test with a clean slate, or when `verify()` is failing due to stale state.

---

### `fab smoke`

Fastest handoff check: seed → verify → one bounded smoke flow. Designed to confirm the seeded state is valid and a single representative flow passes. Completes in seconds.

```bash
npx fab smoke [--root <dir>] [--keep] [--config <path>]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--root <dir>` | Use a specific run root directory |
| `--keep` | Keep run root after completion |
| `--config <path>` | Path to config file |

**Exit codes:**
- `0` — Seed, verify, and smoke flow all passed
- `1` — Any phase failed

---

### `fab seed`

Run the SEED phase only. Creates synthetic users and writes to `lisa.db`. Does not run simulation or browser flows.

```bash
npx fab seed [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--root <dir>` | Iteration root directory to seed into |
| `--scenario <name>` | Scenario to pass to `AppAdapter.seed()` |
| `--seekers <n>` | Number of seeker entities to create |
| `--employers <n>` | Number of employer entities to create |

**Example:**

```bash
# Seed into a specific run root for manual testing
npx fab seed --root ./fabric-runs/debug-001 --scenario high_volume_applications
```

---

### `fab verify`

Run the VERIFY phase against an existing run root. Checks that all seeded aliases in `mini-sim-export.json` are present in `lisa.db`.

```bash
npx fab verify --root <dir>
```

**Exit codes:**
- `0` — All aliases resolved
- `1` — One or more aliases missing; error message names the missing alias

---

### `fab flows`

Run the TEST phase only against an existing run root — executes the Playwright regression suite without re-seeding or re-simulating. Use for rapid iteration on flow debugging.

```bash
npx fab flows --root <dir> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--root <dir>` | Run root with a populated `lisa.db` |
| `--grep <pattern>` | Run only flows matching this regex |
| `--project <name>` | Playwright project to run (`flows`, `generated-flows`) |

**Examples:**

```bash
# Run all flows against a previous iteration's seed
npx fab flows --root ./fabric-runs/loop-001/iter-003

# Debug a specific failing flow
npx fab flows --root ./fabric-runs/loop-001/iter-003 --grep seeker-apply
```

---

### `fab score`

Compute a `FabricScore` from an existing run root. Reads `flow-results.json` and `lisa.db`, writes `fabric-score.json`, and prints the dimension breakdown.

```bash
npx fab score --root <dir>
```

**Output:**

```
overall:           8.4
persona_realism:   9.1  ✓
coverage_delta:    8.5  ✓
fixture_health:   10.0  ✓
discovery_yield:   7.8
regression_health: 8.2
flow_coverage:     8.0
```

---

### `fab feedback`

Generate `FabricFeedback` from an existing scored run root. Reads `fabric-score.json`, writes `fabric-feedback.json`.

```bash
npx fab feedback --root <dir>
```

Reads `fabric-score.json` from the run root and writes `fabric-feedback.json`. Run `fab score` first if the score file is not yet present.

---

### `fab analyze`

Run the ANALYZE phase against an existing run root. Reads `behavior_events` from `lisa.db` and writes `candidate_flows.yaml`.

```bash
npx fab analyze --root <dir>
```

Useful for inspecting what the simulation discovered without running the full loop. Check `candidate_flows.yaml` after this command to see which paths are new.

---

### `fab check`

CI score gate. Reads `fabric-score.json` from a run root and exits non-zero if the overall score is below the threshold.

```bash
npx fab check --root <dir> --threshold <n>
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--root <dir>` | *(required)* | Run root containing `fabric-score.json` |
| `--threshold <n>` | `8.0` | Minimum acceptable overall score |

**Exit codes:**
- `0` — Score meets or exceeds threshold
- `1` — Score below threshold

**Output on failure:**

```
✗ Score gate failed: 6.8 < 8.0

  persona_realism:   9.1  ✓
  coverage_delta:    8.5  ✓
  fixture_health:   10.0  ✓
  discovery_yield:   7.2
  regression_health: 3.0  ✗  regressions: seeker-apply-flow, employer-view-apps
  flow_coverage:     5.5  ✗  4/8 flows passing
```

Wire this as a required CI check to block deploys when product health drops.

---

### `fab baseline`

Visual regression baseline management.

#### `fab baseline list`

List all committed baselines and when they were last updated.

```bash
npx fab baseline list [--baseline-dir <dir>]
```

**Output:**

```
baselines in ./visual-baselines/

  login-page            updated 2026-04-20
  dashboard-seeker      updated 2026-04-21
  job-listing           updated 2026-04-18
  application-form      updated 2026-04-21
```

#### `fab baseline update <flow>`

Accept the current screenshot as the new baseline for a specific flow.

```bash
npx fab baseline update <flow> --root <dir> [--baseline-dir <dir>]
```

`<flow>` is required — it names the flow whose screenshot to promote. Overwrites the committed PNG with the screenshot from the current run. Commit the updated baseline to make it the new reference.

**Example:**

```bash
# Update the login-page baseline after an intentional UI change
npx fab baseline update login-page --root ./fabric-runs/latest
git add visual-baselines/ && git commit -m "update login-page visual regression baseline"
```

#### `fab baseline reset`

Delete all baselines. The next run will create fresh baselines from scratch.

```bash
npx fab baseline reset [--baseline-dir <dir>]
```

---

## Common options

These appear on most commands (exact availability listed per-command above):

| Flag | Default | Description |
|------|---------|-------------|
| `--config <path>` | `fabric.config.ts` | Path to config file |
| `--root <dir>` | *(varies — see per-command)* | Run root directory |
| `--baseline-dir <dir>` | `config.baselineDir` | Visual regression baseline directory |
| `--help` | — | Show help |

---

## Config file resolution

`fab` looks for the config file in this order:

1. `--config <path>` flag
2. `fabric.config.ts` in current directory
3. `fabric.config.js`
4. `fabric.config.mjs`
5. `fabric.config.cjs`

TypeScript configs are loaded via `tsx`. If `tsx` is not installed, `fab` will error clearly with an install suggestion.

---

## Using `fab` without a config file

Some commands work without a config file by accepting adapter paths directly:

```bash
# Not yet supported — planned for v0.2.0
npx fab smoke --app ./adapters/app.ts --simulation ./adapters/sim.ts
```

For now, a `fabric.config.ts` is required for all commands that invoke adapters.

---

## Programmatic API

Every `fab` command has a corresponding programmatic equivalent. If you need to call the orchestrator from a script:

```typescript
import { FabricOrchestrator, makeLoopId, assertScoreThreshold } from 'synthetic-test-fabric';
import config from './fabric.config';

const orchestrator = new FabricOrchestrator(config.adapters);
await orchestrator.run({
  loopId:     makeLoopId(),
  iterations: 1,
  ticks:      config.defaults?.ticks ?? 10,
  liveLlm:    false,
  ...config.defaults,
});
```
