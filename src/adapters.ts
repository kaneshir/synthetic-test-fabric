/**
 * Public adapter interfaces for Synthetic Test Fabric.
 *
 * Each interface is an extension point that lets consumers plug their
 * app-specific logic into the generic fabric engine.
 *
 * Rules:
 * - No imports from app-specific modules.
 * - No LLM requirement — every interface must be satisfiable in deterministic mode.
 */

import type { FabricScore } from './score';
import type { FabricFeedback, PersonaAdjustment } from './feedback';
import type { RecorderInput } from './recorder';
import type { LlmProvider } from './llm-provider';

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

/** A single entity created during seeding — carries credentials when applicable. */
export interface SeededEntity {
  /** Fabric-assigned alias used for stable cross-run lookups (e.g. 'account.primary'). */
  alias: string;
  /** App-assigned stable ID (e.g. auth subject, database row ID). */
  id: string;
  /** Entity role/type string (e.g. 'member', 'admin', 'project'). App-defined values. */
  type: string;
  /** Auth credentials, if this entity has a login. */
  credentials?: { email: string; password: string };
  /** Arbitrary key/value metadata the adapter wants to carry through the run. */
  meta?: Record<string, unknown>;
}

/** Result of an environment health check. */
export interface AppHealthResult {
  healthy: boolean;
  errors: string[];
  warnings: string[];
}

/** Result of a simulation run. */
export interface SimulationRunResult {
  simulationId: string;
  ticksCompleted: number;
  behaviorEventsWritten: number;
}

/** Result of a browser spec run. */
export interface BrowserRunResult {
  passed: number;
  failed: number;
  total: number;
  /** Absolute path to the JSON results file written by the browser runner. */
  resultsPath: string;
}

/** A scenario the planner recommends for the next iteration. */
export interface ScenarioPlan {
  /** Scenario identifier from the app's scenario catalog. */
  scenarioName: string;
  /** Human-readable rationale for the recommendation. */
  rationale: string;
  /** Persona pressure adjustments to apply at next-iteration seed time. */
  personaAdjustments: PersonaAdjustment[];
}

/** A rendered fabric report. */
export interface FabricReport {
  format: 'json' | 'console' | 'markdown' | 'ci';
  content: string;
}

// ---------------------------------------------------------------------------
// AppAdapter
// ---------------------------------------------------------------------------

/**
 * Connects the fabric to a specific application.
 *
 * Responsible for seeding entities, resetting state between iterations,
 * and validating that the app environment is ready before a run begins.
 */
export interface AppAdapter {
  /**
   * Seed the minimum set of entities the fabric needs for this iteration.
   * Must write entity records to iterRoot (e.g. mini-sim-export.json).
   * Returns the seeded entities for alias resolution.
   */
  seed(iterRoot: string, config: {
    seekers: number;
    employers: number;
    employees: number;
    scenarioName?: string;
    /** Path to a fabric-feedback.json from a previous iteration, used for persona pressure adjustments. */
    personaAdjustmentsPath?: string;
  }): Promise<SeededEntity[]>;

  /**
   * Reset app state so the next iteration starts clean.
   * Should remove or archive data created by seed() without touching
   * pre-existing prod data.
   */
  reset(iterRoot: string): Promise<void>;

  /**
   * Validate that the app environment is ready (services running, auth
   * reachable, required env vars set). Called before SEED.
   * Must not throw — return errors in AppHealthResult.errors.
   */
  validateEnvironment(): Promise<AppHealthResult>;

  /**
   * Verify that seeded fixtures are present and healthy after SEED.
   * Should throw if verification fails so the orchestrator can abort.
   */
  verify(iterRoot: string): Promise<void>;

