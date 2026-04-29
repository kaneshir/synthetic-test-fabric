# Orchestrator Reference

Complete reference for `FabricOrchestrator` and `OrchestratorOptions`.

---

## Instantiation

```typescript
import { FabricOrchestrator } from 'synthetic-test-fabric';
import type { OrchestratorAdapters } from 'synthetic-test-fabric';

const orchestrator = new FabricOrchestrator(adapters);
const score = await orchestrator.run(options);
```

`FabricOrchestrator` takes one argument — the adapters object — and is stateless
between calls to `run()`. You can reuse the same instance across runs.

---

## `OrchestratorOptions` — field reference

All fields are required unless marked optional.

### `iterations` — `number`

How many full SEED→IMPORT cycles to run before returning.

| Entry point | Default |
|-------------|---------|
| Programmatic | required |
| CLI (`fab orchestrate`) | `1` |
| Demo (`demo/run.ts`) | `1` |

Each iteration produces its own `iter-NNN/` directory under `loopRoot`. The
final iteration's `FabricScore` is returned from `run()`.

---

### `ticks` — `number`

Number of simulation ticks to run per iteration. Passed directly to
`SimulationAdapter.run()` as `options.ticks`.

| Entry point | Default |
|-------------|---------|
| Programmatic | required |
| CLI (`fab orchestrate`) | `5` |
| Demo (`demo/run.ts`) | `2` |

What counts as a "tick" is adapter-defined. For agent-based simulations a tick
is one agent decision cycle. For API replay it might be one request batch.

---

### `liveLlm` — `boolean`

Whether to enable live LLM calls during simulation. Passed to
`SimulationAdapter.run()` as `options.liveLlm`.

| Entry point | Default |
|-------------|---------|
| Programmatic | required |
| CLI (`fab orchestrate`) | `false` (unless `--live-llm` flag set) |
| Demo (`demo/run.ts`) | `false` (hardcoded) |

When `false`, simulation adapters are expected to use deterministic/scripted
agent behavior. Use `false` for CI and cost-sensitive runs.

---

### `allowRegressionFailures` — `boolean`

Controls what happens when the `regression` project fails in the TEST phase.

| Entry point | Default |
|-------------|---------|
| Programmatic | required |
| CLI (`fab orchestrate`) | `true` |
| Demo (`demo/run.ts`) | `false` |

**`true`** — regression failures are captured and the loop continues to SCORE.
The orchestrator deletes any stale `flow-results.json` before the run so a
crash mid-run cannot leave a stale passing file. After the run,
`flow-results.json` must exist and contain at least one result — if not, the
iteration aborts with an error.

**`false`** — any regression failure throws immediately, aborting the iteration
before SCORE.

> **Footgun:** CLI defaults to `true`; demo defaults to `false`. If you copy
> the demo's `false` into a CI script you will get iteration aborts on the
> first flaky test. Use `true` for continuous loops; `false` for strict
> handoff checks.

---

### `seekers` / `employers` / `employees` — `number`

Entity counts passed to `AppAdapter.seed()`. What these mean is
adapter-defined — the framework passes them through without interpretation.

| Entry point | Default |
|-------------|---------|
| Programmatic | required |
| CLI (`fab orchestrate`) | `2` / `1` / `0` |
| Demo | `2` / `1` / `0` |

---

### `loopRoot` — `string` (optional)

Absolute or relative path to the persistent loop root directory. The
orchestrator creates it if absent. All `iter-NNN/` directories are created
inside it.

If omitted, defaults to `/tmp/fabric-loop/<loopId>` — a fresh temp directory
per run. Omitting means no artifact persistence across process restarts.

Provide an explicit `loopRoot` when:
- You want to inspect artifacts after the run
- You want `current` symlink to point to the latest iteration
- You want to resume a loop (not yet supported, but the root is preserved)

---

### `loopId` — `string` (optional)

Identifier for this loop run. Written to log output and passed to
`FeedbackAdapter.feedback()`. Auto-generated via `makeLoopId()` if omitted.

Provide an explicit `loopId` when you need stable, reproducible identifiers
across runs (e.g. in tests or when correlating logs with external systems).

```typescript
import { makeLoopId } from 'synthetic-test-fabric';

// Auto-generate (recommended for production)
const options = { loopId: makeLoopId(), ... };

// Explicit (useful for tests)
const options = { loopId: 'ci-run-2024-01-15', ... };
```

