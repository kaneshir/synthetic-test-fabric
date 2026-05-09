/**
 * Cross-run state for `fab status`. Persists last-command summary so an agent
 * can answer "where am I" with one call instead of grepping iterRoot artifacts.
 *
 * Storage: `~/.fab/state.json` (overridable via `FAB_STATE_DIR` env var).
 * Writes are atomic (write-tmp → rename) so concurrent invocations never
 * leave a torn file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type LastRootKind = 'persistent' | 'ephemeral_kept' | 'ephemeral_deleted';

export interface FabState {
  lastRoot: string | null;
  lastIteration: number | null;
  lastRootKind: LastRootKind | null;
  lastScore: number | null;
  lastPhase: string | null;
  lastFailure: { phase: string; message: string } | null;
  lastCommand: string;
  lastTimestamp: string;          // ISO8601
}

const STATE_FILE = 'state.json';

/** Resolve the state directory, respecting the FAB_STATE_DIR env var. */
export function getStateDir(): string {
  return process.env.FAB_STATE_DIR ?? path.join(os.homedir(), '.fab');
}

/** Resolve the absolute path to state.json. */
export function getStatePath(): string {
  return path.join(getStateDir(), STATE_FILE);
}

/**
 * Read the current state, or null if no state file exists.
 *
 * Throws if the file exists but is unreadable or unparseable — callers
 * (typically `fab status`) should surface that as an infrastructure error
 * via the #18 envelope taxonomy.
 */
export function readState(): FabState | null {
  const p = getStatePath();
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as FabState;
}

/**
 * Write state atomically: write to `state.json.tmp`, then rename.
 *
 * The rename is atomic on POSIX, so a concurrent reader either sees the old
 * file or the new one — never a torn write.
 */
export function writeState(state: FabState): void {
  const dir = getStateDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = getStatePath();
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
}

export interface RecordCommandOpts {
  command: string;
  lastRoot?: string | null;
  lastIteration?: number | null;
  lastRootKind?: LastRootKind | null;
  lastScore?: number | null;
  lastPhase?: string | null;
  lastFailure?: { phase: string; message: string } | null;
}

/**
 * Build a complete FabState from the call-site fields and write it atomically.
 *
 * Best-effort: never throws. State writeback failures shouldn't sink the
 * underlying command.
 */
export function recordCommand(opts: RecordCommandOpts): void {
  try {
    writeState({
      lastRoot:       opts.lastRoot       ?? null,
      lastIteration:  opts.lastIteration  ?? null,
      lastRootKind:   opts.lastRootKind   ?? null,
      lastScore:      opts.lastScore      ?? null,
      lastPhase:      opts.lastPhase      ?? null,
      lastFailure:    opts.lastFailure    ?? null,
      lastCommand:    opts.command,
      lastTimestamp:  new Date().toISOString(),
    });
  } catch {
    // Intentionally swallow — state writeback is best-effort.
  }
}
