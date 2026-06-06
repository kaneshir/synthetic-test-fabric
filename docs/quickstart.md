# Quickstart: Wire the framework to your app

This guide takes you from zero to a working fabric loop against your own app
in under 10 minutes. It assumes you've already run the demo successfully.

> **Before you start:** Read [prerequisites.md](./prerequisites.md). A working
> loop is not the same as an effective one. The prerequisites doc is honest about
> what each adapter requires to produce results you can act on.

---

## 1. Install + scaffold

```bash
npm install synthetic-test-fabric
npx fab init                            # writes fabric.config.ts + 8 adapter stubs
npx fab doctor                          # verify env, peer deps, writable state dir
```

`fab init` creates:

```
fabric.config.ts                         (wired with all 8 adapters)
src/adapters/MyAppAdapter.ts             (throws TODO on every required method)
src/adapters/MySimulationAdapter.ts
src/adapters/MyScoringAdapter.ts
src/adapters/MyFeedbackAdapter.ts
src/adapters/MyMemoryAdapter.ts
src/adapters/MyBrowserAdapter.ts
src/adapters/MyReporter.ts
src/adapters/MyScenarioPlanner.ts
flows/.gitkeep
```

The generated `fabric.config.ts` loads via `loadFabricConfig()` immediately —
`fab doctor` won't blow up post-init.

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

`fab doctor` will tell you exactly which optional peers are required for your
config and which are merely recommended.

---

## 2. Customize the generated stubs

Each generated adapter has TODO methods that throw with the method name:

```typescript
// src/adapters/MyAppAdapter.ts (generated)
export class MyAppAdapter implements AppAdapter {
  async seed(_iterRoot, _config) {
    throw new Error('TODO: implement MyAppAdapter.seed');
  }

  async verify(_iterRoot) {
    throw new Error('TODO: implement MyAppAdapter.verify');
  }

  // No-op methods are fine as-is for v1:
  async reset(_iterRoot) {}
  async validateEnvironment() { return { healthy: true, errors: [], warnings: [] }; }
  async importRun(_iterRoot, _dbUrl) {}
}
```

Replace the `throw new Error('TODO: ...')` lines with real implementations. See
the [adapter contract](./adapter-contract.md) for what each method must do, and
[`demo/adapters.ts`](../demo/adapters.ts) for a complete reference impl with no
external dependencies.

While you iterate, run the validator to confirm your edits still satisfy the
interface:

```bash
npx fab adapter validate src/adapters/MyAppAdapter.ts
```

The validator runs in milliseconds (no test loop) and reports any missing
required methods with line numbers.

To add another adapter (e.g. a Slack reporter):

```bash
npx fab adapter scaffold reporter --out src/adapters/MySlackReporter.ts --name MySlackReporter
```

---

## 3. Write Playwright flows

Create specs under `flows/`. Your `BrowserAdapter.runSpecs()` is responsible for
invoking Playwright and pointing it at the correct run root via environment
variables. The framework executes them in the TEST step and writes results to
`flow-results.json` in the run root.

---

## 4. Run a smoke check

```bash
npx fab smoke --keep
```

`fab smoke` runs `SEED → VERIFY → SMOKE FLOW` against your config. `--keep`
preserves the run root so you can inspect it.

A successful run prints:

```
[fab smoke] Run root: /tmp/fab-smoke-1234
[fab smoke] → SEED
[fab smoke] → VERIFY
[fab smoke] → SMOKE FLOW
[fab smoke] 0/0 passed
[fab smoke] Passed.
```

Then ask the framework what state you're in:

```bash
npx fab status
```

```
[fab status] last command: smoke @ 2026-05-10T16:00:00Z
  root: /tmp/fab-smoke-1234 (ephemeral_kept)
  phase: TEST   score: (none)
  next: fab inspect --root /tmp/fab-smoke-1234
```

`fab inspect` returns a structured summary — phase reached, score, flow results,
recent behavior events, latest screenshot:

```bash
npx fab inspect --root /tmp/fab-smoke-1234
```

---

## 5. Run the full loop

When smoke passes, scale up to the full orchestrator:

```bash
npx fab orchestrate --iterations 3 --ticks 10
```

A successful run produces:

```
[orchestrate] Iterations: 3, Ticks/iter: 10
[orchestrate] iter-001: → SEED
[orchestrate] iter-001: → VERIFY
[orchestrate] iter-001: → RUN
[orchestrate] iter-001: → ANALYZE
[orchestrate] iter-001: → GENERATE_FLOWS
[orchestrate] iter-001: → TEST
[orchestrate] iter-001: → SCORE
[orchestrate] iter-001: → FEEDBACK
[orchestrate] iter-002: ...
[orchestrate] Loop complete. Root: /tmp/fabric-loop/fabric-loop-1234
```

---

## 6. Wire CI

Use `--json` everywhere in scripts. The envelope contract is documented in
[cli-json-output.md](./cli-json-output.md):

```bash
# Run + threshold gate
npx fab orchestrate --iterations 1 --json > /tmp/run.json
npx fab check --root "$(jq -r '.runRoot' /tmp/run.json)" --threshold 8.0 --json
# exit 0 → score met threshold
# exit 1 + status="ok" + data.ok=false → tool worked, score below threshold
# exit 1 + status="error" → tool itself broke (e.g., missing fabric-score.json)
```

**Caller contract**: read both the exit code AND the envelope fields.
`status: "ok"` + `data.ok: false` is a normal domain failure with exit 1, not
an infrastructure error.

---

## 7. (Optional) Drive STF with Claude Code

Install `fab-mcp` in your Claude Code MCP config (`~/.claude/.mcp.json` or
project `.mcp.json`):

```json
{
  "mcpServers": {
    "fab": { "command": "fab-mcp" }
  }
}
```

Then ask Claude things like:

- *"Add a reporter that posts to Slack"* → scaffolds + validates an adapter for you
- *"Why is the score dropping?"* → inspects the last loop root and explains
- *"Set up STF for this product"* → walks `init → doctor → smoke` end-to-end

Full install + tool reference: [mcp-install.md](./mcp-install.md).
Trigger phrases + workflows: [docs/claude-skills/skills/stf/SKILL.md](./claude-skills/skills/stf/SKILL.md).

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

The generated stubs already implement the no-op methods — you only need to
fill in the `throw new Error('TODO: ...')` ones.

---

## Reference docs

- [overview.md](./overview.md) — what the framework does and why
- [adapter-contract.md](./adapter-contract.md) — full interface definitions
- [run-root-contract.md](./run-root-contract.md) — artifact layout and env vars
- [cli-json-output.md](./cli-json-output.md) — `--json` envelope contract for scripting
- [mcp-install.md](./mcp-install.md) — drive STF from Claude Code via `fab-mcp`
