# Environment Variables

All environment variables the framework or adapters interact with, classified
by ownership.

---

## Framework reads from `process.env`

These are read directly by the orchestrator or recorder. You do not need to
set them before calling `orchestrator.run()` — they are optional unless noted.

| Variable | Required | Read by | Effect if missing |
|----------|----------|---------|-------------------|
| `LISA_LLM_PROVIDER` | No | `resolveProvider()` (GENERATE_FLOWS) | Falls through to Claude CLI / API-key auto-detection |
| `ANTHROPIC_API_KEY` | No | `resolveProvider()` (GENERATE_FLOWS) | Falls through to next provider in auto-detection order |
| `OPENAI_API_KEY` | No | `resolveProvider()` (GENERATE_FLOWS) | Falls through to next provider in auto-detection order |
| `GEMINI_API_KEY` | No | `resolveProvider()` (GENERATE_FLOWS) | Falls through to next provider in auto-detection order |
| `OLLAMA_HOST` | No | `OllamaProvider` | Defaults to `http://localhost:11434` |
| `STF_DISABLE_CLAUDE_CLI` | No | `resolveProvider()` | Set to `1` to skip Claude CLI auto-detection |
| `LISA_SIMULATION_ID` | CLI helper only | `requireSimulationId()` in `run-root.ts` | CLI commands that need the current simulation ID read it here; recorder does not read this var |

### GENERATE_FLOWS provider auto-detection

When no `llmProvider` is set in `OrchestratorOptions`, the framework probes
for a provider in this order:

