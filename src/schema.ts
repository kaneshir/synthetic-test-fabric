import type Database from 'better-sqlite3';

export const LISA_DB_SCHEMA_VERSION = 7;

/**
 * Idempotent migrations. Each migration is a no-op if its target already exists.
 * Call applyLisaDbMigrations() + assertSchemaVersion() in every process that
 * opens lisa.db so all readers and writers agree on the current schema.
 */
export function applyLisaDbMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version   INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const currentVersion = (): number => {
    const row = db
      .prepare('SELECT MAX(version) as v FROM _schema_version')
      .get() as { v: number | null };
    return row?.v ?? 0;
  };

  // v1 — seeded_entities (pre-existing Lisa schema; keep compatible with current writers/readers)
  if (currentVersion() < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS seeded_entities (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type   TEXT NOT NULL,
        entity_id     TEXT NOT NULL,
        data          TEXT,
        auth_email    TEXT,
        auth_password TEXT,
        seeded_at     TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(entity_type, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_seeded_type ON seeded_entities(entity_type);
      CREATE INDEX IF NOT EXISTS idx_seeded_email ON seeded_entities(auth_email);

      INSERT INTO _schema_version (version) VALUES (1);
    `);
  }

  // v2 — persona_goals + persona_assignments
  if (currentVersion() < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS persona_goals (
        persona_definition_id TEXT NOT NULL PRIMARY KEY,  -- e.g. "maria-chen"
        role                  TEXT NOT NULL,
        goals                 TEXT NOT NULL CHECK (json_valid(goals)),
        constraints           TEXT CHECK (constraints IS NULL OR json_valid(constraints)),
        pressure              TEXT CHECK (pressure IS NULL OR json_valid(pressure))
      );

      CREATE TABLE IF NOT EXISTS persona_assignments (
        simulation_id         TEXT NOT NULL,
        agent_id              TEXT NOT NULL,              -- "s1"
        entity_id             TEXT NOT NULL,              -- application entity ID
        persona_definition_id TEXT NOT NULL,
        role                  TEXT NOT NULL,
        assigned_at           TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (simulation_id, agent_id),
        UNIQUE (simulation_id, entity_id),
        FOREIGN KEY (persona_definition_id) REFERENCES persona_goals(persona_definition_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pa_persona
        ON persona_assignments(persona_definition_id, simulation_id);

      INSERT INTO _schema_version (version) VALUES (2);
    `);
  }

  // v3 — behavior_events (canonical DDL from #1531)
  if (currentVersion() < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS behavior_events (
        event_id              TEXT NOT NULL PRIMARY KEY,
        execution_id          TEXT NOT NULL,
        sequence_in_tick      INTEGER NOT NULL,

        simulation_id         TEXT NOT NULL,
        agent_id              TEXT NOT NULL,
        entity_id             TEXT NOT NULL,
        persona_definition_id TEXT,

        tick                  INTEGER NOT NULL,
        sim_time              TEXT NOT NULL,
        recorded_at           TEXT NOT NULL DEFAULT (datetime('now')),

        action                TEXT NOT NULL,
        reasoning             TEXT,

        event_source          TEXT NOT NULL DEFAULT 'agent'
                              CHECK (event_source IN ('agent','orchestrator','fixture','verify','flow')),
        event_kind            TEXT NOT NULL DEFAULT 'action'
                              CHECK (event_kind IN ('action','decision','fixture_setup','flow_start','flow_end','verify_check')),
        execution_state       TEXT
                              CHECK (execution_state IS NULL OR execution_state IN
                                     ('started','completed','cancelled','failed','fallback')),

        outcome               TEXT NOT NULL
                              CHECK (outcome IN (
                                'success','skipped','blocked','timeout','cancelled','llm_fallback',
                                'error_400','error_401','error_403','error_404',
                                'error_409','error_422','error_429','error_500','error_503',
                                'error_unknown'
                              )),
        outcome_detail        TEXT,

        screen_path           TEXT
                              CHECK (screen_path IS NULL OR (
                                screen_path NOT LIKE '[%' AND
                                length(screen_path) > 0
                              )),
        entity_refs           TEXT
                              CHECK (entity_refs IS NULL OR (
                                json_valid(entity_refs) AND json_type(entity_refs) = 'object'
                              ))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_be_idempotency
        ON behavior_events(execution_id, execution_state)
        WHERE execution_state IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_be_ordering
        ON behavior_events(simulation_id, tick, sequence_in_tick, event_id);

      CREATE INDEX IF NOT EXISTS idx_be_errors
        ON behavior_events(simulation_id, outcome)
        WHERE outcome NOT IN ('success','skipped');

      CREATE INDEX IF NOT EXISTS idx_be_screen
        ON behavior_events(simulation_id, screen_path)
        WHERE screen_path IS NOT NULL;

      INSERT INTO _schema_version (version) VALUES (3);
    `);
  }

  // v4 — reserved for future Phase 1 additions; version bumped to signal all openers are current
  if (currentVersion() < 4) {
    db.exec(`INSERT INTO _schema_version (version) VALUES (4);`);
  }

  // v5 — scenario column on seeded_entities (fabric scenario label per seeker)
  if (currentVersion() < 5) {
    try {
      db.exec(`ALTER TABLE seeded_entities ADD COLUMN scenario TEXT;`);
    } catch (err: any) {
      if (!String(err?.message ?? '').includes('duplicate column name')) throw err;
    }
    db.exec(`INSERT INTO _schema_version (version) VALUES (5);`);
  }

  // v6 — adjusted_pressure on persona_assignments (effective post-adjustment values)
  if (currentVersion() < 6) {
    try {
      db.exec(`ALTER TABLE persona_assignments ADD COLUMN adjusted_pressure TEXT;`);
    } catch (err: any) {
      if (!String(err?.message ?? '').includes('duplicate column name')) throw err;
    }
    db.exec(`INSERT INTO _schema_version (version) VALUES (6);`);
  }

  // v7 — add 'adversarial_probe' to behavior_events.event_kind CHECK constraint.
  // SQLite does not support ALTER CONSTRAINT, so we recreate the table.
  // Wrapped in an explicit transaction so an interrupted rebuild leaves the DB
  // in its pre-v7 state rather than a partially-applied temp/renamed table state.
  if (currentVersion() < 7) {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS behavior_events_v7;

        CREATE TABLE behavior_events_v7 (
          event_id              TEXT NOT NULL PRIMARY KEY,
          execution_id          TEXT NOT NULL,
          sequence_in_tick      INTEGER NOT NULL,

          simulation_id         TEXT NOT NULL,
          agent_id              TEXT NOT NULL,
          entity_id             TEXT NOT NULL,
          persona_definition_id TEXT,

          tick                  INTEGER NOT NULL,
          sim_time              TEXT NOT NULL,
          recorded_at           TEXT NOT NULL DEFAULT (datetime('now')),

          action                TEXT NOT NULL,
          reasoning             TEXT,

          event_source          TEXT NOT NULL DEFAULT 'agent'
                                CHECK (event_source IN ('agent','orchestrator','fixture','verify','flow')),
          event_kind            TEXT NOT NULL DEFAULT 'action'
                                CHECK (event_kind IN (
                                  'action','decision','fixture_setup',
                                  'flow_start','flow_end','verify_check','adversarial_probe'
                                )),
          execution_state       TEXT
                                CHECK (execution_state IS NULL OR execution_state IN
                                       ('started','completed','cancelled','failed','fallback')),

          outcome               TEXT NOT NULL
                                CHECK (outcome IN (
                                  'success','skipped','blocked','timeout','cancelled','llm_fallback',
                                  'error_400','error_401','error_403','error_404',
                                  'error_409','error_422','error_429','error_500','error_503',
                                  'error_unknown'
                                )),
          outcome_detail        TEXT,

          screen_path           TEXT
                                CHECK (screen_path IS NULL OR (
                                  screen_path NOT LIKE '[%' AND
                                  length(screen_path) > 0
                                )),
          entity_refs           TEXT
                                CHECK (entity_refs IS NULL OR (
                                  json_valid(entity_refs) AND json_type(entity_refs) = 'object'
                                ))
        );

        INSERT INTO behavior_events_v7 SELECT * FROM behavior_events;
        DROP TABLE behavior_events;
        ALTER TABLE behavior_events_v7 RENAME TO behavior_events;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_be_idempotency
          ON behavior_events(execution_id, execution_state)
          WHERE execution_state IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_be_ordering
          ON behavior_events(simulation_id, tick, sequence_in_tick, event_id);

        CREATE INDEX IF NOT EXISTS idx_be_errors
          ON behavior_events(simulation_id, outcome)
          WHERE outcome NOT IN ('success','skipped');

        CREATE INDEX IF NOT EXISTS idx_be_screen
          ON behavior_events(simulation_id, screen_path)
          WHERE screen_path IS NOT NULL;

        INSERT INTO _schema_version (version) VALUES (7);
      `);
    })();
  }
}

export function assertSchemaVersion(db: Database.Database, expected: number): void {
  const row = db
    .prepare('SELECT MAX(version) as v FROM _schema_version')
    .get() as { v: number | null };
  const actual = row?.v ?? 0;
  if (actual !== expected) {
    throw new Error(
      `lisa.db schema mismatch: expected v${expected}, found v${actual}. ` +
      `Run the fabric migration for this run root, or delete and reseed.`
    );
  }
}
