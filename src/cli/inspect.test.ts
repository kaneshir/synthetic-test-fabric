// Integration tests for `fab inspect` and the inspectRunRoot() library export.
// Covers the AC scenarios from #20:
//  - root-kind auto-detection (loop vs iteration)
//  - explicit --kind override on ambiguous paths
//  - typed errors (AmbiguousRootError, UnknownRootError)
//  - behavior events read from .lisa_memory/lisa.db
//  - partial summary on empty / missing-artifact roots

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import BetterSqlite3 from 'better-sqlite3';

import { runFab, parseSingleEnvelope } from './__test-helpers__/cli-runner';
import {
  inspectRunRoot,
  AmbiguousRootError,
  UnknownRootError,
} from '../run-root';
import { applyLisaDbMigrations } from '../schema';

const STUB_CONFIG = path.resolve(__dirname, '__test-helpers__/fixtures/stub.config.ts');

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fab-inspect-${prefix}-`));
}

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fab-state-test-'));
}

function writeScore(iter: string, overall: number): void {
  fs.mkdirSync(iter, { recursive: true });
  fs.writeFileSync(path.join(iter, 'fabric-score.json'), JSON.stringify({
    simulationId: 'sim-x', generatedAt: '2026-01-01T00:00:00Z',
    overall,
    dimensions: { coverage_delta: 0.7, regression_health: 0.95 },
    details: {},
  }));
}

function writeFlowResults(iter: string, expected: number, unexpected = 0): void {
  fs.mkdirSync(iter, { recursive: true });
  fs.writeFileSync(path.join(iter, 'flow-results.json'), JSON.stringify({
    stats: { expected, unexpected, flaky: 0 }, suites: [],
  }));
}

function seedBehaviorEvents(iter: string, count: number): void {
  const dbDir = path.join(iter, '.lisa_memory');
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new BetterSqlite3(path.join(dbDir, 'lisa.db'));
  applyLisaDbMigrations(db);
  const stmt = db.prepare(`
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
      @simulation_id, @agent_id, @entity_id, NULL,
      @tick, @sim_time, @recorded_at,
      @action, NULL,
      'agent', 'action', NULL,
      @outcome, NULL,
      @screen_path, NULL
    )`);
  for (let i = 0; i < count; i++) {
    stmt.run({
      event_id: `evt-${i}`,
      execution_id: `exec-${i}`,
      sequence_in_tick: 0,
      simulation_id: 'sim-x',
      agent_id: 'agent-1',
      entity_id: 'entity-1',
      tick: i,
      sim_time: `2026-01-01T00:00:0${i}.000Z`,
      recorded_at: `2026-01-01T00:00:0${i}.500Z`,
      action: `action_${i}`,
      outcome: 'success',
      screen_path: `/dashboard`,
    });
  }
  db.close();
}

describe('inspectRunRoot — library export', () => {
  it('inspects a complete iteration root directly', () => {
    const loopRoot = tmpDir('iter-direct');
    const iter = path.join(loopRoot, 'iter-001');
    try {
      writeScore(iter, 0.85);
      writeFlowResults(iter, 5);
      const s = inspectRunRoot(iter);
      expect(s.rootKind).toBe('iteration');
      expect(s.iteration).toBe(1);
      expect(s.iterRoot).toBe(iter);
      expect(s.loopRoot).toBe(loopRoot);
      expect(s.score?.overall).toBeCloseTo(0.85);
      expect(s.flows).toEqual({ passed: 5, failed: 0, total: 5 });
      expect(s.phase).toBe('SCORE');
      expect(s.partial).toBe(false);
    } finally {
      fs.rmSync(loopRoot, { recursive: true, force: true });
    }
  });

  it('inspects a multi-iteration loop root and returns the latest', () => {
    const loopRoot = tmpDir('multi-iter');
    try {
      writeScore(path.join(loopRoot, 'iter-001'), 0.6);
      writeScore(path.join(loopRoot, 'iter-002'), 0.7);
      writeScore(path.join(loopRoot, 'iter-003'), 0.85);
      const s = inspectRunRoot(loopRoot);
      expect(s.rootKind).toBe('loop');
      expect(s.iteration).toBe(3);
      expect(s.score?.overall).toBeCloseTo(0.85);
    } finally {
      fs.rmSync(loopRoot, { recursive: true, force: true });
    }
  });

  it('inspects a specific iter via direct iter-NNN/ path', () => {
    const loopRoot = tmpDir('iter-specific');
    try {
      writeScore(path.join(loopRoot, 'iter-001'), 0.6);
      writeScore(path.join(loopRoot, 'iter-002'), 0.7);
      writeScore(path.join(loopRoot, 'iter-003'), 0.85);
      const s = inspectRunRoot(path.join(loopRoot, 'iter-002'));
      expect(s.rootKind).toBe('iteration');
      expect(s.iteration).toBe(2);
      expect(s.score?.overall).toBeCloseTo(0.7);
    } finally {
      fs.rmSync(loopRoot, { recursive: true, force: true });
    }
  });

  it('returns partial summary for an empty loop dir', () => {
    const loopRoot = tmpDir('empty-loop');
    try {
      const s = inspectRunRoot(loopRoot);
      expect(s.rootKind).toBe('loop');
      expect(s.iteration).toBe(0);
      expect(s.partial).toBe(true);
      expect(s.parseErrors[0]).toMatch(/no iteration directories/);
      expect(s.score).toBeNull();
      expect(s.flows).toBeNull();
    } finally {
      fs.rmSync(loopRoot, { recursive: true, force: true });
    }
  });

  it('returns partial summary for a partial run (missing fabric-score.json)', () => {
    const loopRoot = tmpDir('partial');
    const iter = path.join(loopRoot, 'iter-001');
    try {
      // Has flows but no score — represents a run that finished TEST but not SCORE.
      writeFlowResults(iter, 3);
      const s = inspectRunRoot(loopRoot);
      expect(s.partial).toBe(true);
      expect(s.score).toBeNull();
      expect(s.flows).toEqual({ passed: 3, failed: 0, total: 3 });
      expect(s.phase).toBe('TEST');
    } finally {
      fs.rmSync(loopRoot, { recursive: true, force: true });
    }
  });

  it('throws AmbiguousRootError when path satisfies both shapes', () => {
    const dir = tmpDir('ambiguous');
    try {
      fs.mkdirSync(path.join(dir, 'iter-001'));
      fs.writeFileSync(path.join(dir, 'fabric-score.json'), '{}');
      expect(() => inspectRunRoot(dir)).toThrow(AmbiguousRootError);
      try { inspectRunRoot(dir); }
      catch (err) {
        expect(err).toBeInstanceOf(AmbiguousRootError);
        expect((err as AmbiguousRootError).code).toBe('AMBIGUOUS_ROOT');
        expect((err as AmbiguousRootError).suggestions.length).toBeGreaterThan(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects opts.kind to disambiguate', () => {
    const dir = tmpDir('disambig');
    try {
      fs.mkdirSync(path.join(dir, 'iter-001'));
      writeScore(dir, 0.5);  // also at root → ambiguous
      // Force iteration interpretation:
      const sIter = inspectRunRoot(dir, { kind: 'iteration' });
      expect(sIter.rootKind).toBe('iteration');
      expect(sIter.score?.overall).toBeCloseTo(0.5);
      // Force loop interpretation:
      const sLoop = inspectRunRoot(dir, { kind: 'loop' });
      expect(sLoop.rootKind).toBe('loop');
      expect(sLoop.iteration).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws UnknownRootError for a dir matching neither shape', () => {
    const dir = tmpDir('unknown');
    try {
      fs.writeFileSync(path.join(dir, 'random.txt'), 'x');
      expect(() => inspectRunRoot(dir)).toThrow(UnknownRootError);
      try { inspectRunRoot(dir); }
      catch (err) {
        expect(err).toBeInstanceOf(UnknownRootError);
        expect((err as UnknownRootError).code).toBe('UNKNOWN_ROOT');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on non-existent path', () => {
    expect(() => inspectRunRoot('/tmp/does-not-exist-' + Date.now())).toThrow(/does not exist/);
  });

  it('reads behavior events from .lisa_memory/lisa.db', () => {
    const loopRoot = tmpDir('events');
    const iter = path.join(loopRoot, 'iter-001');
    try {
      writeScore(iter, 0.5);
      seedBehaviorEvents(iter, 15);
      const s = inspectRunRoot(loopRoot);
      expect(s.lastBehaviorEvents.length).toBe(10);  // capped at 10
      expect(s.lastBehaviorEvents[0].action).toMatch(/^action_\d+$/);
      expect(s.lastBehaviorEvents[0].outcome).toBe('success');
    } finally {
      fs.rmSync(loopRoot, { recursive: true, force: true });
    }
  });
});

describe('fab inspect — CLI integration', () => {
  it('emits a structured envelope on a complete loop', async () => {
    const loopRoot = tmpDir('cli-complete');
    const stateDir = tmpStateDir();
    const iter = path.join(loopRoot, 'iter-001');
    try {
      writeScore(iter, 0.85);
      writeFlowResults(iter, 5);
      const r = await runFab(['inspect', '--root', loopRoot, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.command).toBe('inspect');
      expect(env.status).toBe('ok');
      expect(env.data.rootKind).toBe('loop');
      expect(env.data.iteration).toBe(1);
      expect(env.data.score.overall).toBeCloseTo(0.85);
      expect(env.data.flows.passed).toBe(5);
      expect(env.data.phase).toBe('SCORE');
      expect(env.data.schemaVersion).toBe(1);
    } finally {
      fs.rmSync(loopRoot, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('AMBIGUOUS_ROOT surfaces in envelope with suggestions in stderr', async () => {
    const dir = tmpDir('cli-ambig');
    const stateDir = tmpStateDir();
    try {
      fs.mkdirSync(path.join(dir, 'iter-001'));
      fs.writeFileSync(path.join(dir, 'fabric-score.json'), '{}');
      const r = await runFab(['inspect', '--root', dir, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(1);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.status).toBe('error');
      expect(env.error.code).toBe('AMBIGUOUS_ROOT');
      // Stderr carries the human-readable suggestions.
      expect(r.stderr).toMatch(/--kind/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('UNKNOWN_ROOT surfaces in envelope', async () => {
    const dir = tmpDir('cli-unknown');
    const stateDir = tmpStateDir();
    try {
      fs.writeFileSync(path.join(dir, 'random.txt'), 'x');
      const r = await runFab(['inspect', '--root', dir, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(1);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.status).toBe('error');
      expect(env.error.code).toBe('UNKNOWN_ROOT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('--kind iteration forces interpretation on ambiguous path', async () => {
    const dir = tmpDir('cli-force-iter');
    const stateDir = tmpStateDir();
    try {
      fs.mkdirSync(path.join(dir, 'iter-001'));
      writeScore(dir, 0.42);
      const r = await runFab(['inspect', '--root', dir, '--kind', 'iteration', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.data.rootKind).toBe('iteration');
      expect(env.data.score.overall).toBeCloseTo(0.42);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('records inspect into state so fab status reflects it', async () => {
    const loopRoot = tmpDir('cli-state-update');
    const stateDir = tmpStateDir();
    const iter = path.join(loopRoot, 'iter-001');
    try {
      writeScore(iter, 0.85);
      await runFab(['inspect', '--root', loopRoot, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.data.lastCommand).toBe('inspect');
      expect(env.data.lastRoot).toBe(loopRoot);
      expect(env.data.lastIteration).toBe(1);
      expect(env.data.lastPhase).toBe('SCORE');
    } finally {
      fs.rmSync(loopRoot, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe('fab status — next hint with fab inspect', () => {
  // #20 restores the fab inspect hint for persistent state — undone the
  // workaround from #19 (which dropped the hint while inspect didn't exist).
  it('suggests fab inspect for persistent-root state', async () => {
    const stateDir = tmpStateDir();
    const runRoot = tmpDir('next-hint');
    try {
      await runFab(['seed', '--root', runRoot, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.next).toMatch(/fab inspect --root/);
    } finally {
      fs.rmSync(runRoot, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
