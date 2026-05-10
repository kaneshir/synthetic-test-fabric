import * as fs from 'fs';
import * as path from 'path';

export interface LoopIterationPaths {
  iterRoot: string;
  lisaDbPath: string;
  miniSimExportPath: string;
  candidateFlowsPath: string;
  flowResultsJsonPath: string;
  generatedFlowResultsJsonPath: string;
  fabricScorePath: string;
  fabricFeedbackPath: string;
}

export function resolveLoopPaths(loopRoot: string, iterNum: number): LoopIterationPaths {
  const iterRoot = path.join(loopRoot, `iter-${String(iterNum).padStart(3, '0')}`);
  return {
    iterRoot,
    lisaDbPath: path.join(iterRoot, '.lisa_memory', 'lisa.db'),
    miniSimExportPath: path.join(iterRoot, 'mini-sim-export.json'),
    candidateFlowsPath: path.join(iterRoot, 'candidate_flows.yaml'),
    flowResultsJsonPath: path.join(iterRoot, 'flow-results.json'),
    generatedFlowResultsJsonPath: path.join(iterRoot, 'generated-flow-results.json'),
    fabricScorePath: path.join(iterRoot, 'fabric-score.json'),
    fabricFeedbackPath: path.join(iterRoot, 'fabric-feedback.json'),
  };
}

