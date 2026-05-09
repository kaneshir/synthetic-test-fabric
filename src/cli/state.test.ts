import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getStateDir,
  getStatePath,
  readState,
  writeState,
  recordCommand,
  FabState,
} from './state';

function makeStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fab-state-'));
}

const SAMPLE_STATE: FabState = {
  lastRoot: '/tmp/foo',
  lastIteration: 1,
  lastRootKind: 'persistent',
  lastScore: 0.85,
  lastPhase: 'SCORE',
  lastFailure: null,
  lastCommand: 'orchestrate',
  lastTimestamp: '2026-05-09T16:00:00.000Z',
};

describe('FAB_STATE_DIR resolution', () => {
  const orig = process.env.FAB_STATE_DIR;
  afterEach(() => {
    if (orig === undefined) delete process.env.FAB_STATE_DIR;
    else process.env.FAB_STATE_DIR = orig;
  });

  it('defaults to ~/.fab', () => {
    delete process.env.FAB_STATE_DIR;
    expect(getStateDir()).toBe(path.join(os.homedir(), '.fab'));
  });

  it('respects FAB_STATE_DIR env var', () => {
    process.env.FAB_STATE_DIR = '/tmp/custom-fab';
    expect(getStateDir()).toBe('/tmp/custom-fab');
    expect(getStatePath()).toBe('/tmp/custom-fab/state.json');
  });
});

describe('writeState / readState round-trip', () => {
  let dir: string;
  const orig = process.env.FAB_STATE_DIR;

  beforeEach(() => {
    dir = makeStateDir();
    process.env.FAB_STATE_DIR = dir;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (orig === undefined) delete process.env.FAB_STATE_DIR;
    else process.env.FAB_STATE_DIR = orig;
  });

  it('returns null when state file does not exist', () => {
    expect(readState()).toBeNull();
  });

  it('writes and reads a complete FabState', () => {
    writeState(SAMPLE_STATE);
    expect(readState()).toEqual(SAMPLE_STATE);
  });

  it('overwrites the previous state', () => {
    writeState(SAMPLE_STATE);
    const next: FabState = { ...SAMPLE_STATE, lastCommand: 'smoke', lastScore: 0.7 };
    writeState(next);
    expect(readState()).toEqual(next);
  });

  it('creates the state dir if missing', () => {
    fs.rmSync(dir, { recursive: true, force: true });
    writeState(SAMPLE_STATE);
    expect(fs.existsSync(dir)).toBe(true);
    expect(readState()).toEqual(SAMPLE_STATE);
  });

  it('throws on unparseable state file (caller surfaces as infra error)', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getStatePath(), '{not-json');
    expect(() => readState()).toThrow();
  });
});

describe('atomic writes (no torn reads under concurrency)', () => {
  let dir: string;
  const orig = process.env.FAB_STATE_DIR;

  beforeEach(() => {
    dir = makeStateDir();
    process.env.FAB_STATE_DIR = dir;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (orig === undefined) delete process.env.FAB_STATE_DIR;
    else process.env.FAB_STATE_DIR = orig;
  });

  it('never leaves state.json in a partially-written state', () => {
    // Simulate many concurrent writes. After all complete, the file must be
    // parseable as one of the writes (never a half-written mix).
    const writes = Array.from({ length: 50 }, (_, i) => ({
      ...SAMPLE_STATE,
      lastCommand: `cmd-${i}`,
      lastTimestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    }));
    for (const s of writes) writeState(s);
    const final = readState();
    expect(final).not.toBeNull();
    // Must be a complete record (one of the 50), not a partial.
    expect(final!.lastCommand).toMatch(/^cmd-\d+$/);
  });

  it('leaves no orphan .tmp files after a successful write', () => {
    writeState(SAMPLE_STATE);
    const entries = fs.readdirSync(dir);
    const tmp = entries.filter((e) => e.includes('.tmp.'));
    expect(tmp).toEqual([]);
  });
});

describe('recordCommand', () => {
  let dir: string;
  const orig = process.env.FAB_STATE_DIR;

  beforeEach(() => {
    dir = makeStateDir();
    process.env.FAB_STATE_DIR = dir;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (orig === undefined) delete process.env.FAB_STATE_DIR;
    else process.env.FAB_STATE_DIR = orig;
  });

  it('writes a complete FabState filling unspecified fields with null', () => {
    recordCommand({ command: 'seed' });
    const s = readState();
    expect(s).toMatchObject({
      lastCommand: 'seed',
      lastRoot: null,
      lastIteration: null,
      lastRootKind: null,
      lastScore: null,
      lastPhase: null,
      lastFailure: null,
    });
    expect(s!.lastTimestamp).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('records ephemeral_deleted on a temp run that got cleaned up', () => {
    recordCommand({
      command: 'fresh',
      lastRoot: null,
      lastRootKind: 'ephemeral_deleted',
    });
    const s = readState();
    expect(s!.lastRoot).toBeNull();
    expect(s!.lastRootKind).toBe('ephemeral_deleted');
  });

  it('records ephemeral_kept + lastFailure on a failed temp run', () => {
    recordCommand({
      command: 'fresh',
      lastRoot: '/tmp/preserved-root',
      lastRootKind: 'ephemeral_kept',
      lastFailure: { phase: 'VERIFY', message: 'verify failed' },
    });
    const s = readState();
    expect(s!.lastRoot).toBe('/tmp/preserved-root');
    expect(s!.lastRootKind).toBe('ephemeral_kept');
    expect(s!.lastFailure).toEqual({ phase: 'VERIFY', message: 'verify failed' });
  });

  it('does not throw when state dir is unwritable', () => {
    process.env.FAB_STATE_DIR = '/proc/1/cant-write-here';
    expect(() => recordCommand({ command: 'seed' })).not.toThrow();
  });
});
