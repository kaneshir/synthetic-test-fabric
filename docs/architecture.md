# Synthetic Test Fabric — Architecture

This document is written for engineers implementing the framework against a new
product, engineers maintaining the framework itself, and technical leads deciding
whether to adopt it. It covers the full loop model, every component in the call
chain, the data contracts between them, and the design decisions that made the
adapter seam real.

---

## 1. The Core Insight

Traditional test automation records what a human did and replays it. The
assumption is that the human already knows what to test. That assumption breaks
down when the product grows faster than QA coverage.

Synthetic Test Fabric inverts the problem: instead of recording human testers,
it generates synthetic users with explicit goals and lets them navigate the
product autonomously. Their paths become the test corpus. The corpus grows
continuously without a human deciding what to add.

The result is a system where **coverage is a function of runtime, not headcount**.

---

## 2. Loop Architecture

A single iteration of the fabric loop runs eight sequential phases:

```
SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK
```

Each phase is owned by one adapter. The `FabricOrchestrator` calls them in
order, writes artifacts to a per-iteration *run root* directory, and passes the
run root path to every phase. Artifacts are the only coupling between phases.

```
FabricOrchestrator
  │
  ├─ AppAdapter.seed(iterRoot)         → mini-sim-export.json, lisa.db
  ├─ AppAdapter.verify(iterRoot)       → throws if seed is incomplete
  ├─ SimulationAdapter.run(iterRoot)   → behavior_events → lisa.db
  ├─ BrowserAdapter.runSpecs(iterRoot) → flow-results.json
  ├─ ScoringAdapter.score(iterRoot)    → fabric-score.json
  └─ FeedbackAdapter.feedback(iterRoot)→ fabric-feedback.json
```

The `ScenarioPlanner` runs before SEED each iteration to select which scenario
the next seed should target. The `Reporter` is called after SCORE to emit
human-readable output.

---

## 3. Run Root Contract

Every execution gets exactly one run root. It is a directory path that all
adapters share. No adapter communicates with another adapter directly — they
read and write files in the run root.

```
<run-root>/
  .lisa_memory/
    lisa.db                  ← SQLite: seeded fixtures, behavior events, memory
  mini-sim-export.json        ← What was seeded (account data, entity IDs)
  testing-scorecard.json      ← Optional: product-specific coverage summary
  scenario-plan.json          ← Planner output: next scenario + rationale
  candidate_flows.yaml        ← Paths extracted from behavior events (ANALYZE)
  flow-results.json           ← Playwright aggregate: pass/fail per spec
  flow-results/               ← Per-spec JSON (one file per Playwright spec)
  explorer-results/           ← Optional: explorer agent outputs
  fabric-score.json           ← FabricScore: six-dimension scoring struct
  fabric-feedback.json        ← Planner feedback: what to focus on next run
```

Environment variables the orchestrator sets for subprocesses:

| Variable | Value |
|----------|-------|
| `LISA_DB_ROOT` | `<run-root>` |
| `LISA_MEMORY_DIR` | `<run-root>/.lisa_memory` |

Subprocesses (Playwright, simulation scripts, seed scripts) find `lisa.db`
via these variables, never via hardcoded paths.

---

## 4. Adapters

Eight interfaces define the seam between the framework and the product. The
framework owns the loop; the product owns the adapters.

### 4.1 AppAdapter

The heaviest adapter. Responsible for:

- **`seed(iterRoot, config)`** — Invoke the product's simulation seeding
  machinery. Write `mini-sim-export.json` containing the seeded entity IDs.
  Insert rows into `seeded_entities` in `lisa.db` using fixture aliases.
- **`verify(iterRoot)`** — Read `mini-sim-export.json` and `lisa.db`. Throw if
  any required alias is missing or any relationship is broken. This is the
  fail-closed gate that prevents the loop from running against corrupt data.
- **`reset(iterRoot)`** — Clean product-side state between iterations if
  needed (optional; most products no-op this).
