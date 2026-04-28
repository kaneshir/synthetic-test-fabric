export { McpClient, createMcpClient } from './mcp-client';
export type { McpClientOptions, McpTool, McpCallResult } from './mcp-client';
export { normalizeScreenPath } from './screen-path';
export type { SyntheticConfig } from './config';
export { loadSyntheticConfig } from './config';
export { BEHAVIOR_OUTCOMES, classifyOutcome } from './outcomes';
export type { BehaviorOutcome } from './outcomes';
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
} from './run-root';
export type { LoopIterationPaths } from './run-root';
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
