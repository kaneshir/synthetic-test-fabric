# Changelog

All notable changes to Synthetic Test Fabric are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [0.2.0] — 2026-04-27

### Breaking changes

- **GENERATE_FLOWS default provider changed.** The framework no longer defaults
  to Gemini when `GEMINI_API_KEY` is set. The new resolution order is:
  1. Explicit `llmProvider` in `OrchestratorOptions`
  2. `flowModel: 'ollama:<model>'`
  3. `flowModel: '<gemini-model>'` (non-ollama string — legacy compat)
  4. Claude CLI auto-detection (`claude` in PATH and `STF_DISABLE_CLAUDE_CLI` unset)
  5. `ANTHROPIC_API_KEY` → `ClaudeSdkProvider`
  6. `OPENAI_API_KEY` → `OpenAIProvider`
  7. `GEMINI_API_KEY` → `GeminiProvider`
  8. `undefined` (GENERATE_FLOWS phase is skipped)

  **Migration:** If you relied on `GEMINI_API_KEY` auto-selection and have
  `claude` in PATH or `ANTHROPIC_API_KEY` set, Gemini is no longer chosen.
  To restore Gemini, set `flowModel: 'gemini-1.5-pro'` in `OrchestratorOptions`
  or set `STF_DISABLE_CLAUDE_CLI=1` and clear `ANTHROPIC_API_KEY`.

- **`BrowserAdapter.runSpecs()` extended.** A new optional field `llmProvider?:
  LlmProvider` is passed when `project === 'generate-flows'`. Existing adapters
  that ignore unknown options are unaffected. Adapters that validate option keys
  exactly must add this field.

### Added

- **`LlmProvider` interface** — `{ id: string; complete(prompt, opts?):
  Promise<string> }`. Five built-in implementations: `ClaudeCliProvider`
  (subprocess, zero-config default), `ClaudeSdkProvider` (Anthropic API),
  `GeminiProvider` (Google Generative AI), `OllamaProvider` (local Ollama),
  `OpenAIProvider` (OpenAI API).
- **`resolveProvider(flowModel, llmProvider)`** — runs the 8-step resolution
  order and returns the active `LlmProvider` or `undefined`.
- **`claudeCliAvailable()`** — returns `true` if `claude` is in PATH.
- **`DEFAULT_CLAUDE_SDK_MODEL`** (`'claude-sonnet-4-6'`),
  **`DEFAULT_GEMINI_MODEL`** (`'gemini-1.5-pro'`) — exported constants.
- **`STF_DISABLE_CLAUDE_CLI`** env var — set to any non-empty string to skip
  Claude CLI auto-detection in CI environments where `claude` is installed but
  you want API-key based selection instead.
- All five provider classes and resolution utilities are exported from the
  package root. See `docs/package-exports.md` for the full list.
- `docs/package-exports.md` — full reference of every export with stability tiers.
- `demo/.env.example` — documents all provider configuration options.

---

## [0.1.0] — 2026-04-26

First public release. Everything is new.

### Core framework

- `FabricOrchestrator` — eight-phase loop state machine (SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK)
- Eight adapter interfaces: `AppAdapter`, `SimulationAdapter`, `ScoringAdapter`, `FeedbackAdapter`, `BrowserAdapter`, `MemoryAdapter`, `Reporter`, `ScenarioPlanner`
- `BehaviorEventRecorder` — buffered SQLite writer for behavior events, WAL mode, retry on SQLITE_BUSY, idempotent on SQLITE_CONSTRAINT_UNIQUE
- `FabricScore` — six-dimension scoring struct: `persona_realism`, `coverage_delta`, `fixture_health`, `discovery_yield`, `regression_health`, `flow_coverage`
- `PersonaDefinition` + `parsePersonaYAML()` — Zod-validated persona YAML with pressure model (financial / urgency / risk_tolerance)
- Run root contract — per-iteration artifact directory with `lisa.db`, `mini-sim-export.json`, `fabric-score.json`, `fabric-feedback.json`, `candidate_flows.yaml`, `flow-results.json`
- `applyLisaDbMigrations()` — SQLite schema lifecycle: `behavior_events`, `seeded_entities`, `screen_paths`, `flow_results`, `memory_entries`
- `normalizeScreenPath()` — URL → stable screen path, strips query params and IDs
- `BEHAVIOR_OUTCOMES` + `classifyOutcome()` — outcome enum and classifier
- `requireSimulationId()`, `requireArtifactSimulationId()`, `resolveLoopPaths()`, `makeLoopId()` — run root helpers

