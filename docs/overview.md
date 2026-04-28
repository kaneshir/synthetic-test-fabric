# Synthetic Test Fabric — Framework Overview

Synthetic Test Fabric is an autonomous QA layer that uses synthetic users,
simulation, memory, and browser automation to continuously test real workflows.

It is not plain Playwright. Playwright runs assertions. Synthetic Test Fabric
runs a closed loop: seed realistic actors → simulate their behaviour → capture
what they did → generate browser flows from observed paths → execute and score
those flows → feed results back to the next iteration. The test library grows
automatically. Coverage improves every run without human intervention.

---

## Why not just Playwright?

Playwright is an executor. It runs specs you wrote against a state you set up
manually. That works until you have hundreds of flows, a constantly changing
product, and no time to write tests for every new path.

Synthetic Test Fabric solves a different problem: it generates the test state
*and* the test flows from observed behaviour, then executes them. You write
adapters for your app once. The framework does everything else.

---

## The loop

```
SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK → repeat
```

| Step | What happens |
|------|-------------|
| SEED | Adapter creates synthetic users and state. Memory written to `lisa.db`. |
| VERIFY | Fail-closed check that seeded aliases are resolvable. |
| RUN | Simulation ticks. Agents act. Behaviour events written to `lisa.db`. |
| ANALYZE | Observed screen paths extracted from behaviour events. |
| GENERATE_FLOWS | Observed paths converted to candidate Playwright specs. With `@kaneshir/lisa-mcp`, an LLM navigates the live app to produce accurate locators. |
| TEST | Playwright executes the flows. Results written to `flow-results.json`. |
| SCORE | Six-dimensional score computed from test results and simulation data. |
| FEEDBACK | Score and findings passed to the next iteration's seed config. |

---

## Adapters

The framework knows nothing about your app. All product-specific logic lives in
adapters you implement:

| Interface | Responsibility |
|-----------|---------------|
| `AppAdapter` | Seed entities, verify state, validate environment |
| `SimulationAdapter` | Run agent ticks, export behaviour |
| `ScoringAdapter` | Compute `FabricScore` from run artifacts |
| `FeedbackAdapter` | Write `FabricFeedback` for the next iteration |
| `BrowserAdapter` | Execute Playwright flows, generate new specs |
| `MemoryAdapter` | Read/write `lisa.db` (optional — framework default is no-op) |
| `Reporter` | Publish score output (console, CI, Slack, HTML) |
| `ScenarioPlanner` | Recommend next scenario based on score |

See [adapter-contract.md](./adapter-contract.md) for interface definitions and
implementation guidance.

---

## Lisa MCP — AI-driven browser automation

`@kaneshir/lisa-mcp` is an optional peer package that ships a precompiled Lisa
MCP server binary. It is the AI engine behind the GENERATE_FLOWS step.

### What it enables

Without lisa-mcp, your `BrowserAdapter.runSpecs()` implementation must supply its
own element selectors — data-testid attributes, hard-coded locators, or any other
stable selector strategy. This works, but requires that your app has pre-labeled
every interactive element.

With lisa-mcp, the GENERATE_FLOWS step can use an LLM to:

1. Open each candidate screen in a headless browser.
2. Call `lisa_explore_screen` to discover visible element keys from the live DOM.
3. Generate `page.locator('[data-key="..."]')` calls from the actual rendered state,
   not from static analysis or hand-written maps.

This means the framework can generate working Playwright specs for *any* screen,
even screens that were added to the product after the adapters were written.

### How it fits into the framework

```
BrowserAdapter.runSpecs({ iterRoot, project, allowFailures })
  │
  ├── [optional] generate/update specs using lisa-mcp:
  │     calls buildLisaMcpCommand()     ← from @kaneshir/lisa-mcp
  │       └── returns platform-correct binary path (macOS arm64 / x64, Linux x64)
  │     spawns lisa_mcp binary as MCP server
  │     LLM uses MCP tools to navigate app:
  │       lisa_explore_screen   → returns element keys visible on current screen
  │       lisa_tap_key          → clicks element by key, returns resulting screen
  │       lisa_get_seeded_credentials → resolves entity_type → { email, password }
  │
  └── runs Playwright specs → returns BrowserRunResult
```

