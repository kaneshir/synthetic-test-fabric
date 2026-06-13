export { McpClient, createMcpClient } from './mcp-client';
export type { McpClientOptions, McpTool, McpCallResult } from './mcp-client';
export { normalizeScreenPath } from './screen-path';
export type { SyntheticConfig } from './config';
export { loadSyntheticConfig } from './config';
export { BEHAVIOR_OUTCOMES, classifyOutcome, classifyMcpOutcome } from './outcomes';
export type { BehaviorOutcome } from './outcomes';
export { McpExecutor, McpError, McpWriteBlockedError, toolToScreen } from './mcp-target/executor';
export type {
  McpTargetConfig,
  McpToolResult,
  McpToolMeta,
  CallToolOptions,
  JsonRpcEnvelope,
} from './mcp-target/executor';
export { snapshotCatalog, diffCatalog, runMcpCoverage } from './mcp-target/discovery';
export type { CatalogSnapshot, CatalogDiff, McpCoverageResult, CoverageOptions } from './mcp-target/discovery';
export { generateInputs } from './mcp-target/schema-gen';
export type { SchemaGenResult, JsonSchema } from './mcp-target/schema-gen';
export {
  LISA_DB_SCHEMA_VERSION,
  applyLisaDbMigrations,
  assertSchemaVersion,
} from './schema';
export { BehaviorEventRecorder } from './recorder';
export type { BehaviorEvent, RecorderInput } from './recorder';
export {
  assertCanWriteRunRoot,
  sealRunRoot,
  requireSimulationId,
  requireArtifactSimulationId,
  resolveLoopPaths,
  makeLoopId,
  FABRIC_SEAL_FILE,
  // Root-kind detection + normalization (added in #18)
  detectRootKind,
  resolveLoopRoot,
  resolveIterRoot,
  AmbiguousRootError,
  UnknownRootError,
  // Structured root inspection (added in #20)
  inspectRunRoot,
} from './run-root';
export type {
  LoopIterationPaths,
  RootKind,
  RunPhase,
  RunRootSummary,
  BehaviorEventSummary,
} from './run-root';
// Project scaffolder (added in #21) — same library backs the `fab init` CLI.
export { scaffoldProject, InitConflictError } from './cli/init';
export type { InitOptions, InitResult } from './cli/init';
// Per-adapter scaffolder (added in #22) — same library backs `fab adapter scaffold`.
export {
  scaffoldAdapter,
  ScaffoldAdapterError,
  renderAdapterStub,
  isAdapterType,
  ADAPTER_TYPES,
  ADAPTER_INTERFACES,
  DEFAULT_ADAPTER_CLASS_NAMES,
} from './cli/init';
export type {
  AdapterType,
  ScaffoldAdapterOptions,
  ScaffoldAdapterResult,
} from './cli/init';
// Adapter validator (added in #23) — same library backs `fab adapter validate`.
export { validateAdapter, AdapterValidateError } from './cli/adapter-validate';
export type {
  ValidationError,
  ValidationResult,
  ValidateAdapterOptions,
} from './cli/adapter-validate';
// MCP server — fab-mcp wrapping all fab commands as native MCP tools (added in #27).
export { runFabCommand, FAB_CLI_PATH, resolveEnvTimeoutMs } from './mcp/runner';
export type { RunFabResult, RunFabOptions } from './mcp/runner';
export { createServer as createMcpServer, TOOL_COUNT, TOOL_NAMES } from './mcp/server';

// Doctor — environment + peer-dep health check (added in #24).
export { runDoctor } from './cli/doctor';
export type {
  DoctorCheck,
  DoctorResult,
  RunDoctorOptions,
  CheckStatus,
} from './cli/doctor';
export type { FabricScore } from './score';
export { parsePlaywrightResults, specFilenameToScreenPath } from './playwright-result';
export type { PlaywrightAgentResult, PlaywrightFailedFlow } from './playwright-result';
export type { FabricFeedback, PersonaAdjustment } from './feedback';
export type { PersonaDefinition } from './persona';
export { parsePersonaYAML } from './persona';
export type {
  SimulationAgent,
  AgentState,
  MarketContext,
  AgentDecision,
  ActionOutcome,
} from './simulation-agent.interface';
export { SimulationAgentAdapter } from './simulation-agent-adapter';
export type { AgentMetadata } from './simulation-agent-adapter';
export { AnalysisWatcher } from './analysis-watcher';
export type { NewPathEvent, ErrorSpikeEvent, TickCompleteEvent } from './analysis-watcher';
export type { VerificationResult, VerifierContract } from './verifier';
export type {
  SeededEntity,
  AppHealthResult,
  SimulationRunResult,
  BrowserRunResult,
  ScenarioPlan,
  FabricReport,
  AppAdapter,
  SimulationAdapter,
  ScoringAdapter,
  FeedbackAdapter,
  MemoryAdapter,
  BrowserAdapter,
  Reporter,
  ScenarioPlanner,
} from './adapters';
export { FabricOrchestrator } from './orchestrator';
export type { OrchestratorOptions, OrchestratorAdapters } from './orchestrator';
export type { LlmProvider } from './llm-provider';
export { AgentLoopProvider } from './agent-loop';
export {
  ClaudeCliProvider,
  ClaudeSdkProvider,
  GeminiProvider,
  OllamaProvider,
  OpenAIProvider,
  DEFAULT_CLAUDE_SDK_MODEL,
  DEFAULT_GEMINI_MODEL,
  claudeCliAvailable,
  resolveProvider,
} from './llm-provider';
export type { FabricConfig } from './cli/types';
export { ApiExecutor, ApiError, pathToScreen } from './api-executor';
export type { ApiExecutorOptions, ApiRequestOptions, ApiResponse } from './api-executor';
export { FlakinessTracker, withRetry, applyFlakinessDbMigrations } from './flakiness';
export type { FlakinessSummary } from './flakiness';
export { SlackReporter } from './reporters/slack';
export type { SlackReporterOptions } from './reporters/slack';
export { assertScoreThreshold } from './reporters/gate';
export { HtmlReporter } from './reporters/html';
export type { HtmlReporterOptions } from './reporters/html';
export {
  VisualRegression,
  listBaselines,
  updateBaseline,
  resetBaselines,
} from './visual-regression';
export type {
  VisualRegressionOptions,
  VisualDiffResult,
  VisualReportSummary,
} from './visual-regression';
