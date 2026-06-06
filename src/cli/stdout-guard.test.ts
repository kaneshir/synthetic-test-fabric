import {
  installStdoutGuard,
  uninstallStdoutGuard,
  unsafeWriteStdout,
  isStdoutGuardInstalled,
} from './stdout-guard';

describe('stdout-guard', () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    // Capture writes to both streams before the test (and before installing the guard).
    stdoutChunks = [];
    stderrChunks = [];
    originalStdoutWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
    originalStderrWrite = process.stderr.write.bind(process.stderr) as typeof process.stderr.write;

    process.stdout.write = ((chunk: unknown): boolean => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown): boolean => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    uninstallStdoutGuard();
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it('starts uninstalled', () => {
    expect(isStdoutGuardInstalled()).toBe(false);
  });

  it('redirects process.stdout.write to stderr after install', () => {
    installStdoutGuard();
    process.stdout.write('would-be-stdout');
    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks).toContain('would-be-stdout');
  });

  it('redirects console.log to stderr after install', () => {
    installStdoutGuard();
    console.log('hello from adapter');
    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks.join('')).toContain('hello from adapter');
  });

  it('redirects console.info and console.debug to stderr', () => {
    installStdoutGuard();
    console.info('info-line');
    console.debug('debug-line');
    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks.join('')).toContain('info-line');
    expect(stderrChunks.join('')).toContain('debug-line');
  });

  it('unsafeWriteStdout reaches actual stdout even after install', () => {
    installStdoutGuard();
    unsafeWriteStdout('envelope-bytes');
    expect(stdoutChunks).toContain('envelope-bytes');
  });

  it('uninstall restores original stdout.write', () => {
    installStdoutGuard();
    uninstallStdoutGuard();
    process.stdout.write('back-to-stdout');
    expect(stdoutChunks).toContain('back-to-stdout');
  });

  it('install is idempotent', () => {
    installStdoutGuard();
    installStdoutGuard();    // second call should be a no-op
    expect(isStdoutGuardInstalled()).toBe(true);
    process.stdout.write('check');
    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks.join('')).toContain('check');
  });
});
