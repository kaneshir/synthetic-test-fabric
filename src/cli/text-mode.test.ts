// Backward-compat regression tests: lock down the existing text-mode CLI framing
// BEFORE the --json refactor. These assertions must continue to pass after #18 ships
// — that proves we didn't accidentally break non-JSON output for existing users.
//
// Focus: lines beginning with `[fab ...]` (the CLI's own framing, the part at risk
// from the stderr-redirect refactor). Body lines from the orchestrator/adapters are
// out of scope here.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runFab, extractFabFraming } from './__test-helpers__/cli-runner';

const STUB_CONFIG = path.resolve(__dirname, '__test-helpers__/fixtures/stub.config.ts');

function makeRunRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fab-text-mode-${prefix}-`));
}

function redactRoot(line: string, root: string): string {
  return line.split(root).join('<RUN_ROOT>');
}

describe('text-mode framing (backward-compat snapshots)', () => {
  describe('fab smoke', () => {
    it('emits the expected framing on a clean stub run', async () => {
      const root = makeRunRoot('smoke');
      try {
        const r = await runFab(['smoke', '--root', root, '--config', STUB_CONFIG, '--keep']);
        expect(r.exitCode).toBe(0);
        const framing = extractFabFraming(r.stdout).map((l) => redactRoot(l, root));
        expect(framing).toEqual([
          '[fab smoke] Run root: <RUN_ROOT>',
          '[fab smoke] → SEED',
          '[fab smoke] → VERIFY',
          '[fab smoke] → SMOKE FLOW',
          '[fab smoke] 0/0 passed',
          '[fab smoke] Passed.',
        ]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('fab fresh', () => {
    it('emits the expected framing without --flows / --plan', async () => {
      const root = makeRunRoot('fresh');
      try {
        const r = await runFab(['fresh', '--root', root, '--config', STUB_CONFIG, '--keep']);
        expect(r.exitCode).toBe(0);
        const framing = extractFabFraming(r.stdout).map((l) => redactRoot(l, root));
        expect(framing).toEqual([
          '[fab fresh] Run root: <RUN_ROOT>',
          '[fab fresh] → SEED',
          '[fab fresh] → VERIFY',
          '[fab fresh] Done. Root: <RUN_ROOT>',
        ]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('emits FLOWS framing with --flows', async () => {
      const root = makeRunRoot('fresh-flows');
      try {
        const r = await runFab(['fresh', '--root', root, '--config', STUB_CONFIG, '--keep', '--flows']);
        expect(r.exitCode).toBe(0);
        const framing = extractFabFraming(r.stdout).map((l) => redactRoot(l, root));
        expect(framing).toContain('[fab fresh] → FLOWS');
        expect(framing).toContain('[fab fresh] flows: 0/0 passed');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('emits SCORE / FEEDBACK framing with --plan', async () => {
      const root = makeRunRoot('fresh-plan');
      try {
        const r = await runFab(['fresh', '--root', root, '--config', STUB_CONFIG, '--keep', '--plan']);
        expect(r.exitCode).toBe(0);
        const framing = extractFabFraming(r.stdout).map((l) => redactRoot(l, root));
        expect(framing).toContain('[fab fresh] → SCORE');
        expect(framing).toContain('[fab fresh] → FEEDBACK');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('fab seed', () => {
    it('emits Done line with the run root', async () => {
      const root = makeRunRoot('seed');
      try {
        const r = await runFab(['seed', '--root', root, '--config', STUB_CONFIG]);
        expect(r.exitCode).toBe(0);
        const framing = extractFabFraming(r.stdout).map((l) => redactRoot(l, root));
        expect(framing).toEqual(['[fab seed] Done. Root: <RUN_ROOT>']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('fab verify', () => {
    it('emits OK on successful verify', async () => {
      const root = makeRunRoot('verify');
      try {
        // Seed first so iter-001 exists with the verifier-expected layout.
        await runFab(['seed', '--root', root, '--config', STUB_CONFIG]);
        const r = await runFab(['verify', '--root', root, '--config', STUB_CONFIG]);
        expect(r.exitCode).toBe(0);
        const framing = extractFabFraming(r.stdout);
        expect(framing).toEqual(['[fab verify] OK']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('fab score', () => {
    it('emits the overall score line', async () => {
      const root = makeRunRoot('score');
      try {
        await runFab(['seed', '--root', root, '--config', STUB_CONFIG]);
        const r = await runFab(['score', '--root', root, '--config', STUB_CONFIG]);
        expect(r.exitCode).toBe(0);
        const framing = extractFabFraming(r.stdout);
        expect(framing).toEqual(['[fab score] Overall: 0.85']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('fab check', () => {
    it('emits the ✅ pass line when score meets threshold', async () => {
      const root = makeRunRoot('check-pass');
      try {
        const iter = path.join(root, 'iter-001');
        fs.mkdirSync(iter, { recursive: true });
        fs.writeFileSync(path.join(iter, 'fabric-score.json'), JSON.stringify({
          simulationId: 'sim-001', generatedAt: '2026-01-01T00:00:00Z',
          overall: 0.85, dimensions: {}, details: {},
        }));
        const r = await runFab(['check', '--root', root, '--threshold', '0.5']);
        expect(r.exitCode).toBe(0);
        const framing = extractFabFraming(r.stdout);
        expect(framing).toHaveLength(1);
        expect(framing[0]).toMatch(/^\[fab check\] ✅ Score 0\.\d+ ≥ threshold 0\.\d+$/);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('emits the ❌ fail line when score is below threshold', async () => {
      const root = makeRunRoot('check-fail');
      try {
        const iter = path.join(root, 'iter-001');
        fs.mkdirSync(iter, { recursive: true });
        fs.writeFileSync(path.join(iter, 'fabric-score.json'), JSON.stringify({
          simulationId: 'sim-001', generatedAt: '2026-01-01T00:00:00Z',
          overall: 0.3, dimensions: {}, details: {},
        }));
        const r = await runFab(['check', '--root', root, '--threshold', '0.5']);
        // Currently exits 1 with ❌ message via console.error + process.exit(1).
        // After #18, must still exit 1 and still emit ❌ to stderr or stdout.
        expect(r.exitCode).toBe(1);
        const allOutput = r.stdout + r.stderr;
        const framing = allOutput
          .split('\n')
          .filter((l) => /^\[fab check\]/.test(l));
        expect(framing).toHaveLength(1);
        expect(framing[0]).toMatch(/^\[fab check\] ❌/);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('fab feedback', () => {
    it('emits the not-found error message when fabric-score.json is absent', async () => {
      const root = makeRunRoot('feedback-missing');
      try {
        const r = await runFab(['feedback', '--root', root, '--config', STUB_CONFIG]);
        expect(r.exitCode).toBe(1);
        const allOutput = r.stdout + r.stderr;
        const framing = allOutput
          .split('\n')
          .filter((l) => /^\[fab feedback\]/.test(l));
        expect(framing.length).toBeGreaterThanOrEqual(1);
        expect(framing[0]).toMatch(/fabric-score\.json not found/);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('fab baseline list', () => {
    it('emits the no-baselines line on an empty dir', async () => {
      const root = makeRunRoot('baseline-empty');
      try {
        const r = await runFab(['baseline', 'list', '--baseline-dir', root, '--config', STUB_CONFIG]);
        expect(r.exitCode).toBe(0);
        const framing = extractFabFraming(r.stdout);
        expect(framing).toEqual(['[fab baseline list] No baselines found.']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
