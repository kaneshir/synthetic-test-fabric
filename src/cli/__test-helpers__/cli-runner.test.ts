import { runFab, parseSingleEnvelope, extractFabFraming } from './cli-runner';

describe('cli-runner harness', () => {
  it('runs fab --version and captures stdout + exit code', async () => {
    const r = await runFab(['--version'], { timeoutMs: 10_000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.stderr).toBe('');
    expect(r.timedOut).toBe(false);
  });

  it('runs fab --help and exits 0', async () => {
    const r = await runFab(['--help'], { timeoutMs: 10_000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Synthetic Test Fabric CLI');
  });

  it('captures non-zero exit on unknown command', async () => {
    const r = await runFab(['nonexistent-command'], { timeoutMs: 10_000 });
    expect(r.exitCode).not.toBe(0);
  });
});

describe('parseSingleEnvelope', () => {
  it('parses a single JSON object', () => {
    const obj = parseSingleEnvelope('{"command":"status","status":"ok","data":{"ok":true}}');
    expect(obj).toMatchObject({ command: 'status', status: 'ok' });
  });

  it('throws on empty input', () => {
    expect(() => parseSingleEnvelope('')).toThrow(/empty output/);
  });

  it('throws on non-JSON input', () => {
    expect(() => parseSingleEnvelope('[fab smoke] 3/5 passed')).toThrow(/JSON\.parse failed/);
  });

  it('throws on multiple JSON objects (extra bytes)', () => {
    expect(() => parseSingleEnvelope('{"a":1}\n{"b":2}')).toThrow(/JSON\.parse failed/);
  });
});

describe('extractFabFraming', () => {
  it('extracts only lines starting with [fab ...]', () => {
    const stdout = [
      '[fab smoke] Run root: /tmp/foo',
      'random adapter log',
      '[fab smoke] → SEED',
      'more noise',
      '[fab smoke] Passed.',
    ].join('\n');
    expect(extractFabFraming(stdout)).toEqual([
      '[fab smoke] Run root: /tmp/foo',
      '[fab smoke] → SEED',
      '[fab smoke] Passed.',
    ]);
  });

  it('returns empty array when no framing present', () => {
    expect(extractFabFraming('just text\nno framing')).toEqual([]);
  });
});