---

### `llmProvider` — `LlmProvider` (optional)

An explicit LLM provider instance for the GENERATE_FLOWS phase. When set,
it takes precedence over `flowModel` and all env-var auto-detection.

```typescript
import { ClaudeCliProvider, ClaudeSdkProvider, GeminiProvider, OllamaProvider, OpenAIProvider } from 'synthetic-test-fabric';

// Zero-config (uses Claude.ai subscription)
const options = { llmProvider: new ClaudeCliProvider(), ... };

// SDK with specific model
const options = { llmProvider: new ClaudeSdkProvider({ model: 'claude-opus-4-7' }), ... };

// Custom provider — implement LlmProvider interface
const options = { llmProvider: { id: 'my-llm', complete: async (p) => callMyLlm(p) }, ... };
```

---

### `flowModel` — `string` (optional, legacy shorthand)

Convenience shorthand for selecting a built-in provider by string. Ignored
when `llmProvider` is set.

| Format | Provider selected |
|--------|-------------------|
| `'ollama:<model>'` e.g. `'ollama:llama3'` | `OllamaProvider` — local, no API key |
| Any other string e.g. `'gemini-1.5-pro'` | `GeminiProvider({ model: flowModel })` — requires `GEMINI_API_KEY` |

When `flowModel` is omitted, the framework auto-detects a provider in this order:

| Priority | Condition | Provider |
|----------|-----------|----------|
| 1 | `claude` CLI in PATH and `STF_DISABLE_CLAUDE_CLI` unset | `ClaudeCliProvider` |
| 2 | `ANTHROPIC_API_KEY` set | `ClaudeSdkProvider` |
| 3 | `OPENAI_API_KEY` set | `OpenAIProvider` |
| 4 | `GEMINI_API_KEY` set | `GeminiProvider` |
| — | None of the above | GENERATE_FLOWS skipped (non-fatal) |

If GENERATE_FLOWS is skipped, the TEST phase will still run the existing
regression suite. See `docs/env-vars.md` for how to configure each provider.

**`LISA_LLM_PROVIDER` and `resolveProvider()`**

`resolveProvider()` is the internal function that runs the full resolution order.
`LISA_LLM_PROVIDER` takes precedence over all env-var auto-detection:

| Step | Condition | Result |
|------|-----------|--------|
| 1 | `llmProvider` option is set | use it directly |
| 2 | `LISA_LLM_PROVIDER=anthropic` + `@kaneshir/lisa-mcp` installed | `AgentLoopProvider(AnthropicToolCallingProvider, mcpClientFactory)` |
| 3 | `LISA_LLM_PROVIDER=openai` + `@kaneshir/lisa-mcp` installed | `AgentLoopProvider(OpenAIToolCallingProvider, mcpClientFactory)` |
| 4 | `LISA_LLM_PROVIDER=gemini` + `@kaneshir/lisa-mcp` installed | `AgentLoopProvider(GeminiToolCallingProvider, mcpClientFactory)` |
| 5 | `flowModel` matches `'ollama:<model>'` | `OllamaProvider` |
| 6 | `flowModel` is any other string | `GeminiProvider({ model: flowModel })` |
| 7 | `claude` CLI in PATH and `STF_DISABLE_CLAUDE_CLI` unset | `ClaudeCliProvider` |
| 8 | `ANTHROPIC_API_KEY` set | `ClaudeSdkProvider` |
| 9 | `OPENAI_API_KEY` set | `OpenAIProvider` |
| 10 | `GEMINI_API_KEY` set | `GeminiProvider` |
| — | nothing | `undefined` — GENERATE_FLOWS skipped |

Steps 8–10 are checked in order — if multiple keys are set, Anthropic wins.
`AgentLoopProvider` requires `@kaneshir/lisa-mcp`. It spawns a fresh MCP binary
per `complete()` call and runs a multi-turn tool-call loop (`tools/list` →
dispatch → `tools/call`) until the LLM returns a text response.

---

### `dbUrl` — `string` (optional)

Connection URL for the persistent cross-run database. Passed to
`AppAdapter.importRun(iterRoot, dbUrl)` at the end of each iteration.

Expected format: a Postgres connection URL —
`postgres://user:pass@host:5432/dbname`.

