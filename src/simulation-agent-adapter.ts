import { randomUUID } from 'crypto';
import type { BehaviorEventRecorder } from './recorder';
import type { PersonaDefinition } from './persona-definition';
import type {
  SimulationAgent,
  AgentState,
  MarketContext,
  AgentDecision,
  ActionOutcome,
} from './simulation-agent.interface';
import { classifyOutcome } from './outcomes';
import { normalizeScreenPath } from './screen-path';

/**
 * Injected externally at construction time — the adapter never reads properties
 * from BaseAgent directly. BaseAgent is abstract void; these values come from
 * the orchestrator that spawns the agent.
 */
export interface AgentMetadata {
  agentId: string;
  entityId: string;
  role: string;
  simulationId: string;
}

/**
 * Minimal duck-type interface for agent integrations. Any class with these two
 * methods works.
 */
interface BaseAgentLike {
  decideNextAction(simulatedTime: Date): Promise<string>;
  executeAction(simulatedTime: Date): Promise<void>;
}

/**
 * SimulationAgentAdapter wraps an existing BaseAgent-derived class to implement
 * SimulationAgent without modifying BaseAgent. All identity metadata is injected
 * externally — the adapter does not read properties from the wrapped agent.
 *
 * Phase 1: delegates to existing rule-engine; reasoning and goal_refs are null/empty.
 * Phase 2: LLM populates reasoning and goal_refs via #1521 two-phase decision.
 */
export class SimulationAgentAdapter implements SimulationAgent {
  constructor(
    private readonly agent: BaseAgentLike,
    private readonly metadata: AgentMetadata,
    private readonly personaDefinition: PersonaDefinition,
    private readonly recorder: BehaviorEventRecorder,
  ) {}

  get persona(): PersonaDefinition {
    return this.personaDefinition;
  }

  get role(): string {
    return this.metadata.role;
  }

  async decideNextAction(state: AgentState, _context: MarketContext): Promise<AgentDecision> {
    const action = await this.agent.decideNextAction(state.simulatedTime);
    return {
      action,
      reasoning: null,   // Phase 2: LLM populates
      goal_refs: [],     // Phase 2: structured goal references
      confidence: 1.0,
    };
  }

  async executeAction(decision: AgentDecision, state: AgentState): Promise<ActionOutcome> {
    const executionId = randomUUID();
    let executionState: 'completed' | 'failed' = 'completed';
    let outcome = 'success' as const;
    let outcomeDetail: string | undefined;
    let thrownError: unknown;

    try {
      await this.agent.executeAction(state.simulatedTime);
    } catch (error: unknown) {
      executionState = 'failed';
      outcome = classifyOutcome(error) as typeof outcome;
      outcomeDetail = error instanceof Error ? error.message : String(error);
      thrownError = error;
    } finally {
      this.recorder.record({
        execution_id: executionId,
        simulation_id: this.metadata.simulationId,
        agent_id: this.metadata.agentId,
        entity_id: this.metadata.entityId,
        persona_definition_id: this.personaDefinition.id,
        tick: state.tick,
        sim_time: state.simulatedTime.toISOString(),
        action: decision.action,
        reasoning: null,       // Phase 2
        event_source: 'agent',
        event_kind: 'action',
        execution_state: executionState,
        outcome: executionState === 'completed' ? 'success' : classifyOutcome(thrownError),
        outcome_detail: outcomeDetail ?? null,
        screen_path: normalizeScreenPath(
          decision.params?.screenPath as string | string[] | null | undefined
        ),
        entity_refs: decision.params?.entityRefs
          ? JSON.stringify(decision.params.entityRefs)
          : null,
      });
    }

    if (thrownError !== undefined) throw thrownError;

    return { success: true };
  }
}
