/**
 * Minimal adapter stub implementations.
 * These verify that the method signatures in docs/adapter-contract.md
 * are correct and that implementing each interface type-checks cleanly.
 */
import * as fs from 'fs';
import * as path from 'path';
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
  FabricScore,
  PersonaAdjustment,
  RecorderInput,
} from 'synthetic-test-fabric';

// AppAdapter
class StubAppAdapter implements AppAdapter {
  async seed(iterRoot: string, config: {
    seekers: number; employers: number; employees: number;
    scenarioName?: string; personaAdjustmentsPath?: string;
  }): Promise<SeededEntity[]> {
    const entities: SeededEntity[] = [{
      alias: 'account.primary', id: 'usr_001', type: 'member',
      credentials: { email: 'test@example.com', password: 'secret' },
    }];
    fs.writeFileSync(
      path.join(iterRoot, 'mini-sim-export.json'),
      JSON.stringify({ entities, simulation_id: 'sim-001' }),
    );
    return entities;
  }

  async reset(iterRoot: string): Promise<void> {}

  async verify(iterRoot: string): Promise<void> {}

  async validateEnvironment(): Promise<AppHealthResult> {
    return { healthy: true, errors: [], warnings: [] };
  }

  async importRun(iterRoot: string, dbUrl?: string): Promise<void> {}
}

// SimulationAdapter
class StubSimulationAdapter implements SimulationAdapter {
  async run(iterRoot: string, options: {
    ticks: number; liveLlm: boolean; simulationId?: string;
  }): Promise<SimulationRunResult> {
    return { simulationId: options.simulationId ?? '', ticksCompleted: options.ticks, behaviorEventsWritten: 0 };
  }

  async exportEntities(iterRoot: string, entities: SeededEntity[]): Promise<void> {}

  async clean(iterRoot: string): Promise<void> {}
}

// ScoringAdapter
class StubScoringAdapter implements ScoringAdapter {
  async score(iterRoot: string): Promise<FabricScore> {
    const result: FabricScore = {
      simulationId: 'sim-001',
      generatedAt: new Date().toISOString(),
      overall: 7,
      dimensions: {
        persona_realism: 7, coverage_delta: 1, fixture_health: 9,
        discovery_yield: 2, regression_health: 6, flow_coverage: 8,
      },
      details: {},
    };
    fs.writeFileSync(path.join(iterRoot, 'fabric-score.json'), JSON.stringify(result));
    return result;
  }
}

// FeedbackAdapter
class StubFeedbackAdapter implements FeedbackAdapter {
  async feedback(iterRoot: string, options: {
    score: FabricScore; loopId: string; iteration: number;
    previousIterRoot: string | null;
  }): Promise<import('synthetic-test-fabric').FabricFeedback> {
    const adj: PersonaAdjustment = {
      persona_id: 'casual_member',
      field: 'pressure.urgency',
      old_value: 'low',
      new_value: 'high',
      reason: 'gaps found',
    };
    const result = {
      schema_version: 1 as const,
      loop_id: options.loopId,
      iteration: options.iteration,
      simulation_id: options.score.simulationId,
      previous_iteration_root: options.previousIterRoot,
      generated_specs: [] as string[],
      score_snapshot: options.score,
      failed_flows: [] as Array<import('synthetic-test-fabric').PlaywrightFailedFlow & { suggested_scenario: string | null }>,
      persona_adjustments: options.score.dimensions.discovery_yield > 0 ? [adj] : [],
    };
    fs.writeFileSync(path.join(iterRoot, 'fabric-feedback.json'), JSON.stringify(result));
    return result;
  }
}

// MemoryAdapter — migrate, writeEvent, resolveEntity, listEntities
class StubMemoryAdapter implements MemoryAdapter {
  migrate(dbPath: string): void {}
  writeEvent(dbPath: string, event: RecorderInput): void {}
  resolveEntity(dbPath: string, alias: string): SeededEntity | null { return null; }
  listEntities(dbPath: string, simulationId: string): SeededEntity[] { return []; }
}

// BrowserAdapter — resultsPath in return value (not durationMs)
class StubBrowserAdapter implements BrowserAdapter {
  async runSpecs(options: {
    iterRoot: string; project: string; allowFailures: boolean;
    grep?: string; retryCount?: number; retryDelayMs?: number;
    quarantinedFlows?: string[];
    llmProvider?: import('synthetic-test-fabric').LlmProvider;
  }): Promise<BrowserRunResult> {
    return { passed: 10, failed: 0, total: 10, resultsPath: path.join(options.iterRoot, 'flow-results.json') };
  }
}

// Reporter
class StubReporter implements Reporter {
  async report(score: FabricScore, iterRoot: string): Promise<FabricReport> {
    return { format: 'json', content: JSON.stringify(score) };
  }
}

// ScenarioPlanner
class StubScenarioPlanner implements ScenarioPlanner {
  async plan(score: FabricScore, iterRoot: string): Promise<ScenarioPlan> {
    const adjustments: PersonaAdjustment[] = score.dimensions.discovery_yield > 0
      ? [{ persona_id: 'casual_member', field: 'trade', old_value: 'exploratory', new_value: 'validation', reason: 'gaps found' }]
      : [];
    return {
      scenarioName: score.dimensions.discovery_yield > 0 ? 'gap_probe' : 'baseline',
      rationale: `overall=${score.overall}`,
      personaAdjustments: adjustments,
    };
  }
}

export { StubAppAdapter, StubSimulationAdapter, StubScoringAdapter, StubFeedbackAdapter, StubMemoryAdapter, StubBrowserAdapter, StubReporter, StubScenarioPlanner };