### fab CLI

- `fab orchestrate` — full loop with config file support
- `fab fresh` — wipe run root and re-seed
- `fab smoke` — single-iteration smoke check
- `fab seed` — SEED phase only
- `fab verify` — VERIFY phase only
- `fab flows` — TEST phase only (existing flows)
- `fab score` — SCORE phase only
- `fab feedback` — FEEDBACK phase only
- `fab analyze` — ANALYZE phase only
- `fab check --threshold <n>` — CI score gate, exits 1 if score < threshold
- `fab baseline list/update/reset` — visual regression baseline management
- `fabric.config.ts` loading via tsx/cjs hook — TypeScript-native config

### ApiExecutor

- `ApiExecutor` — headless HTTP executor recording behavior events to `lisa.db`
- `login()`, `get()`, `post()`, `request()`, `flush()` — full request lifecycle
- `pathToScreen()` — strips version/ID path segments to stable screen keys
- `ApiError` — typed error class with status + body
- 80× faster than Playwright for simulation-phase behavior recording (3ms vs 241ms median, see `demo/benchmark.ts`)

### Flakiness tracking

- `FlakinessTracker` — persists per-flow failure rates in `flakiness.db` across iterations
- Quarantine threshold: configurable pass rate + minimum run count
- `withRetry(fn, options)` — exponential backoff + jitter helper for spec retries
- `applyFlakinessDbMigrations()` — schema lifecycle for `flakiness.db`
- `FlakinessSummary` type exported

### Adversarial personas

- `adversarial: boolean` field on `PersonaDefinition`
- `'adversarial_probe'` added to `BehaviorEvent.event_kind`
- `FabricScore.adversarial` — probe summary: `probesAttempted`, `violationsFound`, `topViolations`

### Reporters

- `SlackReporter` — posts score summary to Slack webhook; marks dimensions below threshold in red
- `assertScoreThreshold(score, threshold)` — throws with full dimension breakdown if overall < threshold
- `HtmlReporter` — self-contained HTML report with Chart.js trend (last 30 iterations), inline visual diffs, flakiness table, adversarial summary

### Visual regression

- `VisualRegression` — pixelmatch-based screenshot comparison
- `capture(page, name)` — captures screenshot; saves as baseline on first run
- `compare(name)` — compares current screenshot against baseline; returns `VisualDiffResult`
- `update(name)` / `updateBaseline()` — updates committed baseline
- `getSummary()` / `writeSummary()` — writes `visual-regression-summary.json` to run root
- `listBaselines()`, `updateBaseline()`, `resetBaselines()` — baseline management
- `fab baseline` CLI commands backed by these functions
- `BrowserAdapter.runSpecs()` extended with `retryCount`, `retryDelayMs`, `quarantinedFlows`

### Demo

- `demo/run.ts` — full loop against a static HTML Taskboard app, no external dependencies, completes in < 30s
- `demo/benchmark.ts` — ApiExecutor vs Playwright latency comparison

### Documentation

- `README.md`, `docs/overview.md`, `docs/architecture.md`, `docs/quickstart.md`
- `docs/adapter-contract.md`, `docs/run-root-contract.md`, `docs/value-proposition.md`
- `docs/executive-brief.md`, `docs/for-qa-engineers.md`, `docs/example-walkthrough.md`
- `docs/lisa-mcp.md`, `docs/persona-yaml-reference.md`
- `CLAUDE.md`, `BOUNDARY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`

[Unreleased]: https://github.com/kaneshir/synthetic-test-fabric/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/kaneshir/synthetic-test-fabric/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kaneshir/synthetic-test-fabric/releases/tag/v0.1.0
