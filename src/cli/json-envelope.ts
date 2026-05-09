/**
 * CLI JSON output envelope and outcome taxonomy for `fab`.
 *
 * Three uniform outcome categories — see docs/cli-json-output.md for the full
 * caller contract. In short:
 *
 *   1. Success                       → status:"ok",    data: <command-shape> | {ok:true,...},  exit 0
 *   2. Domain check failed (ran ok)  → status:"ok",    data: {ok:false, ...details},           exit 1
 *   3. Infrastructure / runtime err  → status:"error", error: {message, code?, stack?},        exit 1
 *
 * Automation must key off BOTH the process exit code AND the envelope fields:
 *   - `status`   describes infrastructure outcome ("did the tool itself succeed?")
 *   - `data.ok`  describes domain outcome where applicable ("did the input pass the check?")
 *
 * In `--json` mode, stdout contains exactly one JSON object on every invocation.
 * In default text mode, no envelope is written; callers see the existing human-readable framing.
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export interface OkEnvelope {
  command: string;
  status: 'ok';
  data: unknown;
  runRoot?: string;
  /** Suggested follow-up command string (e.g. "fab inspect --root ..."). */
  next?: string;
}

export interface ErrorEnvelope {
  command: string;
  status: 'error';
  error: {
    message: string;
    code?: string;
    /** Only included when FAB_DEBUG=1 or --debug. */
    stack?: string;
  };
  runRoot?: string;
}

export type FabResult = OkEnvelope | ErrorEnvelope;

// ---------------------------------------------------------------------------
// JSON-mode flag (set by detectJsonModeFromArgv before commander parses)
// ---------------------------------------------------------------------------

let _jsonMode = false;
let _debugMode = false;

export function setJsonMode(v: boolean): void { _jsonMode = v; }
export function isJsonMode(): boolean { return _jsonMode; }

export function setDebugMode(v: boolean): void { _debugMode = v; }
export function isDebugMode(): boolean { return _debugMode; }

/**
 * Pre-commander argv scan. Sets the `--json` and `--debug` flags by inspecting
 * raw process.argv so even commander parse failures (unknown command, missing
 * required option) emit a JSON envelope when the caller asked for one.
 *
 * Also respects FAB_DEBUG=1 for stack-trace inclusion in error envelopes.
 */
export function detectModesFromArgv(argv: string[] = process.argv): void {
  _jsonMode = argv.includes('--json');
  _debugMode = argv.includes('--debug') || process.env.FAB_DEBUG === '1';
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Infrastructure / runtime error thrown from inside a command action.
 * Caught by the top-level handler and emitted as an ErrorEnvelope.
 */
export class FabError extends Error {
  readonly code?: string;
  readonly runRoot?: string;
  constructor(message: string, opts: { code?: string; runRoot?: string } = {}) {
    super(message);
    this.name = 'FabError';
    this.code = opts.code;
    this.runRoot = opts.runRoot;
  }
}

// ---------------------------------------------------------------------------
// Emitters — each writes one envelope (when --json) and exits with the right code
// ---------------------------------------------------------------------------

// Lazy-imported so this module stays usable in unit tests that don't install the guard.
function writeEnvelope(result: FabResult): void {
  if (!_jsonMode) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { unsafeWriteStdout } = require('./stdout-guard') as typeof import('./stdout-guard');
  unsafeWriteStdout(JSON.stringify(result) + '\n');
}

/** Success outcome (status:"ok"). Exits with code 0. */
export function emitOk(
  command: string,
  data: unknown,
  opts: { runRoot?: string; next?: string } = {},
): never {
  writeEnvelope({ command, status: 'ok', data, runRoot: opts.runRoot, next: opts.next });
  process.exit(0);
}

/**
 * Domain-failure outcome (status:"ok", data:{ok:false,...}). Exits with code 1.
 *
 * Use when the tool ran successfully but the input failed a check
 * (e.g. `fab check` below threshold, `fab adapter validate` found errors,
 *  `fab doctor` reported a fail-tier check).
 */
export function emitDomainFailure(
  command: string,
  data: { ok: false } & Record<string, unknown>,
  opts: { runRoot?: string; next?: string } = {},
): never {
  writeEnvelope({ command, status: 'ok', data, runRoot: opts.runRoot, next: opts.next });
  process.exit(1);
}

/**
 * Infrastructure-error outcome (status:"error"). Exits with code 1 (or opts.exitCode).
 *
 * Use when the tool itself could not run (missing file, parse error, bad input,
 * unexpected exception). Reserved STRICTLY for tool failures — domain check
 * failures use emitDomainFailure.
 */
export function emitError(
  command: string,
  err: { message: string; code?: string; stack?: string },
  opts: { runRoot?: string; exitCode?: number } = {},
): never {
  const errorPayload: ErrorEnvelope['error'] = { message: err.message };
  if (err.code) errorPayload.code = err.code;
  if (err.stack && _debugMode) errorPayload.stack = err.stack;
  writeEnvelope({ command, status: 'error', error: errorPayload, runRoot: opts.runRoot });
  process.exit(opts.exitCode ?? 1);
}

/**
 * Top-level error handler for parseAsync().catch() and pre-commander failures.
 * Tries to extract a command name from argv; falls back to "fab".
 */
export function emitTopLevelError(err: unknown, argv: string[] = process.argv): never {
  const command = inferCommandFromArgv(argv);
  if (err instanceof FabError) {
    return emitError(command, { message: err.message, code: err.code, stack: err.stack }, { runRoot: err.runRoot });
  }
  if (err instanceof Error) {
    return emitError(command, { message: err.message, stack: err.stack });
  }
  return emitError(command, { message: String(err) });
}

function inferCommandFromArgv(argv: string[]): string {
  // argv[0] = node, argv[1] = fab.ts (or fab.js)
  // First non-flag after the script is the command.
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a && !a.startsWith('-')) return a;
  }
  return 'fab';
}
