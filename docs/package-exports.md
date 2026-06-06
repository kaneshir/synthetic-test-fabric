# Package Exports Reference

Everything exported from `synthetic-test-fabric`. Grouped by category.

**Stability tiers:**
- **Stable** — public API; follows semver; safe to depend on
- **Experimental** — available but may change in minor versions; noted where applicable

---

## Core loop

| Export | Kind | Description |
|--------|------|-------------|
| `FabricOrchestrator` | class | Runs the SEED→VERIFY→RUN→ANALYZE→GENERATE_FLOWS→TEST→SCORE→FEEDBACK→IMPORT loop. Accepts `OrchestratorAdapters`. Call `run(options)` to start. |
| `OrchestratorOptions` | type | Options for `orchestrator.run()`. See `docs/orchestrator-reference.md`. |
| `OrchestratorAdapters` | type | All eight adapter slot types assembled as one object. |
| `FabricConfig` | type | Shape of `fabric.config.ts` — adapters + defaults + baselineDir. See `docs/orchestrator-reference.md`. |

---

## LLM providers

Used by the GENERATE_FLOWS phase. See `docs/env-vars.md` for the full resolution order and `LISA_LLM_PROVIDER` usage.

### Simple providers — `complete(prompt): Promise<string>`

| Export | Kind | Description |
|--------|------|-------------|
| `LlmProvider` | type | Interface: `id: string` + `complete(prompt, opts?): Promise<string>`. |
| `ClaudeCliProvider` | class | Spawns `claude -p` subprocess. Uses Claude.ai subscription — no API key needed. Zero-config default when `claude` is in PATH. |
| `ClaudeSdkProvider` | class | Calls Anthropic API via `@anthropic-ai/sdk`. Requires `ANTHROPIC_API_KEY` or explicit `apiKey`. Peer dep: `npm install @anthropic-ai/sdk`. |
| `GeminiProvider` | class | Calls Google Generative AI via `@google/generative-ai`. Requires `GEMINI_API_KEY`. Peer dep: `npm install @google/generative-ai`. |
| `OllamaProvider` | class | Calls local Ollama HTTP API. No API key. Reads `OLLAMA_HOST` (default: `http://localhost:11434`). |
| `OpenAIProvider` | class | Calls OpenAI API via `openai` package. Covers GPT-4o, o3, Codex. Requires `OPENAI_API_KEY`. Peer dep: `npm install openai`. |
| `claudeCliAvailable` | function | `() => boolean`. Returns true if `claude` is in PATH. |
| `DEFAULT_CLAUDE_SDK_MODEL` | const | Default model string for `ClaudeSdkProvider`. |
| `DEFAULT_GEMINI_MODEL` | const | Default model string for `GeminiProvider` (`'gemini-1.5-pro'`). |

### Agentic tool-call loop (v0.3.0+)

Activated by `LISA_LLM_PROVIDER`. Requires `@kaneshir/lisa-mcp`.

| Export | Kind | Description |
|--------|------|-------------|
| `AgentLoopProvider` | class | Implements `LlmProvider` via multi-turn tool-call loop. Constructor: `(toolProvider: ToolCallingLlmProvider, mcpClientFactory: () => McpClient, opts?)`. Each `complete()` call creates a fresh `McpClient`, fetches tools, drives the LLM ↔ MCP loop until a text response or `maxIterations` (default 10), then closes the client. |
| `ToolCallingLlmProvider` | type | Interface for SDK-level tool calling: `{ id: string; chat({ messages, tools, options? }): Promise<ChatResponse> }`. |
| `AnthropicToolCallingProvider` | class | Wraps `@anthropic-ai/sdk`. Formats tools as `input_schema`, parses `tool_use` blocks, serializes second-turn results as `tool_result` content blocks. |
| `OpenAIToolCallingProvider` | class | Wraps `openai`. Formats tools as `type:function`, parses `tool_calls`, serializes second-turn results as `role:tool` messages. |
| `GeminiToolCallingProvider` | class | Wraps `@google/generative-ai`. Uses camelCase `functionDeclarations`, parses `functionCall` parts (positional IDs `gemini-call-N`), serializes results as `functionResponse` parts with the original function name resolved from the preceding assistant turn. |

### Supporting types (tool-call loop)

