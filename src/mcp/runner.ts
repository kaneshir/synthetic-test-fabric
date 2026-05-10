/**
 * Subprocess wrapper for the MCP server. Spawns the bundled `fab` CLI with
 * `--json` and captures the envelope from stdout.
 *
 * Path resolution is relative to THIS module (not cwd), so `fab-mcp` works
 * when launched from any consumer directory — not just the package root.
 *
 * Stdout-purity is preserved end-to-end:
 *  - `--json` mode guarantees one JSON envelope on child stdout (per #18)
 *  - We read child stdout to parse the envelope
 *  - Child stderr is forwarded as MCP `notifications/message` log lines so
 *    the agent sees adapter progress without it polluting the result
 */

import { spawn } from 'child_process';
import * as path from 'path';

/** Path to the bundled `fab` CLI, resolved relative to this compiled module. */
export const FAB_CLI_PATH = path.resolve(__dirname, '..', 'cli', 'fab.js');

/**
 * Read FAB_MCP_TIMEOUT_MS env var as a positive integer, returning undefined
 * when unset, empty, or unparseable (so the caller's fallback chain works).
 *
 * Exported so the MCP server can apply the env override at the server layer
 * before passing an explicit timeoutMs into runFabCommand.
 */
export function resolveEnvTimeoutMs(): number | undefined {
  const raw = process.env.FAB_MCP_TIMEOUT_MS;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export interface RunFabResult {
  /** Parsed envelope from child stdout (single JSON object per #18 contract). */
  envelope: Record<string, unknown>;
  /** Captured stderr (may be multi-line). Forwarded as MCP log notifications. */
  stderr: string;
  /** Process exit code; null if killed by signal. */
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** True if the wall-clock timeout fired. */
  timedOut: boolean;
}

export interface RunFabOptions {
  /** Working directory for the child. Defaults to process.cwd() at server start. */
  cwd?: string;
  /** Per-call timeout in ms. Falls back to FAB_MCP_TIMEOUT_MS env, then defaults. */
  timeoutMs?: number;
  /** Optional callback for stderr lines as they arrive (for MCP log forwarding). */
  onStderrLine?: (line: string) => void;
  /** Extra env passthrough. FAB_CONFIG_PATH and FAB_STATE_DIR auto-propagate. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn the bundled `fab` CLI with the given args + `--json`, return the
 * parsed envelope. Throws on subprocess crash, non-JSON stdout, or timeout —
 * caller (mcp/server.ts) maps those to MCP error responses with the right
 * synthesized envelope.
 */
export async function runFabCommand(
  args: string[],
  opts: RunFabOptions = {},
): Promise<RunFabResult> {
  // Resolve timeout precedence: per-call > FAB_MCP_TIMEOUT_MS env > 30s default.
  // Important: ?? only catches null/undefined, not NaN — so guard against
  // `Number(undefined) === NaN` and unparseable env values explicitly.
  const timeoutMs = opts.timeoutMs ?? resolveEnvTimeoutMs() ?? 30_000;
  const argv = [...args, '--json'];

  return new Promise<RunFabResult>((resolve, reject) => {
    // Always spawn via process.execPath (the running Node binary) so we don't
    // assume `node` is on PATH or the right version.
    const child = spawn(process.execPath, [FAB_CLI_PATH, ...argv], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stderrBuffer = '';
    let timedOut = false;

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      // Stream stderr line-by-line to the MCP log forwarder.
      stderrBuffer += text;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length > 0 && opts.onStderrLine) opts.onStderrLine(line);
      }
    });

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Escalate to SIGKILL after 5s if the child hasn't exited.
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5_000);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(killTimer);
      reject(err);
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(killTimer);

      // Flush any unterminated final stderr line.
      if (stderrBuffer.length > 0 && opts.onStderrLine) {
        opts.onStderrLine(stderrBuffer);
      }

      if (timedOut) {
        resolve({
          envelope: synthesizedTimeoutEnvelope(args, timeoutMs, stderr),
          stderr,
          exitCode,
          signal,
          timedOut: true,
        });
        return;
      }

      // Try to parse stdout as the single envelope per #18 contract.
      let envelope: Record<string, unknown>;
      try {
        const trimmed = stdout.trim();
        if (!trimmed) {
          envelope = synthesizedSubprocessEnvelope(args, exitCode, 'subprocess produced no stdout', stderr);
        } else {
          envelope = JSON.parse(trimmed) as Record<string, unknown>;
        }
      } catch (err) {
        envelope = synthesizedSubprocessEnvelope(
          args,
          exitCode,
          `subprocess stdout was not parseable JSON: ${(err as Error).message}`,
          stderr,
        );
      }

      resolve({ envelope, stderr, exitCode, signal, timedOut: false });
    });

    child.stdin.end();
  });
}

function synthesizedTimeoutEnvelope(args: string[], timeoutMs: number, stderr: string): Record<string, unknown> {
  return {
    command: args[0] ?? 'fab',
    status: 'error',
    error: {
      message: `fab subprocess exceeded ${timeoutMs}ms timeout and was killed`,
      code: 'TIMEOUT',
      stderr_tail: stderr.split('\n').slice(-50).join('\n'),
    },
  };
}

function synthesizedSubprocessEnvelope(
  args: string[],
  exitCode: number | null,
  message: string,
  stderr: string,
): Record<string, unknown> {
  return {
    command: args[0] ?? 'fab',
    status: 'error',
    error: {
      message,
      code: 'SUBPROCESS_FAILED',
      exit_code: exitCode,
      stderr_tail: stderr.split('\n').slice(-50).join('\n'),
    },
  };
}