- **`validateEnvironment()`** — Check that required services (database,
  emulator, LLM provider) are up before the loop starts.
- **`importRun(iterRoot, dbUrl)`** — Import any per-run config into `lisa.db`.

### 4.2 SimulationAdapter

Runs goal-driven synthetic agents against the product.

- **`run(iterRoot, config)`** — Invoke the product's agent simulation. Agents
  navigate the product, produce `behavior_events` rows in `lisa.db`, and return
  a summary: `{ simulationId, ticksCompleted, behaviorEventsWritten }`.

The simulation agents are the intelligence source. They generate the raw
behavioral signal that ANALYZE converts into test paths.

### 4.3 BrowserAdapter

One responsibility: run Playwright specs and return structured results.

- **`runSpecs({ iterRoot, project, allowFailures, grep? })`** — Invoke
  Playwright against the live app. Must write a JSON results file at
  `BrowserRunResult.resultsPath`. When `allowFailures` is true, failures must
  be returned in `BrowserRunResult.failed` rather than thrown.

The implementation may internally analyse `behavior_events`, generate new spec
files from candidate flows, or invoke the Lisa MCP server for LLM-driven key
inference — but all of that is an implementation detail hidden behind
`runSpecs`. The framework calls only `runSpecs`.

### 4.4 ScoringAdapter

Reads `flow-results.json` after the TEST phase and produces a `FabricScore`:

```typescript
interface FabricScore {
  iterationId:    string;
  timestamp:      string;
  overallScore:   number;          // 0–100
  dimensions: {
    coverage:      DimensionScore; // paths tested / paths known
    reliability:   DimensionScore; // pass rate across flows
    novelty:       DimensionScore; // new paths discovered this iteration
    regression:    DimensionScore; // regressions vs previous iteration
    depth:         DimensionScore; // average steps per flow
    breadth:       DimensionScore; // unique screens exercised
  };
  regressions:    RegressionEvent[];
  newPaths:       string[];
  summary:        string;
}
```

The score is the single number the loop optimizes toward. Every adapter change
that affects it creates a measurable signal.

### 4.5 FeedbackAdapter

Reads `fabric-score.json` and writes `fabric-feedback.json` — a structured
recommendation for what the next iteration should focus on. The `ScenarioPlanner`
reads this when selecting the next scenario.

### 4.6 MemoryAdapter

Manages the `lisa.db` schema across iterations. Most products implement this
as a no-op for v1 — the orchestrator handles schema migrations via
`applyLisaDbMigrations`.

### 4.7 Reporter

Called after SCORE each iteration. Receives the `FabricScore` and iteration
metadata. Default: `ConsoleReporter` writes a human-readable summary to stdout.
Pluggable: teams wire CI reporters, Slack webhooks, or dashboards here.

### 4.8 ScenarioPlanner

Called before SEED each iteration. Returns the scenario name to pass to
`AppAdapter.seed`. The feedback loop runs through this: FEEDBACK writes
recommendations, PLANNER reads them, SEED targets the recommended coverage gap.

---

## 5. lisa.db Schema

SQLite. The schema ships with the framework and is applied via
`applyLisaDbMigrations(dbPath)` before the loop starts.

Key tables:

| Table | Purpose |
|-------|---------|
| `seeded_entities` | Fixture registry. Columns: `entity_type`, `entity_id`, `data`, `auth_email`, `auth_password`. |
| `behavior_events` | Raw events from simulation agents: `screen`, `action`, `metadata`, `tick`. |
| `screen_paths` | Extracted paths (from ANALYZE). Each row is a traversal sequence. |
| `flow_results` | Imported from `flow-results.json` after TEST. |
| `memory_entries` | Key/value store for inter-iteration state (MemoryAdapter). |

The `seeded_entities` table is the fixture identity contract. Every Playwright
spec resolves its test credentials by querying this table by `entity_type` — never by
row number, never by hardcoded ID.

```typescript
// Inside a Playwright spec — correct pattern
const row = db.prepare(
  "SELECT entity_id, auth_email, auth_password FROM seeded_entities WHERE entity_type = ?"
).get("seeker_account");
```

