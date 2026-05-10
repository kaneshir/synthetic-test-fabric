// Integration tests for `fab status` and the state-writeback lifecycle.
// Covers the AC scenarios from #19: empty state, ephemeral_deleted vs
// ephemeral_kept vs persistent classification, failure-state writeback,
// corrupt state file handling, and FAB_STATE_DIR isolation.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runFab, parseSingleEnvelope } from './__test-helpers__/cli-runner';

const STUB_CONFIG = path.resolve(__dirname, '__test-helpers__/fixtures/stub.config.ts');

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fab-state-test-'));
}

function tmpRunRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fab-${prefix}-`));
}

describe('fab status — empty state', () => {
  it('returns state:empty when no run has happened', async () => {
    const stateDir = tmpStateDir();
    try {
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.command).toBe('status');
      expect(env.status).toBe('ok');
      expect(env.data).toEqual({ ok: true, state: 'empty' });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('text mode prints "no runs yet"', async () => {
    const stateDir = tmpStateDir();
    try {
      const r = await runFab(['status'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('no runs yet');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe('fab status — populated by other commands', () => {
  it('seed → persistent state with lastCommand=seed', async () => {
    const stateDir = tmpStateDir();
    const runRoot = tmpRunRoot('seed');
    try {
      await runFab(['seed', '--root', runRoot, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.data.state).toBe('populated');
      expect(env.data.lastCommand).toBe('seed');
      expect(env.data.lastRoot).toBe(runRoot);
      expect(env.data.lastRootKind).toBe('persistent');
      expect(env.data.lastPhase).toBe('SEED');
      expect(env.data.lastFailure).toBeNull();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('score → persistent state with lastScore populated', async () => {
    const stateDir = tmpStateDir();
    const runRoot = tmpRunRoot('score');
    try {
      await runFab(['seed', '--root', runRoot, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      await runFab(['score', '--root', runRoot, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.data.lastCommand).toBe('score');
      expect(env.data.lastScore).toBeCloseTo(0.85);
      expect(env.data.lastPhase).toBe('SCORE');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(runRoot, { recursive: true, force: true });
    }
  });
});

describe('fab status — fresh / smoke ephemeral handling', () => {
  it('fresh (no --keep, no --root) → ephemeral_deleted, lastRoot=null', async () => {
    const stateDir = tmpStateDir();
    try {
      const r = await runFab(['fresh', '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      const status = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(status.stdout);
      expect(env.data.lastCommand).toBe('fresh');
      expect(env.data.lastRoot).toBeNull();
      expect(env.data.lastRootKind).toBe('ephemeral_deleted');
      expect(env.data.lastFailure).toBeNull();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('fresh --keep → ephemeral_kept, lastRoot populated', async () => {
    const stateDir = tmpStateDir();
    try {
      const r = await runFab(['fresh', '--keep', '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      const status = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(status.stdout);
      expect(env.data.lastRootKind).toBe('ephemeral_kept');
      expect(env.data.lastRoot).not.toBeNull();
      expect(env.data.lastRoot).toMatch(/fab-fresh-/);
      expect(env.data.lastFailure).toBeNull();
      // Cleanup the kept root.
      fs.rmSync(env.data.lastRoot, { recursive: true, force: true });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('fresh --root <explicit> → persistent', async () => {
    const stateDir = tmpStateDir();
    const runRoot = tmpRunRoot('fresh-persistent');
    try {
      await runFab(['fresh', '--root', runRoot, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.data.lastRootKind).toBe('persistent');
      expect(env.data.lastRoot).toBe(runRoot);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('smoke (no --keep, no --root) → ephemeral_deleted', async () => {
    const stateDir = tmpStateDir();
    try {
      await runFab(['smoke', '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.data.lastCommand).toBe('smoke');
      expect(env.data.lastRootKind).toBe('ephemeral_deleted');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe('fab status — failure-state writeback', () => {
  it('feedback with missing fabric-score.json → records lastFailure', async () => {
    const stateDir = tmpStateDir();
    const runRoot = tmpRunRoot('feedback-fail');
    try {
      // No score file → infrastructure error (SCORE_FILE_MISSING) per #18 taxonomy.
      const r = await runFab(['feedback', '--root', runRoot, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(1);

      const status = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(status.stdout);
      expect(env.data.lastCommand).toBe('feedback');
      expect(env.data.lastFailure).toMatchObject({
        phase: 'FEEDBACK',
        message: expect.stringContaining('fabric-score.json not found'),
      });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('check below threshold → records domain failure', async () => {
    const stateDir = tmpStateDir();
    const runRoot = tmpRunRoot('check-fail');
    try {
      const iter = path.join(runRoot, 'iter-001');
      fs.mkdirSync(iter, { recursive: true });
      fs.writeFileSync(path.join(iter, 'fabric-score.json'), JSON.stringify({
        simulationId: 'x', generatedAt: '2026-01-01T00:00:00Z', overall: 0.3, dimensions: {}, details: {},
      }));
      const r = await runFab(['check', '--root', runRoot, '--threshold', '0.5'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(1);

      const status = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(status.stdout);
      expect(env.data.lastCommand).toBe('check');
      expect(env.data.lastScore).toBeCloseTo(0.3);
      expect(env.data.lastFailure).toMatchObject({ phase: 'CHECK' });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(runRoot, { recursive: true, force: true });
    }
  });
});

describe('fab status — error paths', () => {
  it('emits status:"error" when state file is corrupt', async () => {
    const stateDir = tmpStateDir();
    try {
      fs.writeFileSync(path.join(stateDir, 'state.json'), '{not-json');
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(1);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.status).toBe('error');
      expect(env.error.code).toBe('STATE_FILE_UNREADABLE');
      expect(env.error.message).toContain('unreadable');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('emits status:"error" when state file is valid JSON but wrong shape', async () => {
    // Reviewer-flagged regression: { "lastScore": "oops" } would otherwise
    // crash status with "s.lastScore.toFixed is not a function".
    const stateDir = tmpStateDir();
    try {
      fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({
        lastScore: 'oops', lastCommand: 'x', lastTimestamp: 'y',
      }));
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(1);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.status).toBe('error');
      expect(env.error.code).toBe('STATE_FILE_UNREADABLE');
      expect(env.error.message).toMatch(/shape invalid/);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe('fab status — orchestrate writeback', () => {
  it('orchestrate without --root records the auto-generated /tmp/fabric-loop path', async () => {
    // Reviewer-flagged regression: previously `lastRoot: opts.root ?? null`
    // lost the auto-generated path. Now CLI pre-resolves loopRoot and records
    // the same value the orchestrator uses.
    const stateDir = tmpStateDir();
    try {
      const r = await runFab(['orchestrate', '--iterations', '1', '--ticks', '1', '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);

      const status = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(status.stdout);
      expect(env.data.lastCommand).toBe('orchestrate');
      expect(env.data.lastRoot).toMatch(/^\/tmp\/fabric-loop\//);
      expect(env.data.lastRootKind).toBe('persistent');
      expect(env.data.lastIteration).toBe(1);
      expect(env.data.lastScore).toBeCloseTo(0.85);

      // Cleanup the auto-generated loop dir.
      fs.rmSync(env.data.lastRoot, { recursive: true, force: true });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('orchestrate with --root records the explicit path', async () => {
    const stateDir = tmpStateDir();
    const runRoot = tmpRunRoot('orch-explicit');
    try {
      const r = await runFab(['orchestrate', '--iterations', '1', '--ticks', '1', '--root', runRoot, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);

      const status = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(status.stdout);
      expect(env.data.lastRoot).toBe(runRoot);
      expect(env.data.lastRootKind).toBe('persistent');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(runRoot, { recursive: true, force: true });
    }
  });
});

describe('fab status — next hint', () => {
  // Reviewer-flagged regression: previously emitted `next: "fab inspect ..."`
  // but #20 has not landed. Following the hint hits unknown-command.
  it('does NOT suggest fab inspect for persistent-root state', async () => {
    const stateDir = tmpStateDir();
    const runRoot = tmpRunRoot('next-hint-persistent');
    try {
      await runFab(['seed', '--root', runRoot, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.next).toBeUndefined();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('suggests --keep when last run was ephemeral_deleted', async () => {
    const stateDir = tmpStateDir();
    try {
      await runFab(['fresh', '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.next).toMatch(/--keep/);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe('FAB_STATE_DIR isolation', () => {
  it('different FAB_STATE_DIR values isolate state across runs', async () => {
    const stateDirA = tmpStateDir();
    const stateDirB = tmpStateDir();
    const runRootA = tmpRunRoot('isolation-a');
    const runRootB = tmpRunRoot('isolation-b');
    try {
      await runFab(['seed', '--root', runRootA, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDirA } });
      await runFab(['seed', '--root', runRootB, '--config', STUB_CONFIG], { env: { FAB_STATE_DIR: stateDirB } });

      const a = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDirA } });
      const b = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDirB } });
      const envA: any = parseSingleEnvelope(a.stdout);
      const envB: any = parseSingleEnvelope(b.stdout);
      expect(envA.data.lastRoot).toBe(runRootA);
      expect(envB.data.lastRoot).toBe(runRootB);
    } finally {
      fs.rmSync(stateDirA, { recursive: true, force: true });
      fs.rmSync(stateDirB, { recursive: true, force: true });
      fs.rmSync(runRootA, { recursive: true, force: true });
      fs.rmSync(runRootB, { recursive: true, force: true });
    }
  });
});
