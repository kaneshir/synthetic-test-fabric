# Synthetic Test Fabric

[![CI](https://github.com/kaneshir/synthetic-test-fabric/actions/workflows/ci.yml/badge.svg)](https://github.com/kaneshir/synthetic-test-fabric/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/synthetic-test-fabric.svg)](https://www.npmjs.com/package/synthetic-test-fabric)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**Self-improving QA infrastructure. No test maintenance. Coverage grows every run.**

---

Synthetic Test Fabric is a TypeScript framework that replaces hand-written test
maintenance with a closed loop: generate synthetic users → simulate their behavior →
extract observed paths → generate and execute browser flows → score results → feed
findings into the next iteration.

You write adapters for your app once. The framework does the rest.

> **New in v0.4.0** — agent-friendly surface. `fab init` scaffolds a working project
> in seconds. `fab-mcp` exposes every command as a native MCP tool so Claude Code (or
> any MCP client) can drive STF without bash + JSON parsing. See
> [What's new](#whats-new-in-v040).

---

## See it run in 30 seconds

```bash
git clone https://github.com/kaneshir/synthetic-test-fabric
cd synthetic-test-fabric
npm install
npx playwright install chromium
npx tsx demo/run.ts
```

No external services. No API keys. Full loop against a static HTML taskboard app —
completes in under 30 seconds and produces a scored report.

---

## Wire it into your product in 1 minute

```bash
npm install synthetic-test-fabric
npx fab init                            # scaffolds fabric.config.ts + 8 adapter stubs
npx fab doctor                          # verify env + peer deps are happy
npx fab adapter validate src/adapters/MyAppAdapter.ts   # check one stub against the interface
# ... edit src/adapters/*.ts to fill in the TODOs ...
npx fab smoke --keep                    # bounded smoke check; prints what worked + what didn't
npx fab status                          # "where am I?" between sessions
```

Every command has `--json` for scripts and CI gates. See [docs/cli-json-output.md](docs/cli-json-output.md).

---

## Drive it with Claude Code (or any MCP client)

`fab-mcp` is a Model Context Protocol server that exposes every `fab` command as a
native MCP tool. After `npm install synthetic-test-fabric`, add it to your MCP
config (`~/.claude/.mcp.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "fab": { "command": "fab-mcp" }
  }
}
```

Then ask Claude things like:

- *"Set up STF for this product"* → `stf_init` + `stf_doctor`
- *"Add a Slack reporter adapter"* → `stf_adapter_scaffold reporter` + edit + `stf_adapter_validate`
- *"Why did the score drop?"* → `stf_status` + `stf_inspect` against the last loop root
- *"Test the new feature"* → `stf_smoke`

Full install and tool reference: [docs/mcp-install.md](docs/mcp-install.md).
Decision tree mapping intents to commands: [CLAUDE.md](CLAUDE.md).

---

## The problem it solves

Playwright is an executor. It runs specs you wrote against state you set up manually.
That model breaks when you have hundreds of flows, a changing product, and no time
to write tests for every new path.

Synthetic Test Fabric inverts this: synthetic users navigate your app autonomously,
their paths become the test corpus, and the corpus grows automatically. Coverage is
a function of runtime, not headcount.

```
SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK → repeat
```

Each iteration the system finds new paths, generates new specs, scores what it has,
and uses that score to steer the next iteration toward gaps.

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

The score drives the next iteration — low `coverage_delta` steers the planner toward
unexplored scenarios; low `regression_health` flags regressions immediately.

---

## What's new in v0.4.0

The CLI surface a Claude Code (or similar) agent can drive end-to-end. Same engine
as v0.3.x; new ways to operate it.

| Command | What it does |
|---------|--------------|
| `fab init [--dir <path>]` | Scaffold `fabric.config.ts` + 8 adapter stubs into a target directory |
| `fab adapter scaffold <type>` | Generate one stub on demand for any of the 8 adapter types |
| `fab adapter validate <path>` | Type-check an adapter file against its target interface |
| `fab doctor [--deep]` | Pre-flight env + peer-dep health check (LLM provider SDKs, Playwright browsers, writable state dir) |
| `fab status` | Show the most recent run outcome from `~/.fab/state.json` |
| `fab inspect --root <dir>` | Structured `RunRootSummary` (phase, score, flows, recent behavior events) |
| `fab-mcp` (binary) | MCP server wrapping all 19 commands as `stf_*` tools |

Plus: `--json` envelope on every command, library exports for `scaffoldProject`,
`scaffoldAdapter`, `validateAdapter`, `runDoctor`, `inspectRunRoot`, `runFabCommand`,
`createMcpServer` — see [docs/cli-json-output.md](docs/cli-json-output.md).

Full changelog: [CHANGELOG.md](CHANGELOG.md).

---

## Advanced features

| Feature | How to use |
|---------|-----------|
| **Flakiness tracking** | `FlakinessTracker` persists per-flow failure rates; failing flows get quarantined automatically |
| **Adversarial personas** | Set `adversarial: true` in persona YAML; the agent probes validation gaps and unauthorized routes |
| **CI score gate** | `fab check --threshold 8.0 --json` — exit 1 + `data.ok: false` on threshold failure |
| **Slack reporting** | `SlackReporter` posts a score summary + dimension breakdown to any webhook |
| **Visual regression** | `VisualRegression.capture/compare` with pixelmatch; baselines managed via `fab baseline` |
| **HTML trend report** | `HtmlReporter` generates a self-contained report with Chart.js trend across the last 30 iterations |
| **Headless HTTP** | `ApiExecutor` records behavior events without a browser — 80× faster than Playwright for simulation |
| **LLM element inference** | `@kaneshir/lisa-mcp` peer gives BrowserAdapter AI-driven key discovery via the Lisa MCP server |
| **LLM-agnostic flow generation** | `LISA_LLM_PROVIDER=anthropic\|openai\|gemini` swaps the GENERATE_FLOWS LLM without code changes |

---

## How it relates to `@kaneshir/lisa-mcp`

`@kaneshir/lisa-mcp` is an optional peer package that ships a precompiled Lisa MCP
server binary. (Note: this is **separate from `fab-mcp`** — Lisa MCP drives flow
generation against your live app; `fab-mcp` exposes the `fab` CLI to your IDE agent.)
Lisa MCP has two integration paths:

**Path 1 — BrowserAdapter element inference (original)**
Your `BrowserAdapter.runSpecs()` calls `buildLisaMcpCommand()`, spawns the MCP server,
and lets an LLM use `lisa_explore_screen` / `lisa_tap_key` tools to discover
interactive elements and generate Playwright spec steps from actual observations.

**Path 2 — Agentic loop via `LISA_LLM_PROVIDER` (v0.3.0+)**
Set `LISA_LLM_PROVIDER=anthropic|openai|gemini` and the framework automatically
spawns the binary as an `AgentLoopProvider`. The LLM drives a full multi-turn
tool-call loop — no custom `BrowserAdapter` wiring needed. The binary's tool list
is fetched at runtime; tool calls are dispatched back via MCP `tools/call`.

```bash
# Zero-config agentic loop with OpenAI
npm install @kaneshir/lisa-mcp openai
LISA_LLM_PROVIDER=openai OPENAI_API_KEY=sk-... npx fab orchestrate

# Or Anthropic
npm install @kaneshir/lisa-mcp @anthropic-ai/sdk
LISA_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... npx fab orchestrate
```

Without `@kaneshir/lisa-mcp`: your `BrowserAdapter` supplies its own selectors —
fully supported. `LISA_LLM_PROVIDER` requires it.

`fab doctor` warns about missing optional peer deps and escalates to **fail** when
`LISA_LLM_PROVIDER` is set or your config references the agent loop — so you'll
catch missing pieces before the loop fails.

See [docs/lisa-mcp.md](docs/lisa-mcp.md) and [docs/env-vars.md](docs/env-vars.md)
for full integration details.

---

## Documentation

| Doc | Audience | What's covered |
|-----|----------|---------------|
| [docs/prerequisites.md](docs/prerequisites.md) | Everyone | **Start here** — what STF actually requires to be effective, honest cost estimates, realistic timeline |
| [docs/testability-standard.md](docs/testability-standard.md) | Everyone | **Required self-assessment** — pass/fail checklist for all 8 adapters; determines whether your product is ready for integration |
| [docs/overview.md](docs/overview.md) | Everyone | Framework model, loop phases, adapters, lisa-mcp, scoring |
| [docs/quickstart.md](docs/quickstart.md) | Engineers | Step-by-step wiring guide using `fab init` — zero to working loop |
| [docs/cli-json-output.md](docs/cli-json-output.md) | Engineers, agents | The `--json` envelope contract, outcome taxonomy, caller rules — read this once before scripting against `fab` |
| [docs/mcp-install.md](docs/mcp-install.md) | Engineers, agents | `fab-mcp` install + the 19 `stf_*` tools + outcome translation + timeout policy |
| [CLAUDE.md](CLAUDE.md) | Claude Code users | Decision tree mapping user intents to `fab` commands and `stf_*` MCP tools |
| [docs/example-walkthrough.md](docs/example-walkthrough.md) | Everyone | One full iteration, file by file — what actually gets written and why |
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