| Export | Kind | Description |
|--------|------|-------------|
| `ToolDefinition` | type | `{ name, description, parameters }` — neutral tool schema passed to `chat()`. |
| `ToolCall` | type | `{ id, name, args }` — a tool call returned by the LLM. |
| `ToolResult` | type | `{ toolCallId, content }` — result injected back into the conversation. |
| `Message` | type | Union of user, assistant (with optional `toolCalls`), and tool-result turns. |
| `ChatResponse` | type | `{ content?, toolCalls? }` — response from `chat()`. |

### Provider resolution

| Export | Kind | Description |
|--------|------|-------------|
| `resolveProvider` | function | `(flowModel?, llmProvider?, { iterRoot? }?) => LlmProvider \| undefined`. Runs the 9-step resolution order including `LISA_LLM_PROVIDER`. |

---

## MCP client

Used internally by `AgentLoopProvider`. Exported for consumers who need to
spawn and communicate with an MCP server directly (e.g. from a custom
`BrowserAdapter`).

| Export | Kind | Description |
|--------|------|-------------|
| `McpClient` | class | Spawns an MCP server binary over stdio and communicates via JSON-RPC. Call `await spawn()` before using `getTools()` or `callTool(name, args)`. Call `close()` when done to kill the child process. |
| `createMcpClient` | function | `(iterRoot: string, opts?: Omit<McpClientOptions, 'memoryDir'>) => McpClient`. Convenience factory — derives `memoryDir` as `<iterRoot>/.lisa_memory`. |
| `McpClientOptions` | type | `{ memoryDir: string; appUrl?: string; command?: { cmd: string; args: string[] }; timeoutMs?: number }`. `command` overrides the default binary; omit to use `@kaneshir/lisa-mcp` auto-detection. |
| `McpTool` | type | `{ name: string; description: string; inputSchema: Record<string, unknown> }` — one entry from `tools/list`. |
| `McpCallResult` | type | `{ content: Array<{ type: string; text?: string }>; isError?: boolean }` — response from `tools/call`. |

**Example — call lisa-mcp directly from a BrowserAdapter:**

```typescript
import { createMcpClient } from 'synthetic-test-fabric';
import { buildLisaMcpCommand } from '@kaneshir/lisa-mcp';

const { cmd, args } = buildLisaMcpCommand();
// createMcpClient derives memoryDir from iterRoot + '/.lisa_memory'
const client = createMcpClient(iterRoot, {
  appUrl: 'http://localhost:5002',
  command: { cmd, args },
});

await client.spawn(); // must call before getTools() / callTool()
try {
  const tools = await client.getTools();
  const result = await client.callTool('lisa_health', {});
  console.log(result.content[0]?.text); // '{"status":"ok"}'
} finally {
  client.close();
}
```

---

## Adapter interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `AppAdapter` | type | Seed, verify, reset, validateEnvironment |
| `SimulationAdapter` | type | run, exportEntities, clean |
| `ScoringAdapter` | type | score |
| `FeedbackAdapter` | type | feedback |
| `MemoryAdapter` | type | migrate, writeEvent, resolveEntity, listEntities |
| `BrowserAdapter` | type | runSpecs |
| `Reporter` | type | report |
| `ScenarioPlanner` | type | plan |

See `docs/adapter-contract.md` for full method signatures and contracts.

---

## Adapter data types

| Export | Kind | Description |
|--------|------|-------------|
| `SeededEntity` | type | Entity returned by `AppAdapter.seed()` — `{ alias: string; id: string; type: string; credentials?: { email, password }; meta?: Record<string, unknown> }` |
| `AppHealthResult` | type | Returned by `AppAdapter.validateEnvironment()` — `{ healthy: boolean; errors: string[]; warnings: string[] }` |
| `SimulationRunResult` | type | Returned by `SimulationAdapter.run()` — `{ simulationId: string; ticksCompleted: number; behaviorEventsWritten: number }` |
| `BrowserRunResult` | type | Returned by `BrowserAdapter.runSpecs()` — `{ passed: number; failed: number; total: number; resultsPath: string }` |
| `ScenarioPlan` | type | Returned by `ScenarioPlanner.plan()` — `{ scenarioName: string; rationale: string; personaAdjustments: PersonaAdjustment[] }` |
| `FabricReport` | type | Passed to `Reporter.report()` — `{ format: 'json' \| 'console' \| 'markdown' \| 'ci'; content: string }` |
| `FabricScore` | type | Scoring output — `{ simulationId, generatedAt, overall, dimensions: { persona_realism, coverage_delta, fixture_health, discovery_yield, regression_health, flow_coverage }, details, flakiness?, adversarial? }` |
| `FabricFeedback` | type | Feedback output — `{ schema_version: 1; loop_id; iteration; simulation_id; previous_iteration_root; generated_specs; score_snapshot; failed_flows: Array<PlaywrightFailedFlow & { suggested_scenario }>; persona_adjustments }` |
| `PersonaAdjustment` | type | `{ persona_id, field: 'pressure.urgency' \| 'pressure.financial' \| 'trade', old_value, new_value, reason }` |
| `PersonaDefinition` | type | Persona config shape — used by `parsePersonaYAML` |
| `FabricConfig` | type | `fabric.config.ts` shape |

