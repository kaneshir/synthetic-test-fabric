// Test fixture: minimal FabricConfig with no-op adapters.
// Used by backward-compat snapshot tests to exercise the CLI without
// real adapter side effects. NOT shipped (excluded via `**/__test-helpers__/**`).

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

const STUB_SCORE: FabricScore = {
  simulationId: 'sim-stub-001',
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

class StubAppAdapter implements AppAdapter {
  async seed(): Promise<SeededEntity[]> { return []; }
  async reset(): Promise<void> {}
  async validateEnvironment(): Promise<AppHealthResult> { return { healthy: true, errors: [], warnings: [] }; }
  async verify(): Promise<void> {}
  async importRun(): Promise<void> {}
}

class StubSimulationAdapter implements SimulationAdapter {
  async run(): Promise<SimulationRunResult> {
    return { simulationId: 'sim-stub-001', ticksCompleted: 0, behaviorEventsWritten: 0 };
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
      loopId: 'stub-loop',
      iteration: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      summary: 'stub',
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
    // Orchestrator looks for flow-results.json (regression) and
    // generated-flow-results.json (generated specs). Write both so any project
    // (smoke / flows / regression / analyze / generate) leaves valid artifacts.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    fs.mkdirSync(opts.iterRoot, { recursive: true });
    // Orchestrator's assertRegressionResultsWritten requires stats.expected
     // + unexpected + flaky > 0 (or non-empty suites). Use expected: 1 with
     // an empty suites array so the guard passes without faking real test
     // execution detail.
     const empty = JSON.stringify({ stats: { expected: 1, unexpected: 0, flaky: 0 }, suites: [] });
    fs.writeFileSync(path.join(opts.iterRoot, 'flow-results.json'), empty);
    fs.writeFileSync(path.join(opts.iterRoot, 'generated-flow-results.json'), empty);
    return { passed: 0, failed: 0, total: 0, resultsPath: path.join(opts.iterRoot, 'flow-results.json') };
  }
}

class StubReporter implements Reporter {
  async report(_score: FabricScore, _iterRoot: string): Promise<FabricReport> {
    return { format: 'console', content: 'stub report' };
  }
}

class StubScenarioPlanner implements ScenarioPlanner {
  async plan(_score: FabricScore, _iterRoot: string): Promise<ScenarioPlan> {
    return { scenarioName: 'stub_scenario', rationale: 'stub', personaAdjustments: [] };
  }
}

const config: FabricConfig = {
  adapters: {
    app:        new StubAppAdapter(),
    simulation: new StubSimulationAdapter(),
    scoring:    new StubScoringAdapter(),
    feedback:   new StubFeedbackAdapter(),
    memory:     new StubMemoryAdapter(),
    browser:    new StubBrowserAdapter(),
    reporters:  [new StubReporter()],
    planner:    new StubScenarioPlanner(),
  },
};

export default config;
