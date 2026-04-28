/**
 * Compile-time contract checks for public adapter interfaces.
 *
 * These tests do not test runtime behavior — they verify that concrete
 * stub implementations satisfy every interface defined in adapters.ts.
 * If an interface gains a required method, one of these stubs will fail
 * to compile, catching the gap before it reaches consumers.
 */

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
// Stub implementations — must satisfy each interface exactly
// ---------------------------------------------------------------------------

const stubEntity: SeededEntity = {
  alias: 'primary_user',
  id: 'uid-001',
  type: 'seeker',
};

const stubHealth: AppHealthResult = {
  healthy: true,
  errors: [],
  warnings: [],
};

const stubSimResult: SimulationRunResult = {
  simulationId: 'sim-001',
  ticksCompleted: 8,
  behaviorEventsWritten: 42,
};

const stubBrowserResult: BrowserRunResult = {
  passed: 10,
  failed: 0,
  total: 10,
  resultsPath: '/tmp/flow-results.json',
};

const stubScore: FabricScore = {
  simulationId: 'sim-001',
  generatedAt: '2026-01-01T00:00:00Z',
  overall: 0.85,
  dimensions: {
    persona_realism: 1.0,
    coverage_delta: 0.0,
    fixture_health: 1.0,
    discovery_yield: 0.0,
    regression_health: 1.0,
    flow_coverage: 0.0,
  },
  details: {},
};

const stubFeedback: FabricFeedback = {
  schema_version: 1,
  loop_id: 'loop-001',
  iteration: 1,
  simulation_id: 'sim-001',
  previous_iteration_root: null,
  generated_specs: [],
  score_snapshot: stubScore,
  failed_flows: [],
  persona_adjustments: [],
};

const stubReport: FabricReport = {
  format: 'console',
  content: 'score: 0.85',
};

const stubPlan: ScenarioPlan = {
  scenarioName: 'baseline_browser_flow',
  rationale: 'default scenario',
  personaAdjustments: [],
};

// ---------------------------------------------------------------------------
// AppAdapter
// ---------------------------------------------------------------------------

class StubAppAdapter implements AppAdapter {
  async seed(_iterRoot: string, _config: {
    seekers: number;
    employers: number;
    employees: number;
    scenarioName?: string;
    personaAdjustmentsPath?: string;
  }): Promise<SeededEntity[]> {
    return [stubEntity];
  }

  async reset(_iterRoot: string): Promise<void> {}

  async validateEnvironment(): Promise<AppHealthResult> {
    return stubHealth;
  }

  async verify(_iterRoot: string): Promise<void> {}

  async importRun(_iterRoot: string, _dbUrl: string): Promise<void> {}
}

// ---------------------------------------------------------------------------
// SimulationAdapter
// ---------------------------------------------------------------------------

class StubSimulationAdapter implements SimulationAdapter {
  async run(_iterRoot: string, _options: {
    ticks: number;
    liveLlm: boolean;
    simulationId?: string;
  }): Promise<SimulationRunResult> {
    return stubSimResult;
  }

  async exportEntities(_iterRoot: string, _entities: SeededEntity[]): Promise<void> {}

  async clean(_iterRoot: string): Promise<void> {}
}

// ---------------------------------------------------------------------------
// ScoringAdapter
// ---------------------------------------------------------------------------

class StubScoringAdapter implements ScoringAdapter {
  async score(_iterRoot: string): Promise<FabricScore> {
    return stubScore;
  }
}

// ---------------------------------------------------------------------------
// FeedbackAdapter
// ---------------------------------------------------------------------------

class StubFeedbackAdapter implements FeedbackAdapter {
  async feedback(_iterRoot: string, _options: {
    score: FabricScore;
    loopId: string;
    iteration: number;
    previousIterRoot: string | null;
  }): Promise<FabricFeedback> {
    return stubFeedback;
  }
}

// ---------------------------------------------------------------------------
// MemoryAdapter
// ---------------------------------------------------------------------------

class StubMemoryAdapter implements MemoryAdapter {
  migrate(_dbPath: string): void {}

  writeEvent(_dbPath: string, _event: RecorderInput): void {}

  resolveEntity(_dbPath: string, _alias: string): SeededEntity | null {
    return null;
  }

  listEntities(_dbPath: string, _simulationId: string): SeededEntity[] {
    return [];
  }
}

// ---------------------------------------------------------------------------
// BrowserAdapter
// ---------------------------------------------------------------------------

class StubBrowserAdapter implements BrowserAdapter {
  async runSpecs(_options: {
    iterRoot: string;
    project: string;
    allowFailures: boolean;
    grep?: string;
  }): Promise<BrowserRunResult> {
    return stubBrowserResult;
  }
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

class StubReporter implements Reporter {
  async report(_score: FabricScore, _iterRoot: string): Promise<FabricReport> {
    return stubReport;
  }
}

// ---------------------------------------------------------------------------
// ScenarioPlanner
// ---------------------------------------------------------------------------

class StubScenarioPlanner implements ScenarioPlanner {
  async plan(_score: FabricScore, _iterRoot: string): Promise<ScenarioPlan> {
    return stubPlan;
  }
}

// ---------------------------------------------------------------------------
// Runtime no-ops — suppress unused variable warnings while keeping stubs alive
// ---------------------------------------------------------------------------

describe('adapter interface contracts', () => {
  it('AppAdapter stub satisfies interface', () => {
    const a: AppAdapter = new StubAppAdapter();
    expect(a).toBeDefined();
  });

  it('SimulationAdapter stub satisfies interface', () => {
    const a: SimulationAdapter = new StubSimulationAdapter();
    expect(a).toBeDefined();
  });

  it('ScoringAdapter stub satisfies interface', () => {
    const a: ScoringAdapter = new StubScoringAdapter();
    expect(a).toBeDefined();
  });

  it('FeedbackAdapter stub satisfies interface', () => {
    const a: FeedbackAdapter = new StubFeedbackAdapter();
    expect(a).toBeDefined();
  });

  it('MemoryAdapter stub satisfies interface', () => {
    const a: MemoryAdapter = new StubMemoryAdapter();
    expect(a).toBeDefined();
  });

  it('BrowserAdapter stub satisfies interface', () => {
    const a: BrowserAdapter = new StubBrowserAdapter();
    expect(a).toBeDefined();
  });

  it('Reporter stub satisfies interface', () => {
    const a: Reporter = new StubReporter();
    expect(a).toBeDefined();
  });

  it('ScenarioPlanner stub satisfies interface', () => {
    const a: ScenarioPlanner = new StubScenarioPlanner();
    expect(a).toBeDefined();
  });

  it('SeededEntity optional fields are optional', () => {
    const e: SeededEntity = { alias: 'a', id: '1', type: 'seeker' };
    expect(e.credentials).toBeUndefined();
    expect(e.meta).toBeUndefined();
  });

  it('FabricReport format is constrained', () => {
    const formats: FabricReport['format'][] = ['json', 'console', 'markdown', 'ci'];
    expect(formats).toHaveLength(4);
  });
});
