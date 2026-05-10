// Tests for `fab init` and the scaffoldProject() library export.
//
// AC scope from #21:
//  - generates fabric.config.ts + 8 adapter stubs + flows/.gitkeep
//  - refuses to overwrite existing files without --force
//  - --force overwrites
//  - --json envelope contains files-created list
//  - generated stubs use real interface names (Reporter, ScenarioPlanner)
//  - generated reporters use array wiring: `reporters: [new MyReporter()]`
//
// Deferred to #26 (integration + release-readiness):
//  - real `tsc --noEmit` compile against installed package
//  - `loadFabricConfig()` actually loads the generated config

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runFab, parseSingleEnvelope } from './__test-helpers__/cli-runner';
import { scaffoldProject, InitConflictError } from './init';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fab-init-${prefix}-`));
}

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fab-state-test-'));
}

const EXPECTED_FILES = [
  'fabric.config.ts',
  'src/adapters/MyAppAdapter.ts',
  'src/adapters/MySimulationAdapter.ts',
  'src/adapters/MyScoringAdapter.ts',
  'src/adapters/MyFeedbackAdapter.ts',
  'src/adapters/MyMemoryAdapter.ts',
  'src/adapters/MyBrowserAdapter.ts',
  'src/adapters/MyReporter.ts',
  'src/adapters/MyScenarioPlanner.ts',
  'flows/.gitkeep',
];

describe('scaffoldProject — library', () => {
  it('writes the expected file set in an empty dir', () => {
    const dir = tmpDir('empty');
    try {
      const result = scaffoldProject({ dir });
      expect(result.filesCreated.length).toBe(EXPECTED_FILES.length);
      for (const rel of EXPECTED_FILES) {
        expect(fs.existsSync(path.join(dir, rel))).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite existing files without --force', () => {
    const dir = tmpDir('conflict');
    try {
      scaffoldProject({ dir });
      expect(() => scaffoldProject({ dir })).toThrow(InitConflictError);
      try { scaffoldProject({ dir }); }
      catch (err) {
        expect(err).toBeInstanceOf(InitConflictError);
        expect((err as InitConflictError).code).toBe('INIT_CONFLICT');
        expect((err as InitConflictError).conflicts.length).toBeGreaterThan(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overwrites existing files with force=true', () => {
    const dir = tmpDir('force');
    try {
      scaffoldProject({ dir });
      // Mutate a file so we can detect it was overwritten.
      const target = path.join(dir, 'fabric.config.ts');
      fs.writeFileSync(target, '// MUTATED');
      const result = scaffoldProject({ dir, force: true });
      expect(result.filesCreated.length).toBe(EXPECTED_FILES.length);
      expect(fs.readFileSync(target, 'utf8')).not.toBe('// MUTATED');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses real interface names in generated stubs', () => {
    const dir = tmpDir('names');
    try {
      scaffoldProject({ dir });
      const reporter = fs.readFileSync(path.join(dir, 'src/adapters/MyReporter.ts'), 'utf8');
      const planner = fs.readFileSync(path.join(dir, 'src/adapters/MyScenarioPlanner.ts'), 'utf8');
      // Per the cross-cutting concerns from #22's design — real interface names,
      // not casual labels like "planner" or "reporter".
      expect(reporter).toMatch(/implements Reporter\b/);
      expect(planner).toMatch(/implements ScenarioPlanner\b/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wires reporters as an array in fabric.config.ts', () => {
    const dir = tmpDir('reporters-array');
    try {
      scaffoldProject({ dir });
      const config = fs.readFileSync(path.join(dir, 'fabric.config.ts'), 'utf8');
      // FabricConfig requires `reporters: Reporter[]` — must be array literal,
      // not a single reporter object.
      expect(config).toMatch(/reporters:\s*\[new MyReporter\(\)\]/);
      expect(config).toMatch(/planner:\s*new MyScenarioPlanner\(\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses configurable package name in generated imports', () => {
    const dir = tmpDir('pkg');
    try {
      scaffoldProject({ dir, packageName: 'my-custom-pkg' });
      const stub = fs.readFileSync(path.join(dir, 'src/adapters/MyAppAdapter.ts'), 'utf8');
      expect(stub).toMatch(/from 'my-custom-pkg'/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throwing stubs throw with the method name', () => {
    const dir = tmpDir('todo-text');
    try {
      scaffoldProject({ dir });
      const app = fs.readFileSync(path.join(dir, 'src/adapters/MyAppAdapter.ts'), 'utf8');
      expect(app).toMatch(/TODO: implement MyAppAdapter\.seed/);
      expect(app).toMatch(/TODO: implement MyAppAdapter\.verify/);
      // No-op methods don't throw.
      expect(app).toMatch(/async reset\([^)]*\): Promise<void> \{[\s\S]*?No-op is acceptable/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fab init — CLI integration', () => {
  it('emits a JSON envelope with the files-created list', async () => {
    const dir = tmpDir('cli');
    const stateDir = tmpStateDir();
    try {
      const r = await runFab(['init', '--dir', dir, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.command).toBe('init');
      expect(env.status).toBe('ok');
      expect(env.data.ok).toBe(true);
      expect(env.data.dir).toBe(dir);
      expect(env.data.filesCreated.length).toBe(EXPECTED_FILES.length);
      expect(env.next).toMatch(/edit src\/adapters/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('emits INIT_CONFLICT error envelope when files exist without --force', async () => {
    const dir = tmpDir('cli-conflict');
    const stateDir = tmpStateDir();
    try {
      await runFab(['init', '--dir', dir, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      // Second init without --force should fail.
      const r = await runFab(['init', '--dir', dir, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(1);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.status).toBe('error');
      expect(env.error.code).toBe('INIT_CONFLICT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('--force overwrites existing files', async () => {
    const dir = tmpDir('cli-force');
    const stateDir = tmpStateDir();
    try {
      await runFab(['init', '--dir', dir, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['init', '--dir', dir, '--force', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.status).toBe('ok');
      expect(env.data.filesCreated.length).toBe(EXPECTED_FILES.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('records init into state so fab status reflects it', async () => {
    const dir = tmpDir('cli-state');
    const stateDir = tmpStateDir();
    try {
      await runFab(['init', '--dir', dir, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['status', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.data.lastCommand).toBe('init');
      expect(env.data.lastRoot).toBe(dir);
      expect(env.data.lastPhase).toBe('INIT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
