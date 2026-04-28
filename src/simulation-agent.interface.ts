import type { PersonaDefinition } from './persona-definition';

export interface AgentState {
  tick: number;
  simulatedTime: Date;
  availableJobs?: unknown[];
  applications?: unknown[];
  messageThreads?: unknown[];
  [key: string]: unknown;
}

export interface MarketContext {
  marketSummary: string;
  demandLevel: 'low' | 'medium' | 'high';
  [key: string]: unknown;
}

export interface AgentDecision {
  action: string;
  reasoning: string | null;
  goal_refs: number[];
  confidence: number;
  params?: Record<string, unknown>;
}

export interface ActionOutcome {
  success: boolean;
  httpStatus?: number;
  errorCode?: string;
  entityRefs?: Record<string, string>;
  screenPath?: string | null;
  detail?: string;
}

export interface SimulationAgent {
  readonly persona: PersonaDefinition;
  readonly role: string;

  decideNextAction(state: AgentState, context: MarketContext): Promise<AgentDecision>;
  executeAction(decision: AgentDecision, state: AgentState): Promise<ActionOutcome>;
  onRunStart?(simulationId: string): Promise<void>;
  onRunEnd?(simulationId: string): Promise<void>;
}
