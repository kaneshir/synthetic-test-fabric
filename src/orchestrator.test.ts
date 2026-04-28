import { FabricOrchestrator } from './orchestrator';
import type { OrchestratorAdapters, OrchestratorOptions } from './orchestrator';
import type {
  AppAdapter,
  SimulationAdapter,
  ScoringAdapter,
  FeedbackAdapter,
  MemoryAdapter,
  BrowserAdapter,
  Reporter,
  ScenarioPlanner,
  SeededEntity,
  AppHealthResult,
  SimulationRunResult,
  BrowserRunResult,
  ScenarioPlan,
  FabricReport,
} from './adapters';
import type { FabricScore } from './score';
import type { FabricFeedback } from './feedback';
import type { RecorderInput } from './recorder';

// ---------------------------------------------------------------------------
// Shared stub score returned by the scoring adapter stub
// ---------------------------------------------------------------------------

const STUB_SCORE: FabricScore = {
  simulationId: 'sim-stub-001',
  generatedAt: '2026-01-01T00:00:00Z',
  overall: 0.8,
  dimensions: {
    persona_realism: 0.9,
    coverage_delta: 0.7,
    fixture_health: 1.0,
    discovery_yield: 0.6,
    regression_health: 0.8,
    flow_coverage: 0.75,
  },
  details: {},
};

const STUB_FEEDBACK: FabricFeedback = {
  schema_version: 1,
  loop_id: 'test-loop',
  iteration: 1,
  simulation_id: 'sim-stub-001',
  previous_iteration_root: null,
  generated_specs: [],
  score_snapshot: STUB_SCORE,
  failed_flows: [],
  persona_adjustments: [],
};

// ---------------------------------------------------------------------------
// Adapter stubs
// ---------------------------------------------------------------------------

function makeStubAdapters(): {
  adapters: OrchestratorAdapters;
  mocks: {
    validateEnvironment: jest.Mock;
    seed: jest.Mock;
    reset: jest.Mock;
    verify: jest.Mock;
    importRun: jest.Mock;
    simulationRun: jest.Mock;
    exportEntities: jest.Mock;
    clean: jest.Mock;
    score: jest.Mock;
    feedback: jest.Mock;
    browserRunSpecs: jest.Mock;
    reporterReport: jest.Mock;
    plannerPlan: jest.Mock;
    memoryMigrate: jest.Mock;
    memoryWriteEvent: jest.Mock;
    memoryResolveEntity: jest.Mock;
    memoryListEntities: jest.Mock;
  };
} {
  const validateEnvironment = jest.fn<Promise<AppHealthResult>, []>().mockResolvedValue({
    healthy: true,
    errors: [],
    warnings: [],
  });
  const seed = jest.fn<Promise<SeededEntity[]>, [string, any]>().mockResolvedValue([]);
  const reset = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

  const simulationRun = jest.fn<Promise<SimulationRunResult>, [string, any]>().mockResolvedValue({
    simulationId: 'sim-stub-001',
    ticksCompleted: 2,
    behaviorEventsWritten: 0,
  });
  const exportEntities = jest.fn<Promise<void>, [string, SeededEntity[]]>().mockResolvedValue(undefined);
  const clean = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

  const score = jest.fn<Promise<FabricScore>, [string]>().mockResolvedValue(STUB_SCORE);
  const feedback = jest.fn<Promise<FabricFeedback>, [string, any]>().mockResolvedValue(STUB_FEEDBACK);

  const browserRunSpecs = jest.fn<Promise<BrowserRunResult>, [any]>().mockResolvedValue({
    passed: 1,
    failed: 0,
    total: 1,
    resultsPath: '/tmp/flow-results.json',
  });

  const reporterReport = jest.fn<Promise<FabricReport>, [FabricScore, string]>().mockResolvedValue({
    format: 'console',
    content: 'stub report',
  });

  const plannerPlan = jest.fn<Promise<ScenarioPlan>, [FabricScore, string]>().mockResolvedValue({
    scenarioName: 'baseline_browser_flow',
    rationale: 'stub',
    personaAdjustments: [],
  });

  const memoryMigrate = jest.fn<void, [string]>();
  const memoryWriteEvent = jest.fn<void, [string, RecorderInput]>();
  const memoryResolveEntity = jest.fn<SeededEntity | null, [string, string]>().mockReturnValue(null);
  const memoryListEntities = jest.fn<SeededEntity[], [string, string]>().mockReturnValue([]);

  const verify = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
  const importRun = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);

  const appAdapter: AppAdapter = {
    validateEnvironment,
    seed,
    reset,
    verify,
    importRun,
  };

  const simulationAdapter: SimulationAdapter = {
    run: simulationRun,
    exportEntities,
    clean,
  };

  const scoringAdapter: ScoringAdapter = { score };
  const feedbackAdapter: FeedbackAdapter = { feedback };

  const memoryAdapter: MemoryAdapter = {
    migrate: memoryMigrate,
    writeEvent: memoryWriteEvent,
    resolveEntity: memoryResolveEntity,
    listEntities: memoryListEntities,
  };

  const browserAdapter: BrowserAdapter = { runSpecs: browserRunSpecs };
  const reporter: Reporter = { report: reporterReport };
  const planner: ScenarioPlanner = { plan: plannerPlan };

  const adapters: OrchestratorAdapters = {
    app: appAdapter,
    simulation: simulationAdapter,
    scoring: scoringAdapter,
    feedback: feedbackAdapter,
    memory: memoryAdapter,
    browser: browserAdapter,
    reporters: [reporter],
    planner,
  };

  return {
    adapters,
    mocks: {
      validateEnvironment,
      seed,
      reset,
      verify,
      importRun,
      simulationRun,
      exportEntities,
      clean,
      score,
      feedback,
      browserRunSpecs,
      reporterReport,
      plannerPlan,
      memoryMigrate,
      memoryWriteEvent,
      memoryResolveEntity,
      memoryListEntities,
    },
  };
}