---

## 6. Persona and Simulation Agent Design

Synthetic users are not random clickers. Each persona has:

```typescript
interface PersonaDefinition {
  id:          string;
  role:        string;           // maps to product role (seeker, employer, etc.)
  goals:       string[];         // what they are trying to accomplish
  constraints: string[];         // what limits their behaviour
  pressure:    'low' | 'medium' | 'high';  // urgency modifier
  traits:      Record<string, string>;     // freeform personality modifiers
}
```

The simulation adapter receives the persona definition and drives the agent
through the product. With an LLM backend, the agent makes decisions by
reasoning against the persona's goals and constraints. With a deterministic
backend, the persona maps to a scripted behaviour tree.

**Why pressure matters**: A persona with `pressure: 'high'` skips optional
steps, ignores secondary flows, and goes directly for the goal. A persona with
`pressure: 'low'` explores — it clicks links, reads help text, visits profile
pages. The combination of pressure levels across a multi-persona run produces
natural coverage variance without scripting it explicitly.

---

## 7. Screen Path Extraction (ANALYZE)

After simulation, `behavior_events` rows in `lisa.db` contain a sequence of
`(screen, action)` pairs for each agent. The ANALYZE phase:

1. Reconstructs per-agent traversal sequences from the event log.
2. Deduplicates: paths already in `flows.yaml` are skipped.
3. Applies novelty filters: paths shorter than a minimum depth are skipped.
4. Writes `candidate_flows.yaml` — the set of new paths for this iteration.

The LLM-backed analyzer (optional) reads the event log and generates natural
language descriptions of each path alongside the machine-readable form. These
descriptions seed the `generateFlows` step with enough context to produce
meaningful Playwright spec names and assertions.

---

## 8. Flow Generation (GENERATE_FLOWS)

`candidate_flows.yaml` contains paths but not selectors. The `generateFlows`
adapter is responsible for the translation. Two approaches:

**Key-based (preferred)**: The product surfaces stable widget/element keys in
the DOM or accessibility tree. The adapter maps path steps to key lookups.
For example, `showKeys=true` can render key labels, and the adapter can generate
`page.locator('[data-key="X"]')` calls from those stable identifiers.

**Selector inference (fallback)**: The adapter opens each screen in a headless
browser and uses the LLM to identify the most stable selector for each
interaction. More expensive, less stable.

Generated specs are written to the product's `flows/` directory. They are
normal Playwright specs — the framework does not invent a new test DSL.

---

## 9. Scoring Dimensions

`FabricScore` has six dimensions, each scored 0–100:

| Dimension | Measures | Signal When Low |
|-----------|----------|----------------|
| `coverage` | Paths tested vs paths known | Test library is stale; simulation found new paths but specs don't cover them |
| `reliability` | Pass rate across all flows | Existing coverage is breaking |
| `novelty` | New paths discovered this iteration | Simulation is not finding new behaviour; personas may be too narrow |
| `regression` | Failures in previously passing flows | Something broke that used to work |
| `depth` | Average steps per flow | Flows are shallow; surface area covered but depth not |
| `breadth` | Unique screens exercised | Coverage is concentrated in a small part of the product |

The `overallScore` is a weighted combination. The weights are configurable per
product — a stability-focused product might weight `regression` heavily; an
early-stage product might weight `novelty` and `breadth`.

---

## 10. The Feedback Loop

This is what makes the system self-improving:

```
iteration N:
  SCORE produces FabricScore{ novelty: 12, coverage: 43, breadth: 31 }

  FEEDBACK reads score → writes fabric-feedback.json:
    "novelty is low — personas are converging on the same paths.
     Recommend increasing pressure variance and targeting the
     'offer negotiation' scenario which has zero coverage."

iteration N+1:
  PLANNER reads fabric-feedback.json → returns scenario = "offer_negotiation"
  SEED runs with offer_negotiation scenario
  ANALYZE finds 4 new paths
  novelty score rises
```

