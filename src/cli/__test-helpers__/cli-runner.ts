// Test-only helper: spawn the fab CLI as a subprocess and capture stdout/stderr separately.
// Excluded from dist via tsconfig (`**/__test-helpers__/**`).

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface RunFabOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
}

export interface RunFabResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
}

const REPO_ROOT = path.resolve(__dirname, '../../..');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const FAB_SRC = path.join(REPO_ROOT, 'src', 'cli', 'fab.ts');
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Spawn `tsx src/cli/fab.ts <args>` as a subprocess. Captures stdout, stderr, and exit code
 * separately so tests can assert stdout-purity (only one JSON envelope on stdout when --json
 * is set; progress lines on stderr).
 */
export async function runFab(args: string[], opts: RunFabOptions = {}): Promise<RunFabResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise<RunFabResult>((resolve, reject) => {
    // Isolate state writeback from the dev's real ~/.fab unless the test
    // explicitly provides FAB_STATE_DIR. Each runFab call gets its own tmp dir.
    const isolatedStateDir = opts.env?.FAB_STATE_DIR
      ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fab-test-state-'));

    const child = spawn(TSX_BIN, [FAB_SRC, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, FAB_STATE_DIR: isolatedStateDir, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Escalate to SIGKILL if still alive after 2s
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2_000);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

/**
 * Parse stdout as a single JSON envelope. Throws if not exactly one parseable JSON object.
 * Used by --json round-trip tests to enforce the stdout-purity contract.
 */
export function parseSingleEnvelope(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('Expected one JSON envelope on stdout, got empty output');
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed;
  } catch (err) {
    throw new Error(
      `Expected one JSON envelope on stdout, JSON.parse failed: ${(err as Error).message}\n` +
      `Stdout (${trimmed.length} chars): ${trimmed.slice(0, 500)}${trimmed.length > 500 ? '…' : ''}`
    );
  }
}

/**
 * Extract lines from stdout that begin with the CLI's own framing prefix `[fab ...]`.
 * Used by backward-compat snapshot tests to focus on the CLI's framing
 * (the bit at risk from stderr-redirect refactor) rather than the noisy loop body.
 */
export function extractFabFraming(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => /^\[fab\b/.test(line));
}
