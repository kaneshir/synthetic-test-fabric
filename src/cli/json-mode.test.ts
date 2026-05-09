// Integration tests for --json mode:
//   - Stdout-purity regression (adapter/reporter logs don't pollute the envelope)
//   - Pre-commander parse error path (unknown command / missing required option still emits JSON)
//   - Outcome taxonomy round-trip (success / domain failure / infra error)

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runFab, parseSingleEnvelope } from './__test-helpers__/cli-runner';
import {
  NOISE_LINE_ADAPTER,
  NOISE_LINE_REPORTER,
  NOISE_LINE_DIRECT_STDOUT,
} from './__test-helpers__/fixtures/noisy.config';

const STUB_CONFIG = path.resolve(__dirname, '__test-helpers__/fixtures/stub.config.ts');
const NOISY_CONFIG = path.resolve(__dirname, '__test-helpers__/fixtures/noisy.config.ts');

function tmpRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fab-json-${prefix}-`));
}

describe('--json adapter-pollution regression', () => {
  it('keeps stdout pure even when an adapter calls console.log and process.stdout.write', async () => {
    const root = tmpRoot('pollution');
    try {
      const r = await runFab(['smoke', '--root', root, '--config', NOISY_CONFIG, '--keep', '--json']);
      expect(r.exitCode).toBe(0);

      // The adapter wrote noise via console.log and process.stdout.write.
      // None of it should reach stdout when --json is set.
      expect(r.stdout).not.toContain(NOISE_LINE_ADAPTER);
      expect(r.stdout).not.toContain(NOISE_LINE_DIRECT_STDOUT);

      // Stdout must be parseable as exactly one JSON envelope.
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.command).toBe('smoke');
      expect(env.status).toBe('ok');

      // The noise must still be visible to the user — on stderr.
      expect(r.stderr).toContain(NOISE_LINE_ADAPTER);
      expect(r.stderr).toContain(NOISE_LINE_DIRECT_STDOUT);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps stdout pure when a reporter calls console.log', async () => {
    const root = tmpRoot('reporter-pollution');
    try {
      // The noisy reporter only fires from `score`, not `smoke`. Use score with a pre-written score file.
      const iter = path.join(root, 'iter-001');
      fs.mkdirSync(iter, { recursive: true });
      fs.writeFileSync(path.join(iter, 'fabric-score.json'), JSON.stringify({
        simulationId: 'x', generatedAt: '2026-01-01T00:00:00Z', overall: 0.85, dimensions: {}, details: {},
      }));
      const r = await runFab(['score', '--root', root, '--config', NOISY_CONFIG, '--json']);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).not.toContain(NOISE_LINE_REPORTER);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.command).toBe('score');
      expect(env.status).toBe('ok');
      expect(r.stderr).toContain(NOISE_LINE_REPORTER);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('--json detection from raw process.argv (pre-commander)', () => {
  it('emits JSON error envelope on unknown command when --json is set', async () => {
    const r = await runFab(['nonexistent-command', '--json']);
    expect(r.exitCode).not.toBe(0);
    const env: any = parseSingleEnvelope(r.stdout);
    expect(env.status).toBe('error');
    expect(env.error.message).toBeDefined();
  });

  it('emits JSON error envelope on missing required option when --json is set', async () => {
    // `seed` requires --root.
    const r = await runFab(['seed', '--json']);
    expect(r.exitCode).not.toBe(0);
    const env: any = parseSingleEnvelope(r.stdout);
    expect(env.status).toBe('error');
    expect(env.error.message).toMatch(/required option|--root/);
  });

  it('keeps text-mode error format when --json is NOT set', async () => {
    const r = await runFab(['nonexistent-command']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout.trim()).toBe(''); // no JSON on stdout in text mode
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});

describe('--json outcome taxonomy round-trips', () => {
  it('success: status=ok, data carries command-specific shape, exit 0', async () => {
    const root = tmpRoot('taxonomy-success');
    try {
      const iter = path.join(root, 'iter-001');
      fs.mkdirSync(iter, { recursive: true });
      fs.writeFileSync(path.join(iter, 'fabric-score.json'), JSON.stringify({
        simulationId: 'x', generatedAt: '2026-01-01T00:00:00Z', overall: 0.85, dimensions: {}, details: {},
      }));
      const r = await runFab(['check', '--root', root, '--threshold', '0.5', '--json']);
      expect(r.exitCode).toBe(0);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.status).toBe('ok');
      expect(env.data.ok).toBe(true);
      expect(env.data.score).toBe(0.85);
      expect(env.data.threshold).toBe(0.5);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('domain failure: status=ok, data.ok=false, exit 1', async () => {
    const root = tmpRoot('taxonomy-domain');
    try {
      const iter = path.join(root, 'iter-001');
      fs.mkdirSync(iter, { recursive: true });
      fs.writeFileSync(path.join(iter, 'fabric-score.json'), JSON.stringify({
        simulationId: 'x', generatedAt: '2026-01-01T00:00:00Z', overall: 0.3, dimensions: {}, details: {},
      }));
      const r = await runFab(['check', '--root', root, '--threshold', '0.5', '--json']);
      expect(r.exitCode).toBe(1);
      const env: any = parseSingleEnvelope(r.stdout);
      // Domain failure: tool ran successfully and found the score below threshold.
      expect(env.status).toBe('ok');
      expect(env.data.ok).toBe(false);
      expect(env.data.score).toBe(0.3);
      expect(env.data.threshold).toBe(0.5);
      expect(env.data.message).toBeDefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('infrastructure error: status=error, no data, exit 1, error.code present', async () => {
    const root = tmpRoot('taxonomy-infra');
    try {
      // No fabric-score.json → infra error, not a domain failure.
      const r = await runFab(['check', '--root', root, '--threshold', '0.5', '--json']);
      expect(r.exitCode).toBe(1);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.status).toBe('error');
      expect(env.error.code).toBe('SCORE_FILE_MISSING');
      expect(env.error.message).toMatch(/fabric-score\.json not found/);
      expect((env as any).data).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
