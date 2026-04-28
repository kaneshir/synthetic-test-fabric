import type { FabricScore } from './score';
import type { PlaywrightFailedFlow } from './playwright-result';

export interface PersonaAdjustment {
  persona_id: string;
  field: 'pressure.urgency' | 'pressure.financial' | 'trade';
  old_value: number | string;
  new_value: number | string;
  reason: string;
}

export interface FabricFeedback {
  schema_version: 1;
  loop_id: string;
  iteration: number;
  simulation_id: string;
  previous_iteration_root: string | null;
  generated_specs: string[];
  score_snapshot: FabricScore;
  failed_flows: Array<PlaywrightFailedFlow & { suggested_scenario: string | null }>;
  persona_adjustments: PersonaAdjustment[];
}