function makeOptions(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    iterations: 1,
    ticks: 2,
    liveLlm: false,
    allowRegressionFailures: false,
    seekers: 1,
    employers: 1,
    employees: 0,
    loopRoot: '/tmp/orchestrator-test-' + Date.now(),
    loopId: 'test-loop-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FabricOrchestrator', () => {
  describe('construction', () => {
    it('can be constructed with all-stub adapters and compiles', () => {
      const { adapters } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);
      expect(orchestrator).toBeInstanceOf(FabricOrchestrator);
    });
  });

  describe('run()', () => {
    it('calls app.validateEnvironment() before the first seed()', async () => {
      const { adapters, mocks } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);

      const callOrder: string[] = [];
      mocks.validateEnvironment.mockImplementation(async () => {
        callOrder.push('validateEnvironment');
        return { healthy: true, errors: [], warnings: [] };
      });
      mocks.seed.mockImplementation(async () => {
        callOrder.push('seed');
        return [];
      });

      await orchestrator.run(makeOptions());

      expect(callOrder.indexOf('validateEnvironment')).toBeLessThan(callOrder.indexOf('seed'));
    });

    it('throws before SEED when validateEnvironment() returns healthy: false', async () => {
      const { adapters, mocks } = makeStubAdapters();
      mocks.validateEnvironment.mockResolvedValue({
        healthy: false,
        errors: ['CLI binary not found', 'emulator offline'],
        warnings: [],
      });
      const orchestrator = new FabricOrchestrator(adapters);

      await expect(orchestrator.run(makeOptions())).rejects.toThrow('Environment validation failed');
      expect(mocks.seed).not.toHaveBeenCalled();
    });

    it('calls adapters.app.verify() after SEED on the first iteration', async () => {
      const { adapters, mocks } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);

      const callOrder: string[] = [];
      mocks.verify.mockImplementation(async () => {
        callOrder.push('verify');
      });
      mocks.seed.mockImplementation(async () => {
        callOrder.push('seed');
        return [];
      });

      await orchestrator.run(makeOptions());

      const verifyIdx = callOrder.indexOf('verify');
      const seedIdx = callOrder.indexOf('seed');
      expect(verifyIdx).toBeGreaterThanOrEqual(0);
      expect(seedIdx).toBeGreaterThanOrEqual(0);
      // VERIFY runs after SEED in the loop
      expect(verifyIdx).toBeGreaterThan(seedIdx);
    });

    it('calls adapters.app.seed() with the right config shape', async () => {
      const { adapters, mocks } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);

      await orchestrator.run(makeOptions({
        seekers: 3,
        employers: 2,
        employees: 1,
        scenarioName: 'high_pressure',
      }));

      expect(mocks.seed).toHaveBeenCalledTimes(1);
      const [iterRoot, config] = mocks.seed.mock.calls[0];
      expect(typeof iterRoot).toBe('string');
      expect(config).toMatchObject({
        seekers: 3,
        employers: 2,
        employees: 1,
        scenarioName: 'high_pressure',
      });
    });

    it('propagates error when verify() rejects', async () => {
      const { adapters, mocks } = makeStubAdapters();
      mocks.verify.mockRejectedValue(new Error('fixture mismatch: seeker_profile missing'));

      const orchestrator = new FabricOrchestrator(adapters);
      await expect(orchestrator.run(makeOptions())).rejects.toThrow('fixture mismatch: seeker_profile missing');
    });

    it('runs the full loop and returns a FabricScore', async () => {
      const { adapters } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);

      const result = await orchestrator.run(makeOptions());

      expect(result).toMatchObject({
        simulationId: STUB_SCORE.simulationId,
        overall: STUB_SCORE.overall,
      });
    });

    it('calls simulation.run() once per iteration', async () => {
      const { adapters, mocks } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);

      await orchestrator.run(makeOptions({ iterations: 3 }));

      expect(mocks.simulationRun).toHaveBeenCalledTimes(3);
    });

    it('calls scoring.score() once per iteration', async () => {
      const { adapters, mocks } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);

      await orchestrator.run(makeOptions({ iterations: 2 }));

      expect(mocks.score).toHaveBeenCalledTimes(2);
    });

    it('calls feedback.feedback() with the right options shape', async () => {
      const { adapters, mocks } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);

      await orchestrator.run(makeOptions({ loopId: 'loop-abc' }));

      expect(mocks.feedback).toHaveBeenCalledTimes(1);
      const [, opts] = mocks.feedback.mock.calls[0];
      expect(opts).toMatchObject({
        loopId: 'loop-abc',
        iteration: 1,
        previousIterRoot: null,
      });
      expect(opts.score).toMatchObject({ simulationId: STUB_SCORE.simulationId });
    });

    it('calls reporter.report() with the score', async () => {
      const { adapters, mocks } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);

      await orchestrator.run(makeOptions());

      expect(mocks.reporterReport).toHaveBeenCalledTimes(1);
      const [score] = mocks.reporterReport.mock.calls[0];
      expect(score).toMatchObject({ simulationId: STUB_SCORE.simulationId });
    });

    it('calls simulation.clean() once per iteration even when a later step succeeds', async () => {
      const { adapters, mocks } = makeStubAdapters();
      const orchestrator = new FabricOrchestrator(adapters);

      await orchestrator.run(makeOptions({ iterations: 2 }));

      expect(mocks.clean).toHaveBeenCalledTimes(2);
    });
  });
});