1. **`LISA_LLM_PROVIDER` set** → `AgentLoopProvider` wrapping the matching
   `ToolCallingLlmProvider` adapter (Anthropic, OpenAI, or Gemini). The loop
   spawns the `@kaneshir/lisa-mcp` binary and drives it via real tool calls.
   See [`LISA_LLM_PROVIDER`](#lisa_llm_provider) below.
2. `flowModel` starts with `'ollama:'` → `OllamaProvider`
3. `flowModel` set to any other string → `GeminiProvider` (legacy)
4. `claude` CLI in PATH **and** `STF_DISABLE_CLAUDE_CLI` unset → `ClaudeCliProvider`
   (uses your Claude.ai subscription — no API key needed)
5. `ANTHROPIC_API_KEY` set → `ClaudeSdkProvider`
6. `OPENAI_API_KEY` set → `OpenAIProvider`
7. `GEMINI_API_KEY` set → `GeminiProvider`
8. None → GENERATE_FLOWS skipped (non-fatal; TEST phase runs normally)

### `LISA_LLM_PROVIDER`

Activates the **agentic tool-call loop** for GENERATE_FLOWS. When set, the
framework instantiates an `AgentLoopProvider` that spawns the
`@kaneshir/lisa-mcp` binary, fetches its tool list, and drives a multi-turn
conversation with the selected LLM — routing tool calls back to the binary
rather than using a simple `complete()` prompt.

**Valid values:**

| Value | SDK used | Peer dep required |
|-------|----------|-------------------|
| `anthropic` or `claude` | `@anthropic-ai/sdk` | `npm install @anthropic-ai/sdk` |
| `openai` | `openai` | `npm install openai` |
| `gemini` | `@google/generative-ai` | `npm install @google/generative-ai` |

The corresponding API key env var must also be set (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `GEMINI_API_KEY`).

**`@kaneshir/lisa-mcp` is required** when `LISA_LLM_PROVIDER` is set — the
agentic loop spawns the binary on every `complete()` call:

```bash
npm install @kaneshir/lisa-mcp
```

**Quick start:**

```bash
LISA_LLM_PROVIDER=openai OPENAI_API_KEY=sk-... npx fab orchestrate
LISA_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... npx fab orchestrate
LISA_LLM_PROVIDER=gemini GEMINI_API_KEY=... npx fab orchestrate
```

When unset, the framework falls through to Claude CLI / API-key auto-detection
(steps 4–8 above). The Claude CLI path is the zero-config default for most
users.

### `ANTHROPIC_API_KEY`

Enables `ClaudeSdkProvider` (step 5 fallback) or `AnthropicToolCallingProvider`
(when `LISA_LLM_PROVIDER=anthropic`). Get a key from
[console.anthropic.com](https://console.anthropic.com).

### `OPENAI_API_KEY`

Enables `OpenAIProvider` (covers GPT-4o, o3, Codex) — used when no
`llmProvider` is set, neither Claude provider is available, and this key is
present.

### `GEMINI_API_KEY`

Enables `GeminiProvider` — now step 4 in auto-detection (demoted from the
previous default). Still triggered by `flowModel: 'gemini-1.5-pro'` (step 3
in resolution, before env-var auto-detection).

**Migration note:** if you previously relied on `GEMINI_API_KEY` being
auto-detected with no `flowModel`, add `flowModel: 'gemini-1.5-pro'` to keep
the old behaviour, or set `STF_DISABLE_CLAUDE_CLI=1` so the framework falls
through to step 4.

### `STF_DISABLE_CLAUDE_CLI`

Set to `1` to skip Claude CLI auto-detection (step 1). Useful in CI
environments where the `claude` CLI is installed but you want a specific
API-key-based provider:

```bash
STF_DISABLE_CLAUDE_CLI=1 ANTHROPIC_API_KEY=sk-ant-... npx fab orchestrate
```

### `OLLAMA_HOST`

Base URL for local Ollama. Read by `OllamaProvider`. Defaults to
`http://localhost:11434` when unset. Override if your Ollama instance runs
on a non-default port or remote host:

```bash
OLLAMA_HOST=http://10.0.0.5:11434
```

### `LISA_SIMULATION_ID`

An exported helper, `requireSimulationId()` from `run-root.ts`, reads this
variable. It is available for consumers who need to pass the current simulation
ID between processes (e.g. a script that seeds then runs Playwright separately).
It is not called by the framework or CLI internally.

**The recorder does not read this variable.** `BehaviorEventRecorder` reads
`input.simulation_id` directly from each `RecorderInput` object passed to
`record()`. To avoid dropped events, pass `simulation_id` explicitly on every
call:

```typescript
recorder.record({
  simulation_id: options.simulationId,  // pass this — env var is not read
  ...
});
```

See [schema-reference.md](./schema-reference.md#behavioreventrecorder-api).

---

## Adapter must set when spawning subprocesses

The orchestrator does **not** inject these into subprocess environments. It
passes `iterRoot` as a function argument to adapters; adapters are responsible
for injecting these variables when spawning child processes.

| Variable | Value to set | Used by |
|----------|-------------|---------|
| `LISA_DB_ROOT` | `iterRoot` | Any subprocess that opens `lisa.db` |
| `LISA_MEMORY_DIR` | `path.join(iterRoot, '.lisa_memory')` | Any subprocess that reads the memory directory |

```typescript
// In your BrowserAdapter.runSpecs() or SimulationAdapter.run():
execFileSync('./my-binary', args, {
  env: {
    ...process.env,
    LISA_DB_ROOT:    iterRoot,
    LISA_MEMORY_DIR: path.join(iterRoot, '.lisa_memory'),
  },
});
```

Forgetting to set these is the most common wiring mistake. A subprocess that
opens `lisa.db` without `LISA_MEMORY_DIR` will either fail or create the
database at the wrong path.

---

## Demo-only variables

These are set internally by the demo adapter implementations. They are not
part of the framework contract and have no meaning outside the demo.

| Variable | Set by | Purpose |
|----------|--------|---------|
| `PLAYWRIGHT_JSON_OUTPUT_NAME` | `DemoBrowserAdapter` | Tells Playwright where to write the JSON results file |
| `DEMO_APP_DIR` | `DemoBrowserAdapter` | Path to the demo static HTML app |
| `GENERATED_FLOWS_DIR` | `DemoBrowserAdapter` | Path to generated spec output directory |

---

## Your product adapter variables

These are not defined by the framework. Document them in your own adapter
configuration. Common patterns:

```bash
# Service URLs
APP_URL=http://localhost:3000
SIM_SERVICE_URL=http://localhost:8080

# Credentials
APP_API_KEY=your-admin-key
DATABASE_URL=postgres://user:pass@localhost:5432/myapp

# Feature flags
LIVE_LLM=false
```

Your `AppAdapter.validateEnvironment()` is the right place to check for
required product vars and return clear errors when they are missing:

```typescript
async validateEnvironment(): Promise<AppHealthResult> {
  const errors: string[] = [];
  if (!process.env.APP_URL)    errors.push('APP_URL is not set');
  if (!process.env.APP_API_KEY) errors.push('APP_API_KEY is not set');
  return { healthy: errors.length === 0, errors, warnings: [] };
}
```
