# Synthetic Test Fabric

[![CI](https://github.com/kaneshir/synthetic-test-fabric/actions/workflows/ci.yml/badge.svg)](https://github.com/kaneshir/synthetic-test-fabric/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/synthetic-test-fabric.svg)](https://www.npmjs.com/package/synthetic-test-fabric)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**Self-improving QA infrastructure. No test maintenance. Coverage grows every run.**

---

Synthetic Test Fabric is a TypeScript framework that replaces hand-written test maintenance with a closed loop: generate synthetic users → simulate their behavior → extract observed paths → generate and execute browser flows → score results → feed findings into the next iteration.

You write adapters for your app once. The framework does the rest.

---

## See it run in 30 seconds

```bash
git clone https://github.com/kaneshir/synthetic-test-fabric
cd synthetic-test-fabric
npm install
npx playwright install chromium
npx tsx demo/run.ts
```

No external services. No API keys. Full loop against a static HTML taskboard app — completes in under 30 seconds and produces a scored report.

---

## The problem it solves

Playwright is an executor. It runs specs you wrote against state you set up manually. That model breaks when you have hundreds of flows, a changing product, and no time to write tests for every new path.

Synthetic Test Fabric inverts this: synthetic users navigate your app autonomously, their paths become the test corpus, and the corpus grows automatically. Coverage is a function of runtime, not headcount.

```
SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK → repeat
```

Each iteration, the system finds new paths, generates new specs, scores what it has, and uses that score to steer the next iteration toward gaps.

---

## Install

```bash
npm install synthetic-test-fabric
```

**Node.js 20+ · TypeScript 5+**

The packaged demo uses Playwright directly. Install `@playwright/test` when you
want to run `demo/run.ts` from the npm tarball.

Optionally add the Lisa MCP server for LLM-driven element inference in the flow generation step:

```bash
npm install @kaneshir/lisa-mcp
```

---

## Your first loop in 5 minutes

**1. Implement the eight adapter interfaces:**

```typescript
import {
  AppAdapter, SimulationAdapter, ScoringAdapter, FeedbackAdapter,
  BrowserAdapter, MemoryAdapter, Reporter, ScenarioPlanner,
} from 'synthetic-test-fabric';

// Start with stubs — the orchestrator surfaces errors at each step
export class MyAppAdapter implements AppAdapter {
  async seed(iterRoot, config)       { /* write mini-sim-export.json + lisa.db */ }
  async verify(iterRoot)             { /* throw if required aliases missing */ }
  async reset(iterRoot)              {}
  async validateEnvironment()        { return { healthy: true, errors: [], warnings: [] }; }
  async importRun(iterRoot, dbUrl)   {}
}
```

See `demo/adapters.ts` for a complete working reference — every method implemented, no external dependencies.

**2. Wire the orchestrator:**

```typescript
import { FabricOrchestrator, makeLoopId } from 'synthetic-test-fabric';

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
  loopId:                 makeLoopId(),
  iterations:             1,
  ticks:                  5,
  liveLlm:                false,
  allowRegressionFailures: false,
  seekers:                1,
  employers:              1,
  employees:              0,
});
```

**Or use the `fab` CLI with a config file:**

```typescript
// fabric.config.ts
import { FabricConfig } from 'synthetic-test-fabric';
export default {
  adapters: { app: new MyAppAdapter(), /* ... */ },
  defaults:  { iterations: 3, ticks: 10 },
} satisfies FabricConfig;
```

```bash
npx fab orchestrate          # run the full loop
npx fab smoke                # single iteration smoke check
npx fab check --root /tmp/fabric-loop/iter-001 --threshold 8  # CI score gate
```

---

## What you get out of the loop

After each iteration the framework produces a six-dimension score:

| Dimension | What it measures |
|-----------|-----------------|
| `persona_realism` | Did agents hit their stated goals? |
| `coverage_delta` | New screen paths found vs previous run |
| `fixture_health` | Seeded relationships all resolve cleanly |
| `discovery_yield` | New error outcomes discovered |
| `regression_health` | Previously passing flows still pass |
| `flow_coverage` | Playwright pass rate across all executed flows |

The score drives the next iteration — low `novelty` steers the planner toward unexplored scenarios; low `regression_health` flags regressions immediately.

---

## Advanced features

| Feature | How to use |
|---------|-----------|
| **Flakiness tracking** | `FlakinessTracker` persists per-flow failure rates; failing flows get quarantined automatically |
| **Adversarial personas** | Set `adversarial: true` in persona YAML; the agent probes validation gaps and unauthorized routes |
| **CI score gate** | `fab check --threshold 8.0` or `assertScoreThreshold(score, 8.0)` in your pipeline |
| **Slack reporting** | `SlackReporter` posts a score summary + dimension breakdown to any webhook |
| **Visual regression** | `VisualRegression.capture/compare` with pixelmatch; baselines managed via `fab baseline` |
| **HTML trend report** | `HtmlReporter` generates a self-contained report with Chart.js trend across the last 30 iterations |
| **Headless HTTP** | `ApiExecutor` records behavior events without a browser — 80× faster than Playwright for simulation |
| **LLM element inference** | `@kaneshir/lisa-mcp` peer gives BrowserAdapter AI-driven key discovery via the Lisa MCP server |
| **LLM-agnostic flow generation** | `LISA_LLM_PROVIDER=anthropic\|openai\|gemini` swaps the GENERATE_FLOWS LLM without code changes |

---

## How it relates to `@kaneshir/lisa-mcp`

`@kaneshir/lisa-mcp` is an optional peer package that ships a precompiled Lisa MCP server binary. It has two integration paths:

**Path 1 — BrowserAdapter element inference (original)**
Your `BrowserAdapter.runSpecs()` calls `buildLisaMcpCommand()`, spawns the MCP server, and lets an LLM use `lisa_explore_screen` / `lisa_tap_key` tools to discover interactive elements and generate Playwright spec steps from actual observations.

**Path 2 — Agentic loop via `LISA_LLM_PROVIDER` (v0.3.0+)**
Set `LISA_LLM_PROVIDER=anthropic|openai|gemini` and the framework automatically spawns the binary as an `AgentLoopProvider`. The LLM drives a full multi-turn tool-call loop — no custom `BrowserAdapter` wiring needed. The binary's tool list is fetched at runtime; tool calls are dispatched back via MCP `tools/call`.

```bash
# Zero-config agentic loop with OpenAI
npm install @kaneshir/lisa-mcp openai
LISA_LLM_PROVIDER=openai OPENAI_API_KEY=sk-... npx fab orchestrate

# Or Anthropic
npm install @kaneshir/lisa-mcp @anthropic-ai/sdk
LISA_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... npx fab orchestrate
```

Without `@kaneshir/lisa-mcp`: your `BrowserAdapter` supplies its own selectors — fully supported. `LISA_LLM_PROVIDER` requires it.

See [docs/lisa-mcp.md](docs/lisa-mcp.md) and [docs/env-vars.md](docs/env-vars.md) for full integration details.

---

## Documentation

| Doc | Audience | What's covered |
|-----|----------|---------------|
| [docs/prerequisites.md](docs/prerequisites.md) | Everyone | **Start here** — what STF actually requires to be effective, honest cost estimates, realistic timeline |
| [docs/testability-standard.md](docs/testability-standard.md) | Everyone | **Required self-assessment** — pass/fail checklist for all 8 adapters; determines whether your product is ready for integration |
| [docs/overview.md](docs/overview.md) | Everyone | Framework model, loop phases, adapters, lisa-mcp, scoring |
| [docs/example-walkthrough.md](docs/example-walkthrough.md) | Everyone | One full iteration, file by file — what actually gets written and why |
| [docs/quickstart.md](docs/quickstart.md) | Engineers | Step-by-step wiring guide — zero to working loop |
| [docs/architecture.md](docs/architecture.md) | Architects | Full call chain, lisa.db schema, MCP integration, feedback loop design |
| [docs/adapter-contract.md](docs/adapter-contract.md) | Engineers | Every interface, every method, with inline guidance |
| [docs/run-root-contract.md](docs/run-root-contract.md) | Engineers | Artifact layout and environment variable contract |
| [docs/persona-yaml-reference.md](docs/persona-yaml-reference.md) | QA engineers | Persona schema, pressure model, adversarial personas, examples |
| [docs/lisa-mcp.md](docs/lisa-mcp.md) | Engineers | Lisa MCP binary, MCP tools reference, showKeys, troubleshooting |
| [docs/for-qa-engineers.md](docs/for-qa-engineers.md) | QA engineers | What your job becomes, how to steer the system, writing personas |
| [docs/executive-brief.md](docs/executive-brief.md) | VPs / Directors | Offshore transcendence, ROI, strategic positioning, decision criteria |
| [docs/value-proposition.md](docs/value-proposition.md) | VPs / Directors | Business case, Gen 3 QA framing |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributors | How to contribute to the framework itself |

---

## License

MIT — see [LICENSE](LICENSE).
