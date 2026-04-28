/**
 * Verifies the fabric.config.ts shape documented in docs/orchestrator-reference.md.
 */
import type { FabricConfig } from 'synthetic-test-fabric';
import { StubAppAdapter, StubSimulationAdapter, StubScoringAdapter, StubFeedbackAdapter, StubMemoryAdapter, StubBrowserAdapter, StubReporter, StubScenarioPlanner } from './adapter-stubs';

const config: FabricConfig = {
  adapters: {
    app:        new StubAppAdapter(),
    simulation: new StubSimulationAdapter(),
    browser:    new StubBrowserAdapter(),
    scoring:    new StubScoringAdapter(),
    feedback:   new StubFeedbackAdapter(),
    memory:     new StubMemoryAdapter(),
    reporters:  [new StubReporter()],
    planner:    new StubScenarioPlanner(),
  },
  defaults: {
    iterations: 3,
    ticks: 10,
    liveLlm: false,
    allowRegressionFailures: true,
  },
  baselineDir: '.fab-baselines',
};

export default config;