If omitted, the IMPORT phase is **skipped silently** each iteration with a
warning log. Cross-run history (score trends, persona drift) will not be
persisted. The loop still completes normally.

---

### `scenarioName` — `string` (optional)

Named scenario passed to `AppAdapter.seed()` as `config.scenarioName`. Your
adapter uses this to select which fixtures and agent behaviors to seed. The
framework does not interpret this string.

If omitted, `AppAdapter.seed()` receives `scenarioName: undefined` and should
fall back to a default scenario.

---

### `iterRoot` — `string` (legacy, silently ignored)

Present in `OrchestratorOptions` for backwards type-compatibility but
`FabricOrchestrator.run()` does not read it. Passing `iterRoot` has no effect
— the loop always derives paths from `loopRoot`. Use `loopRoot` instead.

---

## Loop root and iteration paths

When `run()` starts, it resolves paths for each iteration:

```
<loopRoot>/
  iter-001/
    .lisa_memory/
      lisa.db
    mini-sim-export.json
    candidate_flows.yaml
    flow-results.json
    generated-flow-results.json
    fabric-score.json
    fabric-feedback.json
  iter-002/
    ...
  current -> iter-002/   ← symlink updated after each completed iteration
```

The `current` symlink always points to the most recently completed iteration.
It is updated atomically after each iteration's IMPORT step completes.

---

## Return value

`orchestrator.run()` returns the `FabricScore` from the **last completed
iteration**. If `iterations: 3`, you get the score from iteration 3.

If any iteration throws before reaching SCORE, `run()` rejects with the error
from the failed adapter call. No score is returned for that iteration.

---

## Pre-loop environment check

Before the first iteration, the orchestrator calls
`AppAdapter.validateEnvironment()`. If `healthy` is `false`, the loop throws
immediately and no iterations run. Use this to check service availability,
required credentials, and binary dependencies upfront.

---

## fabric.config.ts

All `fab` CLI commands load adapter wiring and option defaults from a config
file. By default the CLI looks for `fabric.config.ts` in `process.cwd()` and
falls back to `.js`, `.mjs`, and `.cjs` variants in that order. Pass
`--config <path>` to use a different location.

### Shape

```typescript
import type { FabricConfig } from 'synthetic-test-fabric';

const config: FabricConfig = {
  // Required — all eight adapter slots
  adapters: {
    app:        new MyAppAdapter(),
    simulation: new MySimulationAdapter(),
    browser:    new MyBrowserAdapter(),
    scoring:    new MyScoringAdapter(),
    feedback:   new MyFeedbackAdapter(),
    memory:     new MyMemoryAdapter(),
    reporters:  [new MyReporter()],
    planner:    new MyScenarioPlanner(),
  },

  // Optional — override OrchestratorOptions defaults for CLI commands
  defaults: {
    iterations: 3,
    ticks: 10,
    liveLlm: true,
  },

  // Optional — directory for visual regression baselines
  // Defaults to `.fab-baselines/` in process.cwd()
  baselineDir: '.fab-baselines',
};

export default config;
```

### `FabricConfig` interface

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `adapters` | `OrchestratorAdapters` | Yes | All eight adapter instances |
| `defaults` | `Partial<OrchestratorOptions>` | No | Default options for CLI commands. Precedence: CLI flag → config.defaults → framework default. All `OrchestratorOptions` fields are supported, including `allowRegressionFailures`. |
| `baselineDir` | `string` | No | Path for visual regression baseline images. Relative paths are resolved from `process.cwd()`. Defaults to `.fab-baselines/`. |

### `defaults` precedence

```
hardcoded framework default  ← lowest priority
  ↑
config.defaults
  ↑
CLI flag (e.g. --iterations 5)  ← highest priority
```

### TypeScript config requires `tsx`

When the config file is `.ts`, the CLI registers the `tsx` CJS hook at
runtime. `tsx` must be installed in your project:

```bash
npm install -D tsx
```

If you prefer to avoid the runtime dependency, compile `fabric.config.ts` to
`fabric.config.js` yourself and the CLI will load it without `tsx`.

### Supported file names (auto-discovery order)

1. `fabric.config.ts`
2. `fabric.config.js`
3. `fabric.config.mjs`
4. `fabric.config.cjs`

The file must export a `FabricConfig` object as the default export (or as the
module's sole export for CommonJS).
