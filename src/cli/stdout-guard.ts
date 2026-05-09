/**
 * Stdout-purity guard for `--json` mode.
 *
 * When `--json` is set, the CLI must emit exactly one JSON envelope on stdout.
 * Adapter / reporter / orchestrator code calls `console.log` and `process.stdout.write`
 * freely during normal operation — those writes would corrupt the envelope.
 *
 * This module intercepts stdout writes globally so they route to stderr instead,
 * while exposing `unsafeWriteStdout()` for the CLI's own envelope emission.
 *
 * Install order: detectModesFromArgv() → installStdoutGuard() → commander.parse().
 */

import { format } from 'util';

let _installed = false;
let _originalStdoutWrite: typeof process.stdout.write | null = null;
let _originalConsoleLog: typeof console.log | null = null;
let _originalConsoleInfo: typeof console.info | null = null;
let _originalConsoleDebug: typeof console.debug | null = null;

/**
 * Redirect all stdout writes to stderr. Idempotent.
 *
 * After this runs, `console.log()` from any source — adapter, reporter,
 * orchestrator, third-party lib — emits to stderr instead of stdout.
 *
 * Use `unsafeWriteStdout()` to write to the original stdout (envelope emission).
 */
export function installStdoutGuard(): void {
  if (_installed) return;
  _installed = true;

  _originalStdoutWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  _originalConsoleLog = console.log.bind(console);
  _originalConsoleInfo = console.info.bind(console);
  _originalConsoleDebug = console.debug.bind(console);

  // Redirect process.stdout.write → process.stderr.write.
  // Anything writing through Node's stdout stream (including console.log when
  // it hasn't been further patched) ends up on stderr.
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    return (process.stderr.write as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;

  // Patch the common console methods directly too. Each writes via util.format
  // → process.stderr.write so the patch doesn't depend on Node's internal
  // console-to-stream wiring (which differs per method).
  const writeStderr = (args: unknown[]): void => {
    process.stderr.write(format(...args) + '\n');
  };
  console.log = (...args: unknown[]): void => writeStderr(args);
  console.info = (...args: unknown[]): void => writeStderr(args);
  console.debug = (...args: unknown[]): void => writeStderr(args);
}

/**
 * Restore the original stdout.write and console methods. Idempotent.
 *
 * Tests use this to undo the patch between cases.
 */
export function uninstallStdoutGuard(): void {
  if (!_installed) return;
  _installed = false;
  if (_originalStdoutWrite) process.stdout.write = _originalStdoutWrite;
  if (_originalConsoleLog)  console.log  = _originalConsoleLog;
  if (_originalConsoleInfo) console.info = _originalConsoleInfo;
  if (_originalConsoleDebug) console.debug = _originalConsoleDebug;
  _originalStdoutWrite = null;
  _originalConsoleLog = null;
  _originalConsoleInfo = null;
  _originalConsoleDebug = null;
}

/**
 * Write to the original (un-redirected) stdout. The CLI's envelope emitter
 * uses this so the JSON envelope reaches actual stdout even when the guard
 * is installed.
 */
export function unsafeWriteStdout(s: string): void {
  if (_originalStdoutWrite) {
    _originalStdoutWrite(s);
  } else {
    process.stdout.write(s);
  }
}

/** Test-only: report whether the guard is currently installed. */
export function isStdoutGuardInstalled(): boolean {
  return _installed;
}