See `docs/schema-reference.md` for detailed field documentation.

---

## Behavior events and recording

| Export | Kind | Description |
|--------|------|-------------|
| `BehaviorEventRecorder` | class | Writes behavior events to `lisa.db`. Obtain via `BehaviorEventRecorder.forRun(iterRoot, simulationId)`. |
| `RecorderInput` | type | Input shape for `recorder.record(input)` |
| `BehaviorEvent` | type | Full event row as stored in `lisa.db` |
| `BEHAVIOR_OUTCOMES` | const | Object of valid `outcome` string constants (`SUCCESS`, `SKIPPED`, `BLOCKED`, `TIMEOUT`, `CANCELLED`, `LLM_FALLBACK`, `ERROR_400`…`ERROR_UNKNOWN`) |
| `BehaviorOutcome` | type | Union of all `BEHAVIOR_OUTCOMES` values |
| `classifyOutcome` | function | Maps a raw outcome string to the nearest `BehaviorOutcome` |

---

## Database and run root

| Export | Kind | Description |
|--------|------|-------------|
| `applyLisaDbMigrations` | function | Runs all `lisa.db` migrations on a `BetterSqlite3.Database` instance. Safe to call multiple times (idempotent). |
| `LISA_DB_SCHEMA_VERSION` | const | Current schema version integer. |
| `assertSchemaVersion` | function | Throws if the db is not at the expected version. Useful in adapter tests. |
| `resolveLoopPaths` | function | Given a loop root and iteration number, returns `{ iterRoot, lisaDbPath, miniSimExportPath, candidateFlowsPath, flowResultsJsonPath, generatedFlowResultsJsonPath, fabricScorePath, fabricFeedbackPath }`. |
| `makeLoopId` | function | Generates a unique loop ID string. |
| `sealRunRoot` | function | Writes `.fabric-sealed` to an `iterRoot`. Used by CLI verify mode only — do not call from adapters. |
| `requireSimulationId` | function | Reads `LISA_SIMULATION_ID` env var and throws if absent. For consumers who need the simulation ID in a subprocess — not called by the framework itself. |
| `requireArtifactSimulationId` | function | Reads `simulation_id` from `mini-sim-export.json`. Throws if absent. |
| `assertCanWriteRunRoot` | function | Asserts the `iterRoot` directory is writable. |
| `FABRIC_SEAL_FILE` | const | Filename constant for the seal file (`.fabric-sealed`). |
| `LoopIterationPaths` | type | Return type of `resolveLoopPaths`. |

---

## Playwright result parsing

| Export | Kind | Description |
|--------|------|-------------|
| `parsePlaywrightResults` | function | Parses a Playwright JSON reporter output file into `{ passed, failed, total, failed_flows }`. |
| `specFilenameToScreenPath` | function | Converts a Playwright spec filename to a screen path string. |
| `PlaywrightFailedFlow` | type | `{ spec_title, spec_file, screen_path, failure_reason }` |
| `PlaywrightAgentResult` | type | Full parsed result from `parsePlaywrightResults`. |

---

## Personas

| Export | Kind | Description |
|--------|------|-------------|
| `parsePersonaYAML` | function | Parses a YAML file into `PersonaDefinition[]`. |
| `PersonaDefinition` | type | Persona config shape. See `docs/persona-yaml-reference.md`. |

---

## Simulation agent (Experimental)

Use when building an LLM-driven simulation adapter. The `SimulationAgentAdapter`
base class handles `lisa.db` writes and event batching; subclass it and implement
`tick()`.

