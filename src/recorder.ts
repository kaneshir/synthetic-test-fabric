import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { BehaviorOutcome } from './outcomes';

export interface BehaviorEvent {
  event_id: string;
  execution_id: string;
  sequence_in_tick: number;
  simulation_id: string;
  agent_id: string;
  entity_id: string;
  persona_definition_id: string | null;
  tick: number;
  sim_time: string;
  recorded_at: string;
  action: string;
  reasoning: string | null;
  event_source: 'agent' | 'orchestrator' | 'fixture' | 'verify' | 'flow';
  event_kind: 'action' | 'decision' | 'fixture_setup' | 'flow_start' | 'flow_end' | 'verify_check' | 'adversarial_probe';
  execution_state: 'started' | 'completed' | 'cancelled' | 'failed' | 'fallback' | null;
  outcome: BehaviorOutcome;
  outcome_detail: string | null;
  screen_path: string | null;
  entity_refs: string | null;
}

// Callers never set these — the recorder assigns them.
export type RecorderInput = Omit<BehaviorEvent, 'event_id' | 'sequence_in_tick' | 'recorded_at'>;

const INSERT_SQL = `
  INSERT INTO behavior_events (
    event_id, execution_id, sequence_in_tick,
    simulation_id, agent_id, entity_id, persona_definition_id,
    tick, sim_time, recorded_at,
    action, reasoning,
    event_source, event_kind, execution_state,
    outcome, outcome_detail,
    screen_path, entity_refs
  ) VALUES (
    @event_id, @execution_id, @sequence_in_tick,
    @simulation_id, @agent_id, @entity_id, @persona_definition_id,
    @tick, @sim_time, @recorded_at,
    @action, @reasoning,
    @event_source, @event_kind, @execution_state,
    @outcome, @outcome_detail,
    @screen_path, @entity_refs
  )
`;

export class BehaviorEventRecorder {
  private static _instances = new Map<string, BehaviorEventRecorder>();

  private readonly db: Database.Database;
  private readonly mode: 'fabric' | 'simulation';
  private readonly sequenceCounters = new Map<string, number>();
  private queue: BehaviorEvent[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;
  private droppedCount = 0;

  private constructor(dbPath: string, mode: 'fabric' | 'simulation') {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.mode = mode;
  }

  static getInstance(dbPath: string, mode: 'fabric' | 'simulation'): BehaviorEventRecorder {
    const key = `${dbPath}:${mode}`;
    if (!BehaviorEventRecorder._instances.has(key)) {
      BehaviorEventRecorder._instances.set(key, new BehaviorEventRecorder(dbPath, mode));
    }
    return BehaviorEventRecorder._instances.get(key)!;
  }

  /** Reset all recorders — used in tests and between runs. */
  static reset(): void {
    Array.from(BehaviorEventRecorder._instances.values()).forEach(inst => {
      inst.flush();
      inst.db.close();
    });
    BehaviorEventRecorder._instances.clear();
  }

  record(input: RecorderInput): void {
    if (!input.simulation_id?.trim()) {
      const msg = '[recorder] simulation_id is required — is LISA_SIMULATION_ID set in ENV?';
      if (this.mode === 'fabric') throw new Error(msg);
      console.warn(msg);
      this.droppedCount++;
      return;
    }

    const key = `${input.simulation_id}:${input.tick}`;
    const seq = this.sequenceCounters.get(key) ?? 0;
    this.sequenceCounters.set(key, seq + 1);

    const event: BehaviorEvent = {
      ...input,
      event_id: randomUUID(),
      sequence_in_tick: seq,
      recorded_at: new Date().toISOString(),
    };

    try {
      this.enqueue(event);
    } catch (err) {
      if (this.mode === 'fabric') {
        throw new Error(`[recorder] Fatal write failure for event ${event.event_id}: ${err}`);
      }
      console.warn(`[recorder] Dropped event ${event.event_id}: ${err}`);
      this.droppedCount++;
    }
  }

  private enqueue(event: BehaviorEvent): void {
    this.queue.push(event);
    if (this.queue.length >= 50) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 100);
    }
  }

  flush(): void {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0);
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;

    const stmt = this.db.prepare(INSERT_SQL);
    const tx = this.db.transaction((events: BehaviorEvent[]) => {
      for (const e of events) {
        this.writeWithRetry(stmt, e);
      }
    });
    tx(batch);
  }

  private writeWithRetry(stmt: Database.Statement, event: BehaviorEvent, maxRetries = 3): void {
    const params = {
      ...event,
      execution_state: event.execution_state ?? null,
      persona_definition_id: event.persona_definition_id ?? null,
      reasoning: event.reasoning ?? null,
      outcome_detail: event.outcome_detail ?? null,
      screen_path: event.screen_path ?? null,
      entity_refs: event.entity_refs ?? null,
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        stmt.run(params);
        return;
      } catch (err: any) {
        if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          // Idempotency: same (execution_id, execution_state) already recorded — not an error.
          // Only this constraint is silenced; CHECK and NOT NULL violations still propagate.
          return;
        }
        if (err?.code === 'SQLITE_BUSY' && attempt < maxRetries) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
  }

  get dropped(): number {
    return this.droppedCount;
  }
}
