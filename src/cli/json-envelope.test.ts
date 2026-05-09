// Unit tests for the envelope helpers themselves.
// Integration tests (CLI subprocess round-trips) live in *.cli.test.ts files.

import {
  detectModesFromArgv,
  setJsonMode,
  isJsonMode,
  setDebugMode,
  isDebugMode,
  FabError,
} from './json-envelope';

describe('detectModesFromArgv', () => {
  beforeEach(() => {
    setJsonMode(false);
    setDebugMode(false);
    delete process.env.FAB_DEBUG;
  });

  it('detects --json anywhere in argv', () => {
    detectModesFromArgv(['node', 'fab.ts', 'smoke', '--json', '--root', '/tmp']);
    expect(isJsonMode()).toBe(true);
  });

  it('leaves --json off when not present', () => {
    detectModesFromArgv(['node', 'fab.ts', 'smoke', '--root', '/tmp']);
    expect(isJsonMode()).toBe(false);
  });

  it('detects --debug anywhere in argv', () => {
    detectModesFromArgv(['node', 'fab.ts', 'check', '--debug']);
    expect(isDebugMode()).toBe(true);
  });

  it('honors FAB_DEBUG=1 env even without --debug flag', () => {
    process.env.FAB_DEBUG = '1';
    detectModesFromArgv(['node', 'fab.ts', 'smoke']);
    expect(isDebugMode()).toBe(true);
  });
});

describe('FabError', () => {
  it('carries an optional code', () => {
    const e = new FabError('boom', { code: 'SAMPLE_CODE' });
    expect(e.message).toBe('boom');
    expect(e.code).toBe('SAMPLE_CODE');
    expect(e.name).toBe('FabError');
  });

  it('carries an optional runRoot', () => {
    const e = new FabError('boom', { runRoot: '/tmp/foo' });
    expect(e.runRoot).toBe('/tmp/foo');
  });

  it('is instanceof Error', () => {
    expect(new FabError('x')).toBeInstanceOf(Error);
  });
});