The loop has no human in it. A human wrote the initial scenario catalog; the
system decides which scenarios to run based on what the previous run revealed.

---

## 11. Adapter Isolation Proof

The framework core is deliberately separated from application code. Product
implementations live behind the adapter interfaces, so the same orchestrator,
schema, scoring model, and CLI can run against a static demo app or a real
application without importing product-specific modules.

The adapter seam is the architectural proof that the framework is genuinely
product-neutral.

Implementing the adapters for a new product takes 3–5 days of engineering work.
The framework's `demo/` directory contains a complete reference implementation
against a static HTML app with no external dependencies — a known-good baseline
to diff against when debugging a new adapter.

---

## 12. Lisa MCP Integration

`@kaneshir/lisa-mcp` is the optional AI layer that powers LLM-driven flow
generation and interactive recording. Understanding where it sits in the
architecture is important for adapter implementors.

### What it is

`@kaneshir/lisa-mcp` ships a precompiled Dart binary (`lisa_mcp`) packaged
for three platforms. The binary implements an MCP (Model Context Protocol)
server: it listens on stdio, accepts JSON-RPC tool calls, and returns
structured results from the live browser.

```
@kaneshir/lisa-mcp/
  bin/
    lisa_mcp-macos-arm64   ← dart compile exe output (private source in dev-infra)
    lisa_mcp-macos-x64
    lisa_mcp-linux-x64
  index.js                 ← buildLisaMcpCommand() — picks binary for current platform
  index.d.ts
```

Source is private. Only the compiled binaries ship. The MCP protocol is the
stable interface — the framework never depends on lisa-mcp internals.

### MCP tools exposed by the server

| Tool | What it does |
|------|-------------|
| `lisa_orchestrate` | Session entry point — maintains workflow state, tells Claude what to do next |
| `lisa_setup` | Loads flows and seeded entities into session state |
| `lisa_explore` | PRIMARY: parses KEYS_JSON from console, returns keys + screen state + actions |
| `lisa_keys` | Stores and retrieves widget keys across calls (store / get / stats) |
| `lisa_action` | Builds click and type Chrome commands from a widget key |
| `lisa_get_seeded` | Returns seeded entities (accounts, jobs, etc.) with auth credentials |
| `lisa_flow` | Lists flows, saves new flows, reports session progress |
| `lisa_run_flow` | Starts and completes flow execution (start / complete / check) |
| `lisa_analyze` | Compound health check — database, cache, keys, metrics |
| `lisa_record` | Recording session — start, capture events, stop, export as flow |
| `lisa_codegen` | Generates test code and Dart integration tests from flows |
| `lisa_batch` | Runs multiple tool calls in parallel |

The full tool manifest with input/output schemas is in [docs/mcp-tool-contract.md](./mcp-tool-contract.md).
These tools give an LLM everything it needs to navigate a live app, discover
element keys, and produce accurate Playwright locators — without hand-labeling
selectors in advance.

### Integration point: inside `BrowserAdapter.runSpecs()`

The lisa-mcp server is consumed inside your `BrowserAdapter.runSpecs()`
implementation — the framework calls only `runSpecs()` and does not know about
MCP. A typical implementation pattern:

```
BrowserAdapter.runSpecs({ iterRoot, project, allowFailures })
  │
  ├── [optional] generate/update spec files using lisa-mcp:
  │     import { buildLisaMcpCommand } from '@kaneshir/lisa-mcp'
  │       → returns { cmd: string, args: string[] } for current platform
  │     spawn child process → MCP server listening on stdio
  │     send MCP tool calls over stdio JSON-RPC:
  │       lisa_explore({ screen, console_output })   → keys + state + actions
  │       lisa_get_seeded({ entity_type: "seeker_account" })
  │       lisa_action({ action: "click", screen, key: "submit_button" })
  │     assemble Playwright spec steps from tool responses
  │
  └── run Playwright against the live app → write BrowserRunResult.resultsPath
```

