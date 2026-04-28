/**
 * FabricOrchestrator — generic SEED→VERIFY→RUN→ANALYZE→GENERATE_FLOWS→TEST→SCORE→FEEDBACK→IMPORT loop.
 *
 * All application-specific behaviour is injected through OrchestratorAdapters.
 * The orchestrator itself contains no application-specific code.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { FabricScore } from './score';
import type {
  AppAdapter,
  SimulationAdapter,
  ScoringAdapter,
  FeedbackAdapter,
  MemoryAdapter,
  BrowserAdapter,
  Reporter,
  ScenarioPlanner,
} from './adapters';
import { resolveLoopPaths, makeLoopId } from './run-root';
import type { LoopIterationPaths } from './run-root';
import { AnalysisWatcher } from './analysis-watcher';
import { resolveProvider } from './llm-provider';
import type { LlmProvider } from './llm-provider';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrchestratorOptions {
  iterRoot?: string;         // Deprecated individual-iter override — prefer loopRoot
  loopRoot?: string;         // Persistent loop root directory
  iterations: number;
  ticks: number;
  liveLlm: boolean;
  allowRegressionFailures: boolean;
  seekers: number;
  employers: number;
  employees: number;
  scenarioName?: string;
  flowModel?: string;
  /** Explicit LLM provider for GENERATE_FLOWS. Takes precedence over flowModel. */
  llmProvider?: LlmProvider;
  dbUrl?: string;
  /** If provided, used as the loop identifier; otherwise a new one is generated. */
  loopId?: string;
}

export interface OrchestratorAdapters {
  app: AppAdapter;
  simulation: SimulationAdapter;
  scoring: ScoringAdapter;
  feedback: FeedbackAdapter;
  memory: MemoryAdapter;
  browser: BrowserAdapter;
  reporters: Reporter[];
  planner: ScenarioPlanner;
}

// ---------------------------------------------------------------------------
// OrchestrateState (mirrors the original enum in orchestrate.ts)
// ---------------------------------------------------------------------------

type OrchestrateState =
  | 'SEED'
  | 'VERIFY'
  | 'RUN'
  | 'ANALYZE'
  | 'GENERATE_FLOWS'
  | 'TEST'
  | 'SCORE'
  | 'FEEDBACK'
  | 'IMPORT';

// ---------------------------------------------------------------------------
// FabricOrchestrator
// ---------------------------------------------------------------------------

export class FabricOrchestrator {
  private readonly adapters: OrchestratorAdapters;

  constructor(adapters: OrchestratorAdapters) {
    this.adapters = adapters;
  }

  /**
   * Execute the full SEED→…→IMPORT loop for the requested number of iterations.
   *
   * Returns the FabricScore from the last iteration.
   */
  async run(options: OrchestratorOptions): Promise<FabricScore> {
    const {
      iterations,
      ticks,
      liveLlm,
      allowRegressionFailures,
      seekers,
      employers,
      employees,
      scenarioName,
      flowModel,
      llmProvider: llmProviderOption,
      dbUrl,
    } = options;

    const loopId = options.loopId ?? makeLoopId();
    const loopRoot = options.loopRoot
      ? path.resolve(options.loopRoot)
      : path.join('/tmp/fabric-loop', loopId);

    fs.mkdirSync(loopRoot, { recursive: true });

    if (!dbUrl) {
      this.log('[orchestrate] WARNING: dbUrl not provided — IMPORT step will be skipped each iteration. Cross-run history will not be persisted.');
    }

    this.log(`[orchestrate] Loop ID:   ${loopId}`);
    this.log(`[orchestrate] Loop root: ${loopRoot}`);
    this.log(`[orchestrate] Iterations: ${iterations}, Ticks/iter: ${ticks}`);

    // ── Pre-loop environment health check ─────────────────────────────────────
    const health = await this.adapters.app.validateEnvironment();
    if (!health.healthy) {
      throw new Error(
        `[orchestrate] Environment validation failed:\n${health.errors.map((e) => `  • ${e}`).join('\n')}`
      );
    }

    let lastScore: FabricScore | null = null;

    for (let iter = 1; iter <= iterations; iter++) {
      const iterPaths = resolveLoopPaths(loopRoot, iter);
      fs.mkdirSync(iterPaths.iterRoot, { recursive: true });
      fs.mkdirSync(path.dirname(iterPaths.lisaDbPath), { recursive: true });

      this.log(`\n[orchestrate] ── Iteration ${iter}/${iterations} ──`);

      const prevFeedback = iter > 1
        ? resolveLoopPaths(loopRoot, iter - 1).fabricFeedbackPath
        : null;

      lastScore = await this.runIteration({
        iter,
        loopId,
        loopRoot,
        iterPaths,
        prevFeedback,
        ticks,
        liveLlm,
        allowRegressionFailures,
        seekers,
        employers,
        employees,
        scenarioName,
        flowModel,
        llmProvider: llmProviderOption,
        dbUrl,
      });

      // Update current symlink
      const currentLink = path.join(loopRoot, 'current');
      if (fs.existsSync(currentLink)) fs.unlinkSync(currentLink);
      fs.symlinkSync(iterPaths.iterRoot, currentLink);
    }

    this.log(`\n[orchestrate] Loop complete. Root: ${loopRoot}`);

    if (!lastScore) {
      throw new Error('[orchestrate] No score was produced — iterations must be >= 1');
    }
    return lastScore;
  }

