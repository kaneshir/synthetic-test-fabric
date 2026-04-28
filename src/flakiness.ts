import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function applyFlakinessDbMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS flow_flakiness (
      flow_name    TEXT    NOT NULL PRIMARY KEY,
      passed       INTEGER NOT NULL DEFAULT 0,
      failed       INTEGER NOT NULL DEFAULT 0,
      total        INTEGER NOT NULL DEFAULT 0,
      failure_rate REAL    NOT NULL DEFAULT 0.0,
      last_updated TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlakinessSummary {
  flowName: string;
  failureRate: number;
  passed: number;
  failed: number;
  total: number;
  quarantined: boolean;
}

// ---------------------------------------------------------------------------
// FlakinessTracker
// ---------------------------------------------------------------------------

/**
 * Persists per-flow pass/fail history in <loopRoot>/flakiness.db across
 * iterations and loop runs. Used by:
 *
 * - FabricOrchestrator: records results after each TEST phase
 * - ScoringAdapter: reads quarantine list so flaky flows don't tank the score
 * - Reporter: surfaces top-N flaky flows in the console/CI summary
 *
 * The quarantine threshold (default 0.20) means a flow that fails more than
 * 20% of the time is excluded from the regression health dimension.
 */
export class FlakinessTracker {
  static readonly DEFAULT_QUARANTINE_THRESHOLD = 0.2;
  static readonly DEFAULT_MIN_RUNS = 3;

  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    applyFlakinessDbMigrations(this.db);
  }

  /**
   * Record results from a single TEST phase run.
   * `results` is a map of flowName → passed (true) | failed (false).
   */
  record(results: Record<string, boolean>): void {
    const upsert = this.db.prepare(`
      INSERT INTO flow_flakiness (flow_name, passed, failed, total, failure_rate, last_updated)
        VALUES (@flow_name, @p, @f, @t, @r, datetime('now'))
      ON CONFLICT(flow_name) DO UPDATE SET
        passed       = passed + @p,
        failed       = failed + @f,
        total        = total  + @t,
        failure_rate = CAST(failed + @f AS REAL) / (total + @t),
        last_updated = datetime('now')
    `);

    const tx = this.db.transaction((entries: [string, boolean][]) => {
      for (const [name, passed] of entries) {
        upsert.run({
          flow_name: name,
          p: passed ? 1 : 0,
          f: passed ? 0 : 1,
          t: 1,
          r: passed ? 0 : 1,
        });
      }
    });

    tx(Object.entries(results));
  }

  /**
   * Returns flow names that are quarantined (failure_rate > threshold AND
   * total runs >= minRuns). Quarantined flows are excluded from regression scoring.
   */
  getQuarantined(
    threshold = FlakinessTracker.DEFAULT_QUARANTINE_THRESHOLD,
    minRuns   = FlakinessTracker.DEFAULT_MIN_RUNS,
  ): string[] {
    const rows = this.db.prepare(`
      SELECT flow_name FROM flow_flakiness
      WHERE failure_rate > ? AND total >= ?
    `).all(threshold, minRuns) as { flow_name: string }[];
    return rows.map((r) => r.flow_name);
  }

  /**
   * Returns the top-N flakiest flows for reporting.
   */
  getTopFlaky(
    n = 5,
    threshold = FlakinessTracker.DEFAULT_QUARANTINE_THRESHOLD,
    minRuns   = FlakinessTracker.DEFAULT_MIN_RUNS,
  ): FlakinessSummary[] {
    const rows = this.db.prepare(`
      SELECT flow_name, passed, failed, total, failure_rate
      FROM flow_flakiness
      WHERE total >= ?
      ORDER BY failure_rate DESC
      LIMIT ?
    `).all(minRuns, n) as {
      flow_name: string; passed: number; failed: number;
      total: number; failure_rate: number;
    }[];

    return rows.map((r) => ({
      flowName:    r.flow_name,
      failureRate: r.failure_rate,
      passed:      r.passed,
      failed:      r.failed,
      total:       r.total,
      quarantined: r.failure_rate > threshold,
    }));
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

/**
 * Retry an async operation with exponential backoff + jitter.
 * Used by adapters that want to retry flaky browser flows before recording
 * a failure in the flakiness tracker.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    baseDelayMs?: number;
    jitterMs?: number;
  } = {},
): Promise<T> {
  const retries    = options.retries    ?? 3;
  const baseDelay  = options.baseDelayMs ?? 500;
  const jitter     = options.jitterMs    ?? 300;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * jitter;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