The framework calls only `runSpecs()` — the `BrowserAdapter` implementation
decides whether and how to use lisa-mcp internally. The lisa-mcp package only
provides the binary path and the command builder.

### Install

```bash
npm install synthetic-test-fabric
npm install @kaneshir/lisa-mcp    # optional — only needed for LLM key inference
```

### The `showKeys` contract

For the key discovery path to work, your app must surface element keys in the DOM
when `?showKeys=true` is present in the URL (or via an equivalent mechanism). The
lisa-mcp server reads these keys from the rendered page.

One implementation pattern is to render a visible label above each interactive
widget when `showKeys=true` is present. Apps that use `data-testid` attributes
work without showKeys by supplying their own `BrowserAdapter` that reads testid
attributes directly.

### Recording flows manually

lisa-mcp also powers the interactive recording workflow. When a developer navigates
the live app and says "save this flow", the Lisa MCP server records the key sequence
and writes it to `flows.yaml` as a replayable spec. This is how new flows enter the
catalog without writing Playwright code by hand.

---

## Run root

Every iteration writes its artifacts to a single directory called the run root:

```
<run-root>/
  .lisa_memory/
    lisa.db                 ← seeded entities, behaviour events, persona goals
  mini-sim-export.json      ← seeded entity list
  fabric-score.json         ← FabricScore
  fabric-feedback.json      ← FabricFeedback
  flow-results.json         ← Playwright JSON reporter output
  flow-results/             ← per-flow result files
  explorer-results/         ← explorer output
  candidate_flows.yaml      ← discovered paths (generated by ANALYZE)
```

See [run-root-contract.md](./run-root-contract.md) for the full contract.

---

## Scoring

The `FabricScore` has six dimensions:

| Dimension | What it measures |
|-----------|-----------------|
| `persona_realism` | Did agent behaviour match stated persona goals? |
| `coverage_delta` | New screen paths discovered vs previous run |
| `fixture_health` | Entity relationships internally valid after seed |
| `discovery_yield` | New error outcomes found (not known regressions) |
| `regression_health` | Known flows still passing (10 = no regressions) |
| `flow_coverage` | Playwright pass rate across all executed flows |

`overall` is a weighted average. A score below 8.0 in CI is a suggested hard gate.

When `@kaneshir/lisa-mcp` is wired, two additional dimensions are populated:

| Dimension | Source |
|-----------|--------|
| `flakiness` | `FlakinessTracker` — per-flow failure rates; quarantined flow list |
| `adversarial` | Adversarial persona probe results — violations found and top violation types |

---

## Getting started

The fastest way to see the loop run is the included demo:

```bash
git clone https://github.com/kaneshir/synthetic-test-fabric
cd synthetic-test-fabric
npm install
npx playwright install chromium
npx tsx demo/run.ts
```

From an installed npm package:

```bash
npm install synthetic-test-fabric @playwright/test
npx playwright install chromium
cp -R node_modules/synthetic-test-fabric/dist ./dist
cp -R node_modules/synthetic-test-fabric/demo ./stf-demo
npx -y tsx ./stf-demo/run.ts --allow-regression-failures
```

The demo runs against a static HTML "Taskboard" app with no external
dependencies. Full loop completes in under 30 seconds.

To add AI-driven flow generation via the Lisa MCP server:

```bash
npm install @kaneshir/lisa-mcp
```

Then call `buildLisaMcpCommand()` from your `BrowserAdapter.generateFlows()`
implementation to get the platform-correct binary path and spawn the MCP server.

See [quickstart.md](./quickstart.md) for a step-by-step guide to wiring the
framework to your own app.

---

## What stays in your product repo

- Adapter implementations (your `AppAdapter`, `BrowserAdapter`, etc.)
- Scenario catalog and persona YAML files
- `flows.yaml` and product-specific Playwright specs
- Any secrets, credentials, or environment config

The framework never sees these. It only sees the adapter interfaces.

---

## Package relationships

```
your product repo
  ├── synthetic-test-fabric   ← framework (this package)
  └── @kaneshir/lisa-mcp      ← optional: LLM-driven key inference + recording
        └── precompiled Dart binary (macOS arm64/x64, Linux x64)
            spawned as MCP server by your BrowserAdapter
```

The framework and the MCP package are fully independent. Either can be upgraded
without touching the other. The adapter seam is the only contract between them.