  // ---------------------------------------------------------------------------
  // Per-iteration logic
  // ---------------------------------------------------------------------------

  private async runIteration(ctx: {
    iter: number;
    loopId: string;
    loopRoot: string;
    iterPaths: LoopIterationPaths;
    prevFeedback: string | null;
    ticks: number;
    liveLlm: boolean;
    allowRegressionFailures: boolean;
    seekers: number;
    employers: number;
    employees: number;
    scenarioName?: string;
    flowModel?: string;
    llmProvider?: LlmProvider;
    dbUrl?: string;
  }): Promise<FabricScore> {
    const {
      iter,
      loopId,
      iterPaths,
      prevFeedback,
      ticks,
      liveLlm,
      allowRegressionFailures,
      seekers,
      employers,
      employees,
      scenarioName,
      flowModel,
      llmProvider,
      dbUrl,
    } = ctx;

    // ── SEED ────────────────────────────────────────────────────────────────
    await this.step('SEED', iter, async () => {
      const seedConfig: Parameters<AppAdapter['seed']>[1] = {
        seekers,
        employers,
        employees,
        ...(scenarioName ? { scenarioName } : {}),
        ...(prevFeedback && fs.existsSync(prevFeedback)
          ? { personaAdjustmentsPath: prevFeedback }
          : {}),
      };
      await this.adapters.app.seed(iterPaths.iterRoot, seedConfig);
    });

    // ── VERIFY ───────────────────────────────────────────────────────────────
    // Run the fixture verifier against the seeded iterRoot.
    await this.step('VERIFY', iter, async () => {
      await this.adapters.app.verify(iterPaths.iterRoot);
    });

    // ── RUN ─────────────────────────────────────────────────────────────────
    await this.step('RUN', iter, async () => {
      await this.runWithWatcher(iterPaths, ticks, liveLlm);
    });

    // ── ANALYZE ─────────────────────────────────────────────────────────────
    // The simulation adapter's exportEntities() is responsible for materialising
    // any post-run artifacts (including the entity manifest and candidate flows)
    // needed by downstream steps (SCORE, FEEDBACK, GENERATE_FLOWS).
    await this.step('ANALYZE', iter, async () => {
      // Re-read the entity manifest that seed() wrote and export it so
      // SCORE/FEEDBACK can resolve entity IDs.
      let entities: import('./adapters').SeededEntity[] = [];
      if (fs.existsSync(iterPaths.miniSimExportPath)) {
        const raw = JSON.parse(
          fs.readFileSync(iterPaths.miniSimExportPath, 'utf8')
        ) as { entities?: import('./adapters').SeededEntity[] };
        entities = raw.entities ?? [];
      }
      await this.adapters.simulation.exportEntities(iterPaths.iterRoot, entities);
    });

    // ── GENERATE_FLOWS ──────────────────────────────────────────────────────
    await this.step('GENERATE_FLOWS', iter, async () => {
      if (!fs.existsSync(iterPaths.candidateFlowsPath)) {
        this.log('[orchestrate] GENERATE_FLOWS: no candidate_flows.yaml — nothing to generate');
        return;
      }
      const provider = resolveProvider(flowModel, llmProvider);
      if (!provider) {
        this.log(
          '[orchestrate] GENERATE_FLOWS: no LLM provider configured — skipping. ' +
          'Install the claude CLI (https://claude.ai/download), set ANTHROPIC_API_KEY, ' +
          'OPENAI_API_KEY, or GEMINI_API_KEY, or pass llmProvider in OrchestratorOptions.'
        );
        return;
      }
      this.log(`[orchestrate] GENERATE_FLOWS: using provider ${provider.id}`);
      // GENERATE_FLOWS delegates entirely to the browser adapter, which owns
      // prompt construction, MCP wiring, and spec writing. The resolved provider
      // is passed through so the adapter can call provider.complete() if needed.
      await this.adapters.browser.runSpecs({
        iterRoot: iterPaths.iterRoot,
        project: 'generate-flows',
        allowFailures: true,
        llmProvider: provider,
      }).catch((err) => {
        this.log(`[orchestrate] GENERATE_FLOWS: some flows failed to generate (non-fatal): ${err}`);
      });
    });

    // ── TEST ─────────────────────────────────────────────────────────────────
    await this.step('TEST', iter, async () => {
      // Run generated specs non-fatally
      await this.adapters.browser.runSpecs({
        iterRoot: iterPaths.iterRoot,
        project: 'generated-flows',
        allowFailures: true,
      }).catch(() => {
        this.log('[orchestrate] TEST(generated): failures captured, continuing');
      });

      // Run full regression
      if (allowRegressionFailures) {
        // Delete before the run so a stale file from a previous run of the same loop root
        // cannot satisfy assertRegressionResultsWritten() when Playwright crashes mid-run.
        if (fs.existsSync(iterPaths.flowResultsJsonPath)) {
          fs.unlinkSync(iterPaths.flowResultsJsonPath);
        }
        await this.adapters.browser.runSpecs({
          iterRoot: iterPaths.iterRoot,
          project: 'regression',
          allowFailures: true,
        }).catch(() => {
          this.log('[orchestrate] TEST(regression): failures captured — continuing to SCORE (allowRegressionFailures)');
        });
        this.assertRegressionResultsWritten(iterPaths.flowResultsJsonPath);
      } else {
        await this.adapters.browser.runSpecs({
          iterRoot: iterPaths.iterRoot,
          project: 'regression',
          allowFailures: false,
        });
      }
    });

    // ── SCORE ────────────────────────────────────────────────────────────────
    let score!: FabricScore;
    await this.step('SCORE', iter, async () => {
      score = await this.adapters.scoring.score(iterPaths.iterRoot);
    });

    // ── FEEDBACK ─────────────────────────────────────────────────────────────
    await this.step('FEEDBACK', iter, async () => {
      await this.adapters.feedback.feedback(iterPaths.iterRoot, {
        score,
        loopId,
        iteration: iter,
        previousIterRoot: prevFeedback ? path.dirname(prevFeedback) : null,
      });
    });

    // ── Run reporters ────────────────────────────────────────────────────────
    for (const reporter of this.adapters.reporters) {
      try {
        const report = await reporter.report(score, iterPaths.iterRoot);
        this.log(`[orchestrate] reporter(${report.format}): done`);
      } catch (err) {
        this.log(`[orchestrate] reporter: error (non-fatal): ${err}`);
      }
    }

    // ── IMPORT ───────────────────────────────────────────────────────────────
    await this.step('IMPORT', iter, async () => {
      if (!dbUrl) {
        this.log('[orchestrate] IMPORT: skipped — no dbUrl configured');
        return;
      }
      await this.adapters.app.importRun(iterPaths.iterRoot, dbUrl);
    });

    // ── Cleanup ──────────────────────────────────────────────────────────────
    await this.adapters.simulation.clean(iterPaths.iterRoot).catch((err) => {
      this.log(`[orchestrate] simulation.clean() non-fatal: ${err}`);
    });

    return score;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async runWithWatcher(
    iterPaths: LoopIterationPaths,
    ticks: number,
    liveLlm: boolean,
  ): Promise<void> {
    // Resolve simulationId from mini-sim-export.json written by SEED
    let simulationId = '';
    if (fs.existsSync(iterPaths.miniSimExportPath)) {
      const exp = JSON.parse(
        fs.readFileSync(iterPaths.miniSimExportPath, 'utf8')
      ) as { simulation_id?: string };
      simulationId = (exp.simulation_id ?? '').trim();
    }

    const watcher = new AnalysisWatcher(iterPaths.lisaDbPath, simulationId, {
      pollIntervalMs: 10_000,
    });

    watcher.on('new_path', (evt) => {
      this.log(`[orchestrate] [watcher] new path: ${evt.screen_path} (×${evt.discovered_count})`);
    });
    watcher.on('error_spike', (evt) => {
      this.log(`[orchestrate] [watcher] error spike: ${(evt.error_rate * 100).toFixed(0)}% at tick ${evt.tick}`);
    });
    watcher.on('error', (err) => {
      this.log(`[orchestrate] [watcher] error (non-fatal): ${err}`);
    });

    watcher.start();

    try {
      await this.adapters.simulation.run(iterPaths.iterRoot, {
        ticks,
        liveLlm,
        simulationId: simulationId || undefined,
      });
    } finally {
      await Promise.race([
        watcher.stop(),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
  }

  private assertRegressionResultsWritten(flowResultsPath: string): void {
    if (!fs.existsSync(flowResultsPath)) {
      throw new Error(
        '[orchestrate] TEST(regression): flow-results.json was not written — ' +
        'Playwright likely failed before running any tests (check browser install, reporter config, or test imports). ' +
        'Refusing to continue to SCORE with no regression data.',
      );
    }
    const raw = JSON.parse(fs.readFileSync(flowResultsPath, 'utf8')) as {
      stats?: { expected?: number; unexpected?: number; flaky?: number };
      suites?: unknown[];
    };
    let total = 0;
    if (raw.stats && typeof raw.stats.expected === 'number') {
      total = (raw.stats.expected ?? 0) + (raw.stats.unexpected ?? 0) + (raw.stats.flaky ?? 0);
    } else {
      total = (raw.suites?.length ?? 0) > 0 ? 1 : 0;
    }
    if (total === 0) {
      throw new Error(
        '[orchestrate] TEST(regression): flow-results.json exists but reports 0 tests — ' +
        'Playwright may have exited before collecting any results. ' +
        'Refusing to continue to SCORE with empty regression data.',
      );
    }
  }

  private async step(
    state: OrchestrateState,
    iter: number,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (iter > 0) {
      this.log(`[orchestrate] iter-${String(iter).padStart(3, '0')}: → ${state}`);
    }
    await fn();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected log(message: string): void {
    console.log(message);
  }
}
