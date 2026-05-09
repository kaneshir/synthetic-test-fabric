// Test fixture: stub config where one of the adapters emits console.log noise
// inside a method. Used by the adapter-pollution regression test in json-mode.test.ts.

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
  FabricReport,
  ScenarioPlan,
} from '../../../adapters';
import type { FabricScore } from '../../../score';
import type { FabricFeedback } from '../../../feedback';
import type { RecorderInput } from '../../../recorder';
import type { FabricConfig } from '../../types';

export const NOISE_LINE_ADAPTER = 'NOISE_FROM_ADAPTER_console_log';
export const NOISE_LINE_REPORTER = 'NOISE_FROM_REPORTER_console_log';
export const NOISE_LINE_DIRECT_STDOUT = 'NOISE_FROM_ADAPTER_process_stdout_write';

const STUB_SCORE: FabricScore = {
  simulationId: 'sim-noisy-001',
  generatedAt: '2026-01-01T00:00:00Z',
  overall: 0.85,
  dimensions: {
    persona_realism: 0.9,
    coverage_delta: 0.7,
    fixture_health: 1.0,
    discovery_yield: 0.6,
    regression_health: 0.95,
    flow_coverage: 0.85,
  },
  details: {},
};

class NoisyAppAdapter implements AppAdapter {
  async seed(): Promise<SeededEntity[]> {
    // The realistic source of stdout contamination: an adapter that writes to
    // stdout for human progress display.
    console.log(NOISE_LINE_ADAPTER);
    process.stdout.write(NOISE_LINE_DIRECT_STDOUT + '\n');
    return [];
  }
  async reset(): Promise<void> {}
  async validateEnvironment(): Promise<AppHealthResult> { return { healthy: true, errors: [], warnings: [] }; }
  async verify(): Promise<void> {}
  async importRun(): Promise<void> {}
}

class StubSimulationAdapter implements SimulationAdapter {
  async run(): Promise<SimulationRunResult> {
    return { simulationId: 'sim-noisy-001', ticksCompleted: 0, behaviorEventsWritten: 0 };
  }
  async exportEntities(): Promise<void> {}
  async clean(): Promise<void> {}
}

class StubScoringAdapter implements ScoringAdapter {
  async score(): Promise<FabricScore> { return STUB_SCORE; }
}

class StubFeedbackAdapter implements FeedbackAdapter {
  async feedback(): Promise<FabricFeedback> {
    return {
      loopId: 'noisy-loop',
      iteration: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      summary: 'noisy',
      personaAdjustments: [],
      scenarioRecommendation: null,
      regressionFindings: [],
    } as unknown as FabricFeedback;
  }
}

class StubMemoryAdapter implements MemoryAdapter {
  migrate(): void {}
  writeEvent(_dbPath: string, _event: RecorderInput): void {}
  resolveEntity(): SeededEntity | null { return null; }
  listEntities(): SeededEntity[] { return []; }
}

class StubBrowserAdapter implements BrowserAdapter {
  async runSpecs(opts: { iterRoot: string; project: string }): Promise<BrowserRunResult> {
    return { passed: 0, failed: 0, total: 0, resultsPath: `${opts.iterRoot}/stub-results.json` };
  }
}

class NoisyReporter implements Reporter {
  async report(_score: FabricScore, _iterRoot: string): Promise<FabricReport> {
    console.log(NOISE_LINE_REPORTER);
    return { format: 'console', content: 'noisy report' };
  }
}

class StubScenarioPlanner implements ScenarioPlanner {
  async plan(_score: FabricScore, _iterRoot: string): Promise<ScenarioPlan> {
    return { scenarioName: 'stub_scenario', rationale: 'stub', personaAdjustments: [] };
  }
}

const config: FabricConfig = {
  adapters: {
    app:        new NoisyAppAdapter(),
    simulation: new StubSimulationAdapter(),
    scoring:    new StubScoringAdapter(),
    feedback:   new StubFeedbackAdapter(),
    memory:     new StubMemoryAdapter(),
    browser:    new StubBrowserAdapter(),
    reporters:  [new NoisyReporter()],
    planner:    new StubScenarioPlanner(),
  },
};

export default config;
