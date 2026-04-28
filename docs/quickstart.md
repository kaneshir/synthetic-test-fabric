# Quickstart: Wire the framework to your app

This guide takes you from zero to a working fabric loop against your own app in
under 10 minutes. It assumes you have already run the demo successfully.

> **Before you start:** Read [prerequisites.md](./prerequisites.md). A working
> loop is not the same as an effective one. The prerequisites doc is honest about
> what each adapter requires to produce results you can act on.

---

## 1. Install

```bash
npm install synthetic-test-fabric
```

Peer requirements: Node.js 20+, TypeScript 5+.

**Optional — LLM-driven flow generation:**

```bash
npm install @kaneshir/lisa-mcp
```

With `@kaneshir/lisa-mcp` installed, set `LISA_LLM_PROVIDER` to activate the
agentic GENERATE_FLOWS loop. The framework spawns the MCP binary automatically
and drives a multi-turn tool-call session against your app:

```bash
# Anthropic (requires @anthropic-ai/sdk peer)
npm install @kaneshir/lisa-mcp @anthropic-ai/sdk
LISA_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... npx fab orchestrate

# OpenAI (requires openai peer)
npm install @kaneshir/lisa-mcp openai
LISA_LLM_PROVIDER=openai OPENAI_API_KEY=sk-... npx fab orchestrate

# Gemini (requires @google/generative-ai peer)
npm install @kaneshir/lisa-mcp @google/generative-ai
LISA_LLM_PROVIDER=gemini GEMINI_API_KEY=... npx fab orchestrate
```

Without `@kaneshir/lisa-mcp`, your `BrowserAdapter` supplies its own selectors
and flow generation is fully manual — this is supported and is the default.
See [docs/lisa-mcp.md](./lisa-mcp.md) for the full integration guide.

---

## 2. Implement the adapters

Create a file (e.g. `fabric/adapters.ts`) and implement the eight interfaces.
Start with stubs — the framework will call them in order and surface errors
clearly.

```typescript
import {
  AppAdapter, SimulationAdapter, ScoringAdapter, FeedbackAdapter,
  BrowserAdapter, MemoryAdapter, Reporter, ScenarioPlanner,
} from 'synthetic-test-fabric';

export class MyAppAdapter implements AppAdapter {
  async seed(iterRoot, config) { /* write mini-sim-export.json + lisa.db */ }
  async reset(iterRoot) {}
  async validateEnvironment() { return { healthy: true, errors: [], warnings: [] }; }
  async verify(iterRoot) { /* throw if aliases missing */ }
  async importRun(iterRoot, dbUrl) {}
}

// ... implement the rest
```

See `demo/adapters.ts` in this repo for a complete reference implementation
with no external dependencies.

---

## 3. Write Playwright flows

Create a `flows/` directory with Playwright specs. The framework executes them
in the TEST step and writes results to `flow-results.json` in the run root.

Your `BrowserAdapter.runSpecs()` is responsible for invoking Playwright and
pointing it at the correct run root via environment variables.

---

## 4. Wire the orchestrator

```typescript
import { FabricOrchestrator, makeLoopId } from 'synthetic-test-fabric';
import { MyAppAdapter, /* ... */ } from './fabric/adapters';

const orchestrator = new FabricOrchestrator({
  app:        new MyAppAdapter(),
  simulation: new MySimulationAdapter(),
  scoring:    new MyScoringAdapter(),
  feedback:   new MyFeedbackAdapter(),
  memory:     new MyMemoryAdapter(),
  browser:    new MyBrowserAdapter(),
  reporters:  [new ConsoleReporter()],
  planner:    new MyScenarioPlanner(),
});

await orchestrator.run({
  loopId:     makeLoopId(),
  iterations: 1,
  ticks:      5,
  liveLlm:    false,
  seekers:    2,
  employers:  1,
  employees:  1,
});
```

---

## 5. Run it

```bash
npx tsx fabric/run.ts
```

A successful first run produces:

```
[orchestrate] iter-001: → SEED
[orchestrate] iter-001: → VERIFY
[orchestrate] iter-001: → RUN
[orchestrate] iter-001: → ANALYZE
[orchestrate] iter-001: → GENERATE_FLOWS
[orchestrate] iter-001: → TEST
[orchestrate] iter-001: → SCORE
[orchestrate] iter-001: → FEEDBACK
[orchestrate] Loop complete.
```

---

## What each adapter needs to do

| Adapter | Minimum viable implementation |
|---------|-------------------------------|
| `AppAdapter.seed` | Write `mini-sim-export.json` and insert rows into `seeded_entities` in `lisa.db` |
| `AppAdapter.verify` | Read `mini-sim-export.json`, throw if empty |
| `SimulationAdapter.run` | Return `{ simulationId, ticksCompleted, behaviorEventsWritten: 0 }` |
| `ScoringAdapter.score` | Read `flow-results.json`, write `fabric-score.json` |
| `FeedbackAdapter.feedback` | Write `fabric-feedback.json` |
| `BrowserAdapter.runSpecs` | Run Playwright, write `flow-results.json` |
| `MemoryAdapter` | All methods can be no-ops for v1 |
| `Reporter` | `console.log` the score |
| `ScenarioPlanner` | Return a hardcoded `scenarioName` |

---

## Reference docs

- [overview.md](./overview.md) — what the framework does and why
- [adapter-contract.md](./adapter-contract.md) — full interface definitions
- [run-root-contract.md](./run-root-contract.md) — artifact layout and env vars
