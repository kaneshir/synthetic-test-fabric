/**
 * Compiled type-shape fixtures. These verify that every type documented in
 * docs/schema-reference.md and docs/package-exports.md has the correct fields.
 * Run: npm run check:fixtures
 */
import type {
  FabricScore,
  FabricFeedback,
  SeededEntity,
  AppHealthResult,
  SimulationRunResult,
  BrowserRunResult,
  ScenarioPlan,
  FabricReport,
  PersonaAdjustment,
  PlaywrightFailedFlow,
  RecorderInput,
} from 'synthetic-test-fabric';

// FabricScore — all six dimensions + required top-level fields
const score: FabricScore = {
  simulationId: 'sim-001',
  generatedAt: new Date().toISOString(),
  overall: 7.5,
  dimensions: {
    persona_realism: 8,
    coverage_delta: 2,
    fixture_health: 9,
    discovery_yield: 3,
    regression_health: 7,
    flow_coverage: 8,
  },
  details: {},
};

// FabricScore — optional fields
const scoreWithOptionals: FabricScore = {
  ...score,
  flakiness: {
    quarantinedFlows: ['login.spec.ts'],
    topFlaky: [{ flowName: 'checkout', failureRate: 0.2, total: 10, quarantined: false }],
  },
  adversarial: {
    probesAttempted: 5,
    violationsFound: 1,
    topViolations: ['XSS in search field'],
  },
};

// PersonaAdjustment — field is a constrained union
const adj: PersonaAdjustment = {
  persona_id: 'casual_member',
  field: 'pressure.urgency',
  old_value: 'low',
  new_value: 'high',
  reason: 'gaps found in previous iteration',
};

const adjTrade: PersonaAdjustment = { ...adj, field: 'trade', old_value: 'conservative', new_value: 'aggressive' };
const adjFinancial: PersonaAdjustment = { ...adj, field: 'pressure.financial' };

// PlaywrightFailedFlow
const failedFlow: PlaywrightFailedFlow = {
  spec_title: 'user can complete checkout',
  spec_file: 'flows/checkout.spec.ts',
  screen_path: 'checkout.review',
  failure_reason: 'expected button to be visible',
};

// FabricFeedback
const feedback: FabricFeedback = {
  schema_version: 1,
  loop_id: 'loop-001',
  iteration: 1,
  simulation_id: 'sim-001',
  previous_iteration_root: null,
  generated_specs: ['flows/checkout.generated.spec.ts'],
  score_snapshot: score,
  failed_flows: [{ ...failedFlow, suggested_scenario: 'checkout_retry' }],
  persona_adjustments: [adj],
};

// SeededEntity
const entity: SeededEntity = {
  alias: 'account.primary',
  id: 'usr_abc123',
  type: 'member',
  credentials: { email: 'test@example.com', password: 'secret' },
  meta: { plan: 'pro' },
};

// AppHealthResult
const health: AppHealthResult = {
  healthy: true,
  errors: [],
  warnings: ['DB connection pool at 80%'],
};

// SimulationRunResult
const simResult: SimulationRunResult = {
  simulationId: 'sim-001',
  ticksCompleted: 5,
  behaviorEventsWritten: 42,
};

// BrowserRunResult — resultsPath not durationMs
const browserResult: BrowserRunResult = {
  passed: 9,
  failed: 1,
  total: 10,
  resultsPath: '/tmp/stf/iter-001/flow-results.json',
};

// ScenarioPlan
const plan: ScenarioPlan = {
  scenarioName: 'gap_regression_probe',
  rationale: 'discovery_yield > 0 in last iteration',
  personaAdjustments: [adj],
};

// FabricReport
const report: FabricReport = {
  format: 'json',
  content: JSON.stringify({ score }),
};

// RecorderInput — Omit<BehaviorEvent, 'event_id' | 'sequence_in_tick' | 'recorded_at'>
const event: RecorderInput = {
  execution_id: 'exec-001',
  simulation_id: 'sim-001',
  agent_id: 'agent-001',
  entity_id: 'usr_001',
  persona_definition_id: 'casual_member',
  tick: 1,
  sim_time: new Date().toISOString(),
  action: 'click_submit',
  reasoning: null,
  event_source: 'agent',
  event_kind: 'action',
  execution_state: 'completed',
  outcome: 'success',
  outcome_detail: null,
  screen_path: 'checkout.review',
  entity_refs: null,
};

export { score, scoreWithOptionals, adj, adjTrade, adjFinancial, failedFlow, feedback, entity, health, simResult, browserResult, plan, report, event };
