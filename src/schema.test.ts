import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import BetterSqlite3 from 'better-sqlite3';
import {
  applyLisaDbMigrations,
  assertSchemaVersion,
  LISA_DB_SCHEMA_VERSION,
} from './schema';
import { BehaviorEventRecorder } from './recorder';
import { BEHAVIOR_OUTCOMES } from './outcomes';

function tempDb(): { db: ReturnType<typeof BetterSqlite3>; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  const dbPath = path.join(dir, 'lisa.db');
  const db = new BetterSqlite3(dbPath);
  return { db, dbPath };
}

afterEach(() => {
  BehaviorEventRecorder.reset();
});

describe('applyLisaDbMigrations', () => {
  it('creates all required tables on a fresh DB', () => {
    const { db } = tempDb();
    applyLisaDbMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain('_schema_version');
    expect(tables).toContain('seeded_entities');
    expect(tables).toContain('persona_goals');
    expect(tables).toContain('persona_assignments');
    expect(tables).toContain('behavior_events');
  });

  it('is idempotent — running twice does not error', () => {
    const { db } = tempDb();
    applyLisaDbMigrations(db);
    expect(() => applyLisaDbMigrations(db)).not.toThrow();
  });

  it('sets _schema_version to LISA_DB_SCHEMA_VERSION after migration', () => {
    const { db } = tempDb();
    applyLisaDbMigrations(db);
    assertSchemaVersion(db, LISA_DB_SCHEMA_VERSION);
  });

  it('assertSchemaVersion throws on stale DB', () => {
    const { db } = tempDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO _schema_version (version) VALUES (1);
    `);
    expect(() => assertSchemaVersion(db, LISA_DB_SCHEMA_VERSION)).toThrow(/schema mismatch/);
  });

  it('v5 migration adds scenario column to seeded_entities', () => {
    const { db } = tempDb();
    applyLisaDbMigrations(db);

    // Assert scenario column exists by inserting a row with a scenario value
    expect(() => {
      db.exec(`
        INSERT INTO seeded_entities (entity_type, entity_id, data, auth_email, auth_password, seeded_at, scenario)
        VALUES ('seeker_account', 'uid-scenario-test', '{}', 'test@example.com', 'pass123', datetime('now'), 'active_applicant');
      `);
    }).not.toThrow();

    const row = db
      .prepare("SELECT scenario FROM seeded_entities WHERE entity_id = 'uid-scenario-test'")
      .get() as any;
    expect(row).toBeTruthy();
    expect(row.scenario).toBe('active_applicant');
  });

  it('v6 migration adds adjusted_pressure column to persona_assignments', () => {
    const { db } = tempDb();
    applyLisaDbMigrations(db);

    // Assert schema is at current version (column was added in v6, still present)
    assertSchemaVersion(db, LISA_DB_SCHEMA_VERSION);

    // Insert a persona_assignments row with an adjusted_pressure JSON value
    db.exec(`
      INSERT INTO persona_goals (persona_definition_id, role, goals, constraints, pressure)
      VALUES ('persona-test', 'seeker', '[]', '[]', '{"urgency":0.5}');
    `);
    expect(() => {
      db.exec(`
        INSERT INTO persona_assignments (simulation_id, agent_id, entity_id, persona_definition_id, role, adjusted_pressure)
        VALUES ('sim-test', 's1', 'uid-test', 'persona-test', 'seeker', '{"urgency":0.65,"financial":0.6}');
      `);
    }).not.toThrow();

    const row = db
      .prepare("SELECT adjusted_pressure FROM persona_assignments WHERE agent_id = 's1'")
      .get() as any;
    expect(row).toBeTruthy();
    const parsed = JSON.parse(row.adjusted_pressure);
    expect(parsed.urgency).toBeCloseTo(0.65);
    expect(parsed.financial).toBeCloseTo(0.6);

    // NULL adjusted_pressure (no adjustments applied) must also be accepted
    db.exec(`
      INSERT INTO persona_assignments (simulation_id, agent_id, entity_id, persona_definition_id, role, adjusted_pressure)
      VALUES ('sim-test', 's2', 'uid-test2', 'persona-test', 'seeker', NULL);
    `);
    const row2 = db
      .prepare("SELECT adjusted_pressure FROM persona_assignments WHERE agent_id = 's2'")
      .get() as any;
    expect(row2.adjusted_pressure).toBeNull();
  });

  it('v7 migration — existing rows and indexes survive the table rebuild', () => {
    const { db } = tempDb();
    // Apply only through v6 by patching version tracking, then insert a row,
    // then complete the migration — verifying the copy path with real data.
    applyLisaDbMigrations(db);

    // Manually roll back to v6 so we can re-run v7 in isolation
    db.exec(`DELETE FROM _schema_version WHERE version = 7;`);
    // Re-insert a known row using the pre-v7 table (still intact after rollback)
    db.exec(`
      INSERT INTO behavior_events (
        event_id, execution_id, sequence_in_tick,
        simulation_id, agent_id, entity_id, persona_definition_id,
        tick, sim_time, recorded_at,
        action, reasoning, event_source, event_kind, execution_state,
        outcome, outcome_detail, screen_path, entity_refs
      ) VALUES (
        'evt-preserve-1', 'exec-preserve-1', 0,
        'sim-preserve', 's1', 'entity-1', NULL,
        1, datetime('now'), datetime('now'),
        'existing action', NULL, 'agent', 'action', 'completed',
        'success', NULL, NULL, NULL
      );
    `);

    // Now run v7
    applyLisaDbMigrations(db);
    assertSchemaVersion(db, LISA_DB_SCHEMA_VERSION);

    // Row survived the copy
    const row = db
      .prepare("SELECT event_id, event_kind FROM behavior_events WHERE event_id = 'evt-preserve-1'")
      .get() as any;
    expect(row).toBeTruthy();
    expect(row.event_kind).toBe('action');

    // Indexes still exist
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='behavior_events'")
      .all()
      .map((r: any) => r.name);
    expect(indexes).toContain('idx_be_idempotency');
    expect(indexes).toContain('idx_be_ordering');
    expect(indexes).toContain('idx_be_errors');
    expect(indexes).toContain('idx_be_screen');
  });

  it('v7 migration — adversarial_probe is accepted as event_kind', () => {
    const { db, dbPath } = tempDb();
    applyLisaDbMigrations(db);
    assertSchemaVersion(db, LISA_DB_SCHEMA_VERSION);

    const recorder = BehaviorEventRecorder.getInstance(dbPath, 'simulation');
    expect(() => {
      recorder.record({
        execution_id: 'exec-adversarial-1',
        simulation_id: 'sim-v7-test',
        agent_id: 's1',
        entity_id: 'entity-1',
        persona_definition_id: null,
        tick: 0,
        sim_time: new Date().toISOString(),
        action: 'probe attempt',
        reasoning: null,
        event_source: 'agent',
        event_kind: 'adversarial_probe',
        execution_state: 'completed',
        outcome: BEHAVIOR_OUTCOMES.SUCCESS,
        outcome_detail: null,
        screen_path: null,
        entity_refs: null,
      });
      recorder.flush();
    }).not.toThrow();

    const row = db
      .prepare("SELECT event_kind FROM behavior_events WHERE simulation_id = 'sim-v7-test'")
      .get() as any;
    expect(row?.event_kind).toBe('adversarial_probe');
  });

  it('accepts app-defined persona roles', () => {
    const { db } = tempDb();
    applyLisaDbMigrations(db);

    expect(() => {
      db.exec(`
        INSERT INTO persona_goals (persona_definition_id, role, goals, constraints, pressure)
        VALUES ('admin-persona', 'admin', '[]', '[]', '{"urgency":0.5}');

        INSERT INTO persona_assignments (simulation_id, agent_id, entity_id, persona_definition_id, role)
        VALUES ('sim-custom-role', 'a1', 'entity-1', 'admin-persona', 'admin');
      `);
    }).not.toThrow();
  });

  it('migrations are idempotent — running twice on a fully migrated DB does not throw', () => {
    const { db } = tempDb();
    applyLisaDbMigrations(db);
    expect(() => applyLisaDbMigrations(db)).not.toThrow();
  });

  it('round-robin scenario assignment: 10 seekers get all non-null, >= 3 distinct values', () => {
    const { db } = tempDb();
    applyLisaDbMigrations(db);

    const SEEKER_SCENARIOS = [
      'active_applicant',
      'passive_browser',
      'interview_today',
      'offer_pending',
      'profile_incomplete',
    ] as const;

    const insert = db.prepare(`
      INSERT INTO seeded_entities (entity_type, entity_id, seeded_at, scenario)
      VALUES (?, ?, datetime('now'), ?)
    `);

    const insertMany = db.transaction(() => {
      for (let i = 0; i < 10; i++) {
        const scenario = SEEKER_SCENARIOS[i % SEEKER_SCENARIOS.length];
        insert.run('seeker_account', `uid-seeker-${i}`, scenario);
      }
      // Also add a non-seeker to confirm scenario stays null for other types
      insert.run('employer_account', 'uid-employer-0', null);
    });
    insertMany();

    const row = db.prepare(`
      SELECT
        COUNT(*)                 AS totalSeekers,
        COUNT(scenario)          AS nonNullCount,
        COUNT(DISTINCT scenario) AS distinctCount
      FROM seeded_entities
      WHERE entity_type = 'seeker_account'
    `).get() as { totalSeekers: number; nonNullCount: number; distinctCount: number };

    expect(row.totalSeekers).toBe(10);
    expect(row.nonNullCount).toBe(10);     // every seeker has a scenario
    expect(row.distinctCount).toBeGreaterThanOrEqual(3); // round-robin cycles through values

    // Employer row must have null scenario
    const emp = db.prepare(`SELECT scenario FROM seeded_entities WHERE entity_type = 'employer_account'`).get() as any;
    expect(emp.scenario).toBeNull();
  });
});

describe('BehaviorEventRecorder', () => {
  it('records an event and it appears in behavior_events', () => {
    const { db, dbPath } = tempDb();
    applyLisaDbMigrations(db);
    db.close();

    const recorder = BehaviorEventRecorder.getInstance(dbPath, 'fabric');
    recorder.record({
      execution_id: 'exec-1',
      simulation_id: 'sim-abc',
      agent_id: 's1',
      entity_id: 'uid-123',
      persona_definition_id: 'maria-chen',
      tick: 1,
      sim_time: new Date().toISOString(),
      action: 'browse_jobs',
      reasoning: null,
      event_source: 'agent',
      event_kind: 'action',
      execution_state: 'completed',
      outcome: BEHAVIOR_OUTCOMES.SUCCESS,
      outcome_detail: null,
      screen_path: 'seeker/jobs',
      entity_refs: null,
    });
    recorder.flush();

    const check = new BetterSqlite3(dbPath, { readonly: true });
    const row = check
      .prepare('SELECT * FROM behavior_events WHERE simulation_id = ?')
      .get('sim-abc') as any;
    check.close();

    expect(row).toBeTruthy();
    expect(row.agent_id).toBe('s1');
    expect(row.action).toBe('browse_jobs');
    expect(row.screen_path).toBe('seeker/jobs');
    expect(row.outcome).toBe('success');
  });

  it('INSERT OR IGNORE makes duplicate records no-ops', () => {
    const { db, dbPath } = tempDb();
    applyLisaDbMigrations(db);
    db.close();

    const recorder = BehaviorEventRecorder.getInstance(dbPath, 'fabric');
    const base = {
      execution_id: 'exec-dedup',
      simulation_id: 'sim-dedup',
      agent_id: 's1',
      entity_id: 'uid-1',
      persona_definition_id: null,
      tick: 1,
      sim_time: new Date().toISOString(),
      action: 'browse_jobs',
      reasoning: null,
      event_source: 'agent' as const,
      event_kind: 'action' as const,
      execution_state: 'completed' as const,
      outcome: BEHAVIOR_OUTCOMES.SUCCESS,
      outcome_detail: null,
      screen_path: null,
      entity_refs: null,
    };
    recorder.record(base);
    recorder.flush();
    recorder.record(base);
    recorder.flush();

    const check = new BetterSqlite3(dbPath, { readonly: true });
    const count = (
      check
        .prepare("SELECT COUNT(*) as c FROM behavior_events WHERE execution_id = 'exec-dedup' AND execution_state = 'completed'")
        .get() as any
    ).c;
    check.close();
    expect(count).toBe(1);
  });

  it('screen_path CHECK rejects JSON array strings via recorder (fail-closed)', () => {
    // Verifies INSERT OR IGNORE → plain INSERT fix: CHECK violations must propagate,
    // not be silently swallowed as idempotency no-ops.
    const { db, dbPath } = tempDb();
    applyLisaDbMigrations(db);
    db.close();

    const recorder = BehaviorEventRecorder.getInstance(dbPath, 'fabric');
    expect(() => {
      recorder.record({
        execution_id: 'exec-check',
        simulation_id: 'sim-check',
        agent_id: 's1',
        entity_id: 'u1',
        persona_definition_id: null,
        tick: 1,
        sim_time: new Date().toISOString(),
        action: 'browse',
        reasoning: null,
        event_source: 'agent',
        event_kind: 'action',
        execution_state: 'completed',
        outcome: BEHAVIOR_OUTCOMES.SUCCESS,
        outcome_detail: null,
        screen_path: '["jobs","detail"]',  // JSON array string — CHECK rejects this
        entity_refs: null,
      });
      recorder.flush();  // flush throws in fabric mode because INSERT throws
    }).toThrow();
  });

  it('idempotency: recording same execution_id+execution_state twice writes one row (not two)', () => {
    // Verifies plain INSERT + SQLITE_CONSTRAINT_UNIQUE catch still provides idempotency.
    const { db, dbPath } = tempDb();
    applyLisaDbMigrations(db);
    db.close();

    const recorder = BehaviorEventRecorder.getInstance(dbPath, 'fabric');
    const input = {
      execution_id: 'exec-idem',
      simulation_id: 'sim-idem',
      agent_id: 's1',
      entity_id: 'u1',
      persona_definition_id: null,
      tick: 1,
      sim_time: new Date().toISOString(),
      action: 'browse_jobs',
      reasoning: null,
      event_source: 'agent' as const,
      event_kind: 'action' as const,
      execution_state: 'completed' as const,
      outcome: BEHAVIOR_OUTCOMES.SUCCESS,
      outcome_detail: null,
      screen_path: null,
      entity_refs: null,
    };
    recorder.record(input);
    recorder.flush();
    // Second record with same execution_id + execution_state — should be a no-op
    expect(() => {
      recorder.record(input);
      recorder.flush();
    }).not.toThrow();

    const check = new BetterSqlite3(dbPath, { readonly: true });
    const count = (
      check
        .prepare("SELECT COUNT(*) as c FROM behavior_events WHERE execution_id = 'exec-idem' AND execution_state = 'completed'")
        .get() as any
    ).c;
    check.close();
    expect(count).toBe(1);
  });

  it('simulation_id guard throws in fabric mode', () => {
    const { db, dbPath } = tempDb();
    applyLisaDbMigrations(db);
    db.close();

    const recorder = BehaviorEventRecorder.getInstance(dbPath, 'fabric');
    expect(() => recorder.record({
      execution_id: 'exec-1',
      simulation_id: '',        // empty — must throw in fabric mode
      agent_id: 's1',
      entity_id: 'u1',
      persona_definition_id: null,
      tick: 1,
      sim_time: new Date().toISOString(),
      action: 'test',
      reasoning: null,
      event_source: 'agent',
      event_kind: 'action',
      execution_state: 'completed',
      outcome: BEHAVIOR_OUTCOMES.SUCCESS,
      outcome_detail: null,
      screen_path: null,
      entity_refs: null,
    })).toThrow(/simulation_id is required/);
  });
});
