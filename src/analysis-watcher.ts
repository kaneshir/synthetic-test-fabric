import { EventEmitter } from 'events';
import * as fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BetterSqlite3 = require('better-sqlite3');

export interface NewPathEvent {
  screen_path: string;
  discovered_count: number;
  simulation_id: string;
}

export interface ErrorSpikeEvent {
  error_rate: number;
  tick: number;
  simulation_id: string;
}

export interface TickCompleteEvent {
  tick: number;
  eventCount: number;
}

interface PathRow {
  screen_path: string;
  cnt: number;
}

interface TickRow {
  max_tick: number | null;
}

interface CountRow {
  c: number;
}

export class AnalysisWatcher extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeenEventCount = -1;
  private lastEmittedTick = -1;
  private knownPaths: Set<string>;
  private stopped = false;
  private stopResolve: (() => void) | null = null;

  constructor(
    private readonly lisaDbPath: string,
    private readonly simulationId: string,
    private readonly options: {
      pollIntervalMs?: number;
      errorRateThreshold?: number;
      existingFlowPaths?: Set<string>;
    } = {},
  ) {
    super();
    this.knownPaths = options.existingFlowPaths ?? new Set();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.options.pollIntervalMs ?? 10_000);
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.stopResolve = resolve;
      this.stopped = true;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      // Final poll before shutting down
      this.poll().finally(() => {
        this.stopResolve?.();
        this.stopResolve = null;
      });
    });
  }

  private async poll(): Promise<void> {
    if (!fs.existsSync(this.lisaDbPath)) return;

    let db: ReturnType<typeof BetterSqlite3> | null = null;
    try {
      db = new BetterSqlite3(this.lisaDbPath, { readonly: true });

      const eventCount = (
        db
          .prepare('SELECT COUNT(*) as c FROM behavior_events WHERE simulation_id = ?')
          .get(this.simulationId) as CountRow
      ).c;

      // Gate on total event count, not tick, to catch late-flushed events within the same tick
      if (eventCount <= this.lastSeenEventCount) return;
      this.lastSeenEventCount = eventCount;

      const tickRow = db
        .prepare('SELECT MAX(tick) as max_tick FROM behavior_events WHERE simulation_id = ?')
        .get(this.simulationId) as TickRow;

      const currentTick = tickRow?.max_tick ?? -1;
      if (currentTick > this.lastEmittedTick) {
        this.lastEmittedTick = currentTick;
        this.emit('tick_complete', { tick: currentTick, eventCount } satisfies TickCompleteEvent);
      }

      // New path detection
      const pathRows = db
        .prepare(
          `SELECT screen_path, COUNT(*) as cnt
           FROM behavior_events
           WHERE simulation_id = ? AND screen_path IS NOT NULL AND screen_path != ''
           GROUP BY screen_path`,
        )
        .all(this.simulationId) as PathRow[];

      for (const row of pathRows) {
        if (!this.knownPaths.has(row.screen_path)) {
          this.knownPaths.add(row.screen_path);
          this.emit('new_path', {
            screen_path: row.screen_path,
            discovered_count: row.cnt,
            simulation_id: this.simulationId,
          } satisfies NewPathEvent);
        }
      }

      // Error spike detection
      const errorThreshold = this.options.errorRateThreshold ?? 0.2;
      const errorCount = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM behavior_events
             WHERE simulation_id = ? AND tick = ?
             AND outcome NOT IN ('success','skipped','llm_fallback')`,
          )
          .get(this.simulationId, currentTick) as CountRow
      ).c;

      const tickCount = (
        db
          .prepare(
            'SELECT COUNT(*) as c FROM behavior_events WHERE simulation_id = ? AND tick = ?',
          )
          .get(this.simulationId, currentTick) as CountRow
      ).c;

      if (tickCount > 0 && errorCount / tickCount > errorThreshold) {
        this.emit('error_spike', {
          error_rate: errorCount / tickCount,
          tick: currentTick,
          simulation_id: this.simulationId,
        } satisfies ErrorSpikeEvent);
      }
    } catch (err) {
      this.emit('error', err);
    } finally {
      db?.close();
    }
  }
}