| Export | Kind | Description |
|--------|------|-------------|
| `SimulationAgentAdapter` | class | Abstract base for LLM-driven simulation adapters. Subclass and implement `tick(agent, context)`. |
| `SimulationAgent` | type | Agent state passed to `tick()` |
| `AgentState` | type | Current state of a simulated agent |
| `MarketContext` | type | Environment context passed to `tick()` |
| `AgentDecision` | type | Decision returned by `tick()` |
| `ActionOutcome` | type | Outcome of executing an `AgentDecision` |
| `AgentMetadata` | type | Metadata attached to each agent instance |

---

## Analysis watcher (Experimental)

`AnalysisWatcher` is a background poller that fires events when new screen
paths are discovered or error spikes are detected during the RUN phase. It is
informational only — it does not affect loop execution.

| Export | Kind | Description |
|--------|------|-------------|
| `AnalysisWatcher` | class | Polls `lisa.db` during RUN and emits `new_path`, `error_spike`, and `tick_complete` events |
| `NewPathEvent` | type | Fired when a screen path not seen in previous iterations appears |
| `ErrorSpikeEvent` | type | Fired when error rate exceeds threshold within a tick window |
| `TickCompleteEvent` | type | Fired after each polling interval |

---

## Built-in reporters

Drop-in `Reporter` implementations included in the package.

| Export | Kind | Description |
|--------|------|-------------|
| `SlackReporter` | class | Posts a loop summary to a Slack webhook URL. Pass `{ webhookUrl }` to the constructor. |
| `SlackReporterOptions` | type | Options for `SlackReporter` |
| `HtmlReporter` | class | Writes a self-contained HTML report to `iterRoot/fabric-report.html`. |
| `HtmlReporterOptions` | type | Options for `HtmlReporter` |
| `assertScoreThreshold` | function | Throws if `score.overall` is below a threshold. Use in CI gate scripts or a custom `Reporter`. |

---

## Flakiness tracking

| Export | Kind | Description |
|--------|------|-------------|
| `FlakinessTracker` | class | Tracks per-spec pass/fail history across iterations to identify flaky tests. |
| `applyFlakinessDbMigrations` | function | Creates the flakiness tables in `lisa.db`. Call before using `FlakinessTracker`. |
| `withRetry` | function | Wraps an async function with configurable retry + delay logic. |
| `FlakinessSummary` | type | Per-spec flakiness stats returned by `FlakinessTracker.summarize()` |

---

## Visual regression

| Export | Kind | Description |
|--------|------|-------------|
| `VisualRegression` | class | Screenshot diff utility for Playwright specs. Call `check(page, 'baseline-name')` inside a test. |
| `listBaselines` | function | Returns all baseline images in `baselineDir`. |
| `updateBaseline` | function | Overwrites a baseline image with the current screenshot. |
| `resetBaselines` | function | Deletes all baselines in `baselineDir`. |
| `VisualRegressionOptions` | type | Options for `new VisualRegression(options)` |
| `VisualDiffResult` | type | Result of a `check()` call — `{ match, diffPixels, diffPercent }` |
| `VisualReportSummary` | type | Aggregate diff stats across all checks in a run |

---

## HTTP utility

| Export | Kind | Description |
|--------|------|-------------|
| `ApiExecutor` | class | Thin `fetch` wrapper with retry, timeout, and JSON error extraction. Useful inside `AppAdapter` and `SimulationAdapter` implementations. |
| `ApiError` | class | Thrown by `ApiExecutor` on non-2xx responses. Has `.status` and `.body`. |
| `pathToScreen` | function | Converts a URL pathname to a screen path string (e.g. `/jobs/123` → `jobs.detail`). |
| `ApiExecutorOptions` | type | Constructor options for `ApiExecutor` |
| `ApiRequestOptions` | type | Per-request options (headers, timeout, retries) |
| `ApiResponse` | type | Typed response wrapper returned by `ApiExecutor` methods |

---

## Misc

| Export | Kind | Description |
|--------|------|-------------|
| `normalizeScreenPath` | function | Normalizes a raw path string to `dot.notation` screen path format. |
| `SyntheticConfig` | type | Internal config shape — for advanced orchestrator configuration. Prefer `OrchestratorOptions`. |
| `loadSyntheticConfig` | function | Loads `SyntheticConfig` from environment. Used internally by the orchestrator. |
| `VerificationResult` | type | Result shape from `AppAdapter.verify()` |
| `VerifierContract` | type | Internal contract for verifiers |