The `lisa.db` path is passed to the MCP server via the `LISA_MEMORY_DIR`
environment variable (set to `<iterRoot>/.lisa_memory`). `lisa_get_seeded`
reads from this database to resolve fixture data into real credentials without
any hardcoded values in the generated specs. The framework also sets
`LISA_DB_ROOT` (pointing at `iterRoot`) for legacy Playwright subprocess
compatibility — but `LISA_MEMORY_DIR` is the MCP server's env contract.

### The `showKeys` contract

For key discovery to work, the app must surface element keys in the rendered DOM.
The convention: add `?showKeys=true` to the URL and the app renders a `data-key`
attribute (or visible label) on each interactive element.

```
URL:  http://localhost:5002/app/?showKeys=true#/login
DOM:  <input data-key="login_email_input" type="email" />
```

`lisa_explore` reads `KEYS_JSON` console output from the app and stores the keys. Apps that implement this contract
get accurate, stable locators in generated specs. Apps that use `data-testid`
attributes work without showKeys by implementing a `BrowserAdapter` that reads
testid attributes directly — no MCP call required.

### Interactive recording

Beyond automated flow generation, lisa-mcp also powers the interactive recording
workflow:

```
developer navigates live app
  → lisa-mcp MCP server records key sequence
  → writes to flows.yaml as a replayable spec
  → developer says "save" → spec committed
```

This is how new flows enter the catalog without writing Playwright code by hand.
The recorded flows are normal Playwright specs — the framework plays them back
identically in the TEST phase.

### When you don't need it

`@kaneshir/lisa-mcp` is not required. Products can implement `BrowserAdapter`
with any stable selector strategy:

- `data-testid` attributes → no MCP needed
- Accessibility labels → no MCP needed
- Pre-written spec files → `runSpecs` plays them back unchanged

Install it only when you want LLM-driven key inference or interactive recording.

---

## 13. Two Independent Swap Axes

The stack has two orthogonal abstraction seams. They were designed this way deliberately — neither is an afterthought.

```
┌─────────────────────────────────────────────────────────────────┐
│                   synthetic-test-fabric                          │
│                                                                  │
│  GENERATE_FLOWS                                                  │
│    │                                                             │
│    ├── Seam 1: LlmProvider ──────────────────────────────────── │─── swap the brain
│    │     ClaudeCliProvider (default, zero-config)                │
│    │     ClaudeSdkProvider (ANTHROPIC_API_KEY)                   │
│    │     OpenAIProvider (OPENAI_API_KEY)                         │
│    │     GeminiProvider (GEMINI_API_KEY)                         │
│    │     AgentLoopProvider (LISA_LLM_PROVIDER + lisa-mcp)        │
│    │     custom: { id, complete(prompt) }                        │
│    │                                                             │
│    └── Seam 2: MCP binary ───────────────────────────────────── │─── swap the tools
│          @kaneshir/lisa-mcp (default)                            │
│          any binary: MCP stdio JSON-RPC + same tool contracts    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Seam 1 — the LLM provider** is the `LlmProvider` interface: `id: string` plus `complete(prompt): Promise<string>`. The framework calls nothing else. Switch providers by:
- setting `LISA_LLM_PROVIDER` (zero code change)
- passing `llmProvider` to `OrchestratorOptions` (one line change)
- implementing `{ id, complete }` to wrap any model

The provider has no knowledge of the MCP binary. It receives a fully-formed text prompt and returns a string.

**Seam 2 — the MCP binary** is the MCP stdio JSON-RPC protocol plus the tool name contracts (`lisa_explore`, `lisa_action`, `lisa_get_seeded`, etc.). The framework calls `tools/list` to discover what the server offers, then `tools/call` to invoke them. What's inside the binary is opaque — the framework depends on the protocol and the tool schemas, not the implementation.

Swap the binary by:
- passing `command: { cmd, args }` to `McpClient` (or `createMcpClient`) directly
- supplying a custom `mcpClientFactory` to `AgentLoopProvider` that spawns any MCP-compatible process

The binary has no knowledge of which LLM is on the other side.

**The two seams are independent.** You can run `LISA_LLM_PROVIDER=openai` against the default lisa-mcp binary. You can run a different MCP binary with the default `ClaudeCliProvider`. You can swap both simultaneously. Neither swap requires touching the other layer or any adapter code.

This is what makes the architecture extensible without being a framework: the product's adapter implementations are stable across LLM generations and across QA intelligence versions. The loop doesn't change. The scoring doesn't change. Only the two swap points need updating when a better model ships or the MCP intelligence improves.

## 14. Dependency Map

```
synthetic-test-fabric (this package)
  ├── better-sqlite3         ← lisa.db read/write
  ├── commander              ← fab CLI
  ├── js-yaml                ← flows.yaml, candidate_flows.yaml
  ├── pixelmatch + pngjs     ← VisualRegression pixel diff
  ├── zod                    ← persona YAML validation
  └── @playwright/test (peer) ← packaged demo flows

