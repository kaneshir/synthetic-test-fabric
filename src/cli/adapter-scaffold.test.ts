// Tests for `fab adapter scaffold` and the scaffoldAdapter() library export.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runFab, parseSingleEnvelope } from './__test-helpers__/cli-runner';
import {
  scaffoldAdapter,
  ScaffoldAdapterError,
  ADAPTER_TYPES,
  ADAPTER_INTERFACES,
  DEFAULT_ADAPTER_CLASS_NAMES,
  renderAdapterStub,
} from './init';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fab-adapter-${prefix}-`));
}
function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fab-state-test-'));
}

describe('renderAdapterStub — covers all 8 types', () => {
  it.each(ADAPTER_TYPES)('renders type %s with default class name', (type) => {
    const content = renderAdapterStub(type);
    const expectedClass = DEFAULT_ADAPTER_CLASS_NAMES[type];
    const expectedIface = ADAPTER_INTERFACES[type];
    expect(content).toMatch(new RegExp(`class ${expectedClass} implements ${expectedIface}\\b`));
    expect(content).toMatch(/from 'synthetic-test-fabric'/);
  });

  it('respects custom className override', () => {
    const content = renderAdapterStub('app', { className: 'AcmeAppAdapter' });
    expect(content).toMatch(/class AcmeAppAdapter implements AppAdapter\b/);
    expect(content).toMatch(/AcmeAppAdapter\.seed/);
    expect(content).not.toMatch(/MyAppAdapter/);
  });

  it('respects custom packageName override', () => {
    const content = renderAdapterStub('reporter', { pkg: '@my/forked-stf' });
    expect(content).toMatch(/from '@my\/forked-stf'/);
  });

  it('reporter and planner stubs use real interface names (not casual labels)', () => {
    expect(renderAdapterStub('reporter')).toMatch(/implements Reporter\b/);
    expect(renderAdapterStub('planner')).toMatch(/implements ScenarioPlanner\b/);
  });
});

describe('scaffoldAdapter — library', () => {
  it('returns content without writing when --out omitted', () => {
    const r = scaffoldAdapter('app');
    expect(r.type).toBe('app');
    expect(r.className).toBe('MyAppAdapter');
    expect(r.interfaceName).toBe('AppAdapter');
    expect(r.filePath).toBeNull();
    expect(r.content).toMatch(/class MyAppAdapter/);
  });

  it('writes to --out when provided', () => {
    const dir = tmpDir('write');
    try {
      const out = path.join(dir, 'src/MyApp.ts');
      const r = scaffoldAdapter('app', { out });
      expect(r.filePath).toBe(path.resolve(out));
      expect(fs.existsSync(out)).toBe(true);
      expect(fs.readFileSync(out, 'utf8')).toBe(r.content);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws ScaffoldAdapterError on unknown type', () => {
    expect(() => scaffoldAdapter('not-a-type')).toThrow(ScaffoldAdapterError);
    try { scaffoldAdapter('not-a-type'); }
    catch (err) {
      expect((err as ScaffoldAdapterError).code).toBe('UNKNOWN_ADAPTER_TYPE');
      expect((err as ScaffoldAdapterError).message).toMatch(/Valid types: app, simulation/);
    }
  });

  it('throws OUT_PATH_EXISTS when target file exists without force', () => {
    const dir = tmpDir('conflict');
    try {
      const out = path.join(dir, 'a.ts');
      scaffoldAdapter('app', { out });
      expect(() => scaffoldAdapter('app', { out })).toThrow(ScaffoldAdapterError);
      try { scaffoldAdapter('app', { out }); }
      catch (err) {
        expect((err as ScaffoldAdapterError).code).toBe('OUT_PATH_EXISTS');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--force overwrites existing file', () => {
    const dir = tmpDir('force');
    try {
      const out = path.join(dir, 'a.ts');
      scaffoldAdapter('app', { out });
      fs.writeFileSync(out, '// MUTATED');
      scaffoldAdapter('app', { out, force: true });
      expect(fs.readFileSync(out, 'utf8')).not.toBe('// MUTATED');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fab adapter scaffold — CLI', () => {
  it.each(ADAPTER_TYPES)('writes a stub file for type %s', async (type) => {
    const dir = tmpDir(`cli-${type}`);
    const stateDir = tmpStateDir();
    try {
      const out = path.join(dir, `Stub.ts`);
      const r = await runFab(['adapter', 'scaffold', type, '--out', out, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.command).toBe('adapter-scaffold');
      expect(env.data.ok).toBe(true);
      expect(env.data.type).toBe(type);
      expect(env.data.interfaceName).toBe(ADAPTER_INTERFACES[type]);
      expect(env.data.filePath).toBe(out);
      expect(fs.existsSync(out)).toBe(true);
      const content = fs.readFileSync(out, 'utf8');
      expect(content).toMatch(new RegExp(`implements ${ADAPTER_INTERFACES[type]}\\b`));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('--name overrides the class name', async () => {
    const dir = tmpDir('cli-name');
    const stateDir = tmpStateDir();
    try {
      const out = path.join(dir, 'a.ts');
      const r = await runFab(['adapter', 'scaffold', 'app', '--out', out, '--name', 'AcmeAppAdapter', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.data.className).toBe('AcmeAppAdapter');
      expect(fs.readFileSync(out, 'utf8')).toMatch(/class AcmeAppAdapter/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('emits UNKNOWN_ADAPTER_TYPE error envelope for invalid type', async () => {
    const stateDir = tmpStateDir();
    try {
      const r = await runFab(['adapter', 'scaffold', 'gibberish', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(1);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.status).toBe('error');
      expect(env.error.code).toBe('UNKNOWN_ADAPTER_TYPE');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('emits OUT_PATH_EXISTS error envelope on conflict without --force', async () => {
    const dir = tmpDir('cli-conflict');
    const stateDir = tmpStateDir();
    try {
      const out = path.join(dir, 'a.ts');
      await runFab(['adapter', 'scaffold', 'app', '--out', out, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      const r = await runFab(['adapter', 'scaffold', 'app', '--out', out, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(1);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.error.code).toBe('OUT_PATH_EXISTS');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('--force overwrites via CLI', async () => {
    const dir = tmpDir('cli-force');
    const stateDir = tmpStateDir();
    try {
      const out = path.join(dir, 'a.ts');
      await runFab(['adapter', 'scaffold', 'app', '--out', out, '--json'], { env: { FAB_STATE_DIR: stateDir } });
      fs.writeFileSync(out, '// MUTATED');
      const r = await runFab(['adapter', 'scaffold', 'app', '--out', out, '--force', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      expect(fs.readFileSync(out, 'utf8')).not.toBe('// MUTATED');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('JSON envelope includes content when no --out (pipe mode)', async () => {
    const stateDir = tmpStateDir();
    try {
      const r = await runFab(['adapter', 'scaffold', 'reporter', '--json'], { env: { FAB_STATE_DIR: stateDir } });
      expect(r.exitCode).toBe(0);
      const env: any = parseSingleEnvelope(r.stdout);
      expect(env.data.filePath).toBeNull();
      expect(env.data.content).toMatch(/class MyReporter implements Reporter/);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