export function makeLoopId(): string {
  return `fabric-loop-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Root-kind detection and normalization (foundation for #19 / #20)
// ---------------------------------------------------------------------------

export type RootKind = 'loop' | 'iteration' | 'ambiguous' | 'unknown';

const ITER_DIR_RE = /^iter-\d{3}$/;

/**
 * Classify a directory as a loopRoot, an iterRoot, ambiguous, or unknown.
 *
 * Decision rules (applied in order):
 *  1. Path doesn't exist → throws (caller treats as infrastructure error)
 *  2. Has both `iter-NNN/` subdirs AND `fabric-score.json` → "ambiguous"
 *  3. Has any `iter-NNN/` subdir, OR a `current` symlink, OR is an empty directory → "loop"
 *  4. Has `fabric-score.json` directly inside → "iteration"
 *  5. Exists with files but matches none of the above → "unknown"
 */
export function detectRootKind(dir: string): RootKind {
  if (!fs.existsSync(dir)) {
    throw new Error(`detectRootKind: path does not exist: ${dir}`);
  }
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    return 'unknown';
  }

  const entries = fs.readdirSync(dir);
  const hasIterDirs = entries.some((e) => {
    if (!ITER_DIR_RE.test(e)) return false;
    try { return fs.statSync(path.join(dir, e)).isDirectory(); } catch { return false; }
  });
  const hasCurrentSymlink = (() => {
    try { return fs.lstatSync(path.join(dir, 'current')).isSymbolicLink(); } catch { return false; }
  })();
  const hasScoreFile = entries.includes('fabric-score.json');

  // Rule 2: both shapes present → ambiguous
  if ((hasIterDirs || hasCurrentSymlink) && hasScoreFile) return 'ambiguous';
  // Rule 3: loop shape
  if (hasIterDirs || hasCurrentSymlink) return 'loop';
  // Rule 3 cont'd: empty dir is loop intent (caller likely just `mkdir`'d)
  if (entries.length === 0) return 'loop';
  // Rule 4: iteration shape
  if (hasScoreFile) return 'iteration';
  // Rule 5: has files but matches nothing
  return 'unknown';
}

/**
 * Typed error: `detectRootKind()` returned `"ambiguous"` (a directory that
 * could plausibly be either a loop root or an iteration root). Caller should
 * disambiguate by passing `--kind loop` or `--kind iteration` explicitly.
 *
 * Surfaces via the #18 envelope as `{status: "error", error: {code: "AMBIGUOUS_ROOT"}}`.
 */
export class AmbiguousRootError extends Error {
  readonly code = 'AMBIGUOUS_ROOT';
  readonly suggestions: string[];
  constructor(dir: string) {
    super(`path is ambiguous (looks like both loop and iter root): ${dir}`);
    this.name = 'AmbiguousRootError';
    this.suggestions = [
      `pass --kind loop to inspect as a loop root`,
      `pass --kind iteration to inspect as a single iteration`,
    ];
  }
}

/**
 * Typed error: directory exists but matches neither loop nor iteration shape.
 *
 * Surfaces via the #18 envelope as `{status: "error", error: {code: "UNKNOWN_ROOT"}}`.
 */
export class UnknownRootError extends Error {
  readonly code = 'UNKNOWN_ROOT';
  constructor(dir: string) {
    super(`path does not look like a loop root or iteration root: ${dir}`);
    this.name = 'UnknownRootError';
  }
}

/**
 * Accept a loopRoot or iterRoot path; return the loopRoot.
 *
 * If `input` is already a loop root (detected or explicit), returns it unchanged.
 * If `input` is an iter root (e.g. `/foo/iter-002`), returns the parent.
 *
 * Throws AmbiguousRootError / UnknownRootError so callers can branch on the
 * typed error code.
 */
export function resolveLoopRoot(input: string): string {
  const kind = detectRootKind(input);
  switch (kind) {
    case 'loop':       return input;
    case 'iteration':  return path.dirname(input);
    case 'ambiguous':  throw new AmbiguousRootError(input);
    case 'unknown':    throw new UnknownRootError(input);
  }
}

/**
 * Accept a loopRoot or iterRoot path; return the iterRoot to inspect.
 *
 * - If `input` is a loop root: returns iter at `iteration` (default: latest existing
 *   iter-NNN, or iter-001 if none exist yet).
 * - If `input` is an iter root: returns it unchanged (the caller already picked one).
 *
 * Throws on ambiguous or unknown inputs.
 */
export function resolveIterRoot(input: string, iteration?: number): string {
  const kind = detectRootKind(input);
  switch (kind) {
    case 'iteration':
      return input;
    case 'loop': {
      if (iteration !== undefined) {
        return path.join(input, `iter-${String(iteration).padStart(3, '0')}`);
      }
      const entries = fs.readdirSync(input).filter((e) => ITER_DIR_RE.test(e)).sort();
      const latest = entries[entries.length - 1];
      return latest ? path.join(input, latest) : path.join(input, 'iter-001');
    }
    case 'ambiguous':
      throw new AmbiguousRootError(input);
    case 'unknown':
      throw new UnknownRootError(input);
  }
}

// ---------------------------------------------------------------------------
// inspectRunRoot — structured summary of a loop or iteration root
// ---------------------------------------------------------------------------

/** Compact representation of a single behavior event for `fab inspect`. */
export interface BehaviorEventSummary {
  recorded_at: string;
  tick: number;
  action: string;
  outcome: string;
  event_kind: string;
  screen_path: string | null;
}

export type RunPhase =
  | 'SEED' | 'VERIFY' | 'RUN' | 'ANALYZE' | 'GENERATE_FLOWS'
  | 'TEST' | 'SCORE' | 'FEEDBACK' | 'UNKNOWN';

/**
 * Structured summary of a run root, returned by `inspectRunRoot()`.
 *
 * `schemaVersion: 1` is required so future readers can detect drift.
 * `rootKind` only ever holds `"loop"` or `"iteration"` — the `"ambiguous"` and
 * `"unknown"` cases throw typed errors instead of returning a summary.
 */
export interface RunRootSummary {
  schemaVersion: 1;
  rootKind: 'loop' | 'iteration';
  loopRoot: string;
  iterRoot: string;
  iteration: number;                          // 0 for empty loop dirs
  phase: RunPhase;
  score: { overall: number; dimensions: Record<string, number> } | null;
  flows: { passed: number; failed: number; total: number } | null;
  errors: Array<{ phase: string; message: string }>;
  screenshotPath: string | null;
  lastBehaviorEvents: BehaviorEventSummary[]; // last 10 from .lisa_memory/lisa.db
  partial: boolean;                           // true if any expected artifact missing
  parseErrors: string[];                      // non-fatal artifact parse failures
}

/**
 * Inspect a run root and return a structured summary. Reads `fabric-score.json`,
 * `flow-results.json`, behavior events from `.lisa_memory/lisa.db`, and the
 * latest screenshot under `visual-results/`.
 *
 * Auto-detects whether `dir` is a loop root or an iteration root via
 * `detectRootKind()`. Pass `opts.kind` to force one interpretation when
 * the path is ambiguous.
 *
 * Throws on:
 *  - non-existent path (caller surfaces as infrastructure error)
 *  - `AmbiguousRootError` when shape is ambiguous and `opts.kind` not provided
 *  - `UnknownRootError` when path matches neither shape
 *
 * Never throws on missing artifacts inside a valid root — those populate
 * `parseErrors` and set `partial: true`.
 */
export function inspectRunRoot(
  dir: string,
  opts?: { kind?: 'loop' | 'iteration' },
): RunRootSummary {
  if (!fs.existsSync(dir)) {
    throw new Error(`inspectRunRoot: path does not exist: ${dir}`);
  }

  // Resolve the kind. Caller-provided opts.kind takes precedence and bypasses
  // the ambiguity throw.
  let kind: 'loop' | 'iteration';
  if (opts?.kind) {
    kind = opts.kind;
  } else {
    const detected = detectRootKind(dir);
    if (detected === 'ambiguous') throw new AmbiguousRootError(dir);
    if (detected === 'unknown')   throw new UnknownRootError(dir);
    kind = detected;
  }

  // Resolve loopRoot + iterRoot + iteration based on kind.
  let loopRoot: string;
  let iterRoot: string;
  let iteration: number;

  if (kind === 'iteration') {
    iterRoot = path.resolve(dir);
    loopRoot = path.dirname(iterRoot);
    const m = path.basename(iterRoot).match(/^iter-(\d{3})$/);
    iteration = m ? parseInt(m[1], 10) : 0;
  } else {
    loopRoot = path.resolve(dir);
    const iterEntries = fs.existsSync(loopRoot)
      ? fs.readdirSync(loopRoot).filter((e) => ITER_DIR_RE.test(e)).sort()
      : [];
    if (iterEntries.length === 0) {
      // Empty loop dir — no iterations yet. Return partial summary.
      return {
        schemaVersion: 1,
        rootKind: 'loop',
        loopRoot,
        iterRoot: path.join(loopRoot, 'iter-001'),
        iteration: 0,
        phase: 'UNKNOWN',
        score: null,
        flows: null,
        errors: [],
        screenshotPath: null,
        lastBehaviorEvents: [],
        partial: true,
        parseErrors: ['no iteration directories found under loop root'],
      };
    }
    const latest = iterEntries[iterEntries.length - 1];
    iterRoot = path.join(loopRoot, latest);
    iteration = parseInt(latest.slice('iter-'.length), 10);
  }

  const parseErrors: string[] = [];
  const errors: Array<{ phase: string; message: string }> = [];
  let partial = false;

  // ── fabric-score.json ────────────────────────────────────────────
  let score: RunRootSummary['score'] = null;
  const scorePath = path.join(iterRoot, 'fabric-score.json');
  if (fs.existsSync(scorePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
      score = {
        overall: typeof raw.overall === 'number' ? raw.overall : 0,
        dimensions: (raw.dimensions && typeof raw.dimensions === 'object') ? raw.dimensions : {},
      };
    } catch (err) {
      parseErrors.push(`fabric-score.json parse failed: ${(err as Error).message}`);
    }
  } else {
    partial = true;
  }

  // ── flow-results.json ────────────────────────────────────────────
  let flows: RunRootSummary['flows'] = null;
  const flowsPath = path.join(iterRoot, 'flow-results.json');
  if (fs.existsSync(flowsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));
      const stats = raw?.stats ?? {};
      const passed = typeof stats.expected === 'number' ? stats.expected : 0;
      const failed = typeof stats.unexpected === 'number' ? stats.unexpected : 0;
      const flaky = typeof stats.flaky === 'number' ? stats.flaky : 0;
      flows = { passed, failed, total: passed + failed + flaky };
    } catch (err) {
      parseErrors.push(`flow-results.json parse failed: ${(err as Error).message}`);
    }
  }

  // ── behavior events from .lisa_memory/lisa.db ─────────────────────
  let lastBehaviorEvents: BehaviorEventSummary[] = [];
  const dbPath = path.join(iterRoot, '.lisa_memory', 'lisa.db');
  if (fs.existsSync(dbPath)) {
    try {
      // Lazy-load better-sqlite3 to keep inspectRunRoot cheap when no db exists.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const BetterSqlite3 = require('better-sqlite3');
      const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
      try {
        const rows = db.prepare(
          `SELECT recorded_at, tick, action, outcome, event_kind, screen_path
             FROM behavior_events
             ORDER BY recorded_at DESC, sequence_in_tick DESC
             LIMIT 10`,
        ).all() as BehaviorEventSummary[];
        lastBehaviorEvents = rows;
      } finally {
        db.close();
      }
    } catch (err) {
      parseErrors.push(`lisa.db read failed: ${(err as Error).message}`);
    }
  }

  // ── latest screenshot ───────────────────────────────────────────
  let screenshotPath: string | null = null;
  const visualDir = path.join(iterRoot, 'visual-results');
  if (fs.existsSync(visualDir)) {
    const flowDirs = fs.readdirSync(visualDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    let newest: { p: string; mtime: number } | null = null;
    for (const flow of flowDirs) {
      const candidate = path.join(visualDir, flow, 'current.png');
      if (fs.existsSync(candidate)) {
        const mtime = fs.statSync(candidate).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { p: candidate, mtime };
      }
    }
    screenshotPath = newest?.p ?? null;
  }

  // ── phase inference (highest-reached heuristic) ──────────────────
  const phase: RunPhase = (() => {
    if (fs.existsSync(path.join(iterRoot, 'fabric-feedback.json'))) return 'FEEDBACK';
    if (score) return 'SCORE';
    if (flows) return 'TEST';
    if (fs.existsSync(path.join(iterRoot, 'candidate_flows.yaml'))) return 'GENERATE_FLOWS';
    if (lastBehaviorEvents.length > 0) return 'RUN';
    if (fs.existsSync(path.join(iterRoot, 'mini-sim-export.json'))) return 'SEED';
    return 'UNKNOWN';
  })();

  return {
    schemaVersion: 1,
    rootKind: kind,
    loopRoot,
    iterRoot,
    iteration,
    phase,
    score,
    flows,
    errors,
    screenshotPath,
    lastBehaviorEvents,
    partial,
    parseErrors,
  };
}

export const FABRIC_SEAL_FILE = '.fabric-sealed';

/**
 * Guards write-mutating commands from running against a sealed run root.
 * Read-only commands (analyze, score, report) do NOT call this.
 */
export function assertCanWriteRunRoot(runRoot: string, command: string): void {
  const sealFile = path.join(runRoot, FABRIC_SEAL_FILE);
  if (fs.existsSync(sealFile)) {
    const simulationId = fs.readFileSync(sealFile, 'utf-8').trim();
    throw new Error(
      `[${command}] Run root is sealed (simulation ${simulationId}). ` +
      `Sealed roots are immutable. Use a fresh run root to reseed.`
    );
  }
}

/**
 * Write the seal at the end of a successful verify Mode B pass.
 * Only verify Mode B calls this — no other command writes the seal.
 */
export function sealRunRoot(runRoot: string, simulationId: string): void {
  fs.writeFileSync(path.join(runRoot, FABRIC_SEAL_FILE), simulationId, 'utf-8');
}

/**
 * Read and validate LISA_SIMULATION_ID from ENV.
 * Commands that cannot find it (and are not creating a new run) exit 1.
 */
export function requireSimulationId(context: string): string {
  const id = process.env.LISA_SIMULATION_ID?.trim();
  if (!id) {
    throw new Error(
      `[${context}] LISA_SIMULATION_ID is not set. ` +
      `Run the fabric seed step first, or set the ENV var explicitly.`
    );
  }
  return id;
}

/**
 * Validate that an artifact file includes a top-level simulation_id field.
 * Exits with an error rather than proceeding with a null join key.
 */
export function requireArtifactSimulationId(
  filePath: string,
  artifactName: string
): string {
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    throw new Error(`[artifact] Cannot read ${artifactName} at ${filePath}: ${err}`);
  }
  if (!parsed?.simulation_id?.trim()) {
    throw new Error(
      `[artifact] ${artifactName} at ${filePath} is missing top-level simulation_id. ` +
      `Re-seed to generate a valid artifact.`
    );
  }
  return parsed.simulation_id;
}