Product adapter
  ├── synthetic-test-fabric  ← FabricOrchestrator, adapter interfaces, fab CLI
  ├── @playwright/test       ← if the adapter runs Playwright specs
  ├── @kaneshir/lisa-mcp     ← optional: LLM key inference + recording
  └── product-specific deps  ← app SDKs, auth clients, simulation engine, etc.

@kaneshir/lisa-mcp
  └── precompiled binary
        platform detection:  macos-arm64 | macos-x64 | linux-x64
        protocol:            MCP over stdio JSON-RPC
        reads:               LISA_MEMORY_DIR env var → <LISA_MEMORY_DIR>/lisa.db
```

The `@kaneshir/lisa-mcp` package and `synthetic-test-fabric` are fully
independent. Either can be upgraded without touching the other. The only
contract between them is: the framework sets `LISA_MEMORY_DIR`; the MCP server
reads it. (`LISA_DB_ROOT` is also set by the framework for legacy Playwright
subprocess compatibility but is not the MCP server's contract.)

---

## 15. What the Framework Does Not Own

- The product's simulation engine (how synthetic users are created and seeded)
- The product's fixture alias conventions
- The product's scenario catalog
- The Lisa MCP server (`@kaneshir/lisa-mcp` — separate private package)
- Playwright configuration (each product's `playwright.config.ts` sets `baseURL`, auth, timeouts)

The framework owns the loop, the schema, the scoring model, and the adapter
interfaces. Everything product-specific lives in the product's adapter
implementations.

---

## 16. Reference

| File | What it defines |
|------|----------------|
| `src/orchestrator.ts` | `FabricOrchestrator`, `makeLoopId`, loop state machine |
| `src/adapters.ts` | All eight adapter interfaces |
| `src/schema.ts` | `FabricScore`, `PersonaDefinition`, `BehaviorEvent`, `SeededEntity` |
| `src/run-root.ts` | `applyLisaDbMigrations`, `resolveRunRoot` |
| `src/score.ts` | Scoring dimension calculation |
| `src/screen-path.ts` | Screen path extraction from behavior events |
| `src/persona.ts` | Persona seeding and pressure modifiers |
| `demo/adapters.ts` | Reference implementation (no external deps) |
| `docs/adapter-contract.md` | Full interface definitions with inline docs |
| `docs/run-root-contract.md` | Artifact layout, env vars, lifecycle |
| `docs/quickstart.md` | Step-by-step wiring guide |
| `docs/example-walkthrough.md` | Full iteration end-to-end with file contents |
| `docs/lisa-mcp.md` | Lisa MCP binary, MCP tools, showKeys, troubleshooting |
| `docs/persona-yaml-reference.md` | Persona YAML schema, pressure model, adversarial personas |
| `docs/for-qa-engineers.md` | Sr QA engineer guide — steering the system, writing personas |
| `docs/executive-brief.md` | VP/Director brief — offshore transcendence, ROI, decision criteria |