  /**
   * Import iteration artifacts into the persistent store (e.g. Postgres).
   * Only called when dbUrl is provided.
   */
  importRun(iterRoot: string, dbUrl: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// SimulationAdapter
// ---------------------------------------------------------------------------

/**
 * Drives the simulation tick loop that produces behavior events.
 *
 * Responsible for running agents, recording BehaviorEvents to lisa.db,
 * and exporting a mini-sim-export.json artifact.
 */
export interface SimulationAdapter {
  /**
   * Run simulation ticks, writing BehaviorEvents to the lisa.db at
   * <iterRoot>/.lisa_memory/lisa.db.
   */
  run(iterRoot: string, options: {
    ticks: number;
    liveLlm: boolean;
    simulationId?: string;
  }): Promise<SimulationRunResult>;

  /**
   * Export the seeded entity manifest to <iterRoot>/mini-sim-export.json.
   * Called after seed() so SCORE and FEEDBACK can resolve entity IDs.
   */
  exportEntities(iterRoot: string, entities: SeededEntity[]): Promise<void>;

  /**
   * Clean simulation state after a run (optional — no-op is acceptable).
   * Use for teardown that must happen even when later steps fail.
   */
  clean(iterRoot: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// ScoringAdapter
// ---------------------------------------------------------------------------

/**
 * Computes FabricScore from the artifacts written during a loop iteration.
 *
 * Reads lisa.db, flow-results.json, and other run artifacts from iterRoot.
 * Must be deterministic given the same inputs.
 */
export interface ScoringAdapter {
  /**
   * Compute and return a FabricScore.
   * Must also write <iterRoot>/fabric-score.json for downstream steps.
   */
  score(iterRoot: string): Promise<FabricScore>;
}

// ---------------------------------------------------------------------------
// FeedbackAdapter
// ---------------------------------------------------------------------------

/**
 * Computes FabricFeedback from the current iteration's score and results.
 *
 * Feedback drives persona pressure adjustments and scenario selection for
 * the next iteration. Must not require a live LLM call.
 */
export interface FeedbackAdapter {
  /**
   * Compute and return FabricFeedback.
   * Must also write <iterRoot>/fabric-feedback.json for the IMPORT step.
   */
  feedback(iterRoot: string, options: {
    score: FabricScore;
    loopId: string;
    iteration: number;
    previousIterRoot: string | null;
  }): Promise<FabricFeedback>;
}

// ---------------------------------------------------------------------------
// MemoryAdapter
// ---------------------------------------------------------------------------

/**
 * Abstracts the Lisa memory store (currently SQLite via lisa.db).
 *
 * Responsible for schema lifecycle and entity alias resolution.
 * This interface allows alternative backends (e.g. in-memory for tests).
 */
export interface MemoryAdapter {
  /** Apply schema migrations to the database at dbPath. Creates if absent. */
  migrate(dbPath: string): void;

  /** Write a behavior event to the store. */
  writeEvent(dbPath: string, event: RecorderInput): void;

  /**
   * Resolve a seeded entity by alias.
   * Returns null if the alias is not found — never throws.
   */
  resolveEntity(dbPath: string, alias: string): SeededEntity | null;

  /** List all seeded entities for a simulation. */
  listEntities(dbPath: string, simulationId: string): SeededEntity[];
}

// ---------------------------------------------------------------------------
// BrowserAdapter
// ---------------------------------------------------------------------------

/**
 * Executes Playwright (or any browser runner) spec files against the app.
 *
 * The adapter abstracts the test runner invocation so the fabric engine
 * does not need to know about Playwright config or cwd conventions.
 */
export interface BrowserAdapter {
  /**
   * Run a set of spec files and return structured results.
   * When allowFailures is true, the adapter must not throw on test failures —
   * it must return them in BrowserRunResult.failed instead.
   * Must write a JSON results file at BrowserRunResult.resultsPath.
   */
  runSpecs(options: {
    iterRoot: string;
    project: string;
    allowFailures: boolean;
    grep?: string;
    /** Retry each failing spec up to this many times with jitter. Default: 0 (no retry). */
    retryCount?: number;
    /** Base delay in ms between retries (exponential backoff + jitter applied). Default: 500. */
    retryDelayMs?: number;
    /** Flow names to skip entirely — quarantined flows passed from FlakinessTracker. */
    quarantinedFlows?: string[];
    /** LLM provider resolved by the framework for the generate-flows project. Adapters may ignore it. */
    llmProvider?: LlmProvider;
  }): Promise<BrowserRunResult>;
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

/**
 * Renders a FabricScore into a human- or machine-readable report.
 *
 * Multiple reporters can be composed (e.g. console + CI summary).
 * Must not throw — errors should be returned in FabricReport.content.
 */
export interface Reporter {
  /** Render a report for the given score and run context. */
  report(score: FabricScore, iterRoot: string): Promise<FabricReport>;
}

// ---------------------------------------------------------------------------
// ScenarioPlanner
// ---------------------------------------------------------------------------

/**
 * Recommends the next simulation scenario based on current score and history.
 *
 * Must be deterministic — LLM enrichment is optional and additive.
 * A no-op implementation that always returns 'baseline_browser_flow' is valid.
 */
export interface ScenarioPlanner {
  /**
   * Given the current score and iteration root, recommend the next scenario.
   * Returns a ScenarioPlan with the scenario name, rationale, and any
   * persona pressure adjustments to apply at next-iteration seed time.
   */
  plan(score: FabricScore, iterRoot: string): Promise<ScenarioPlan>;
}
