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
 * Accept a loopRoot or iterRoot path; return the loopRoot.
 *
 * If `input` is already a loop root (detected or explicit), returns it unchanged.
 * If `input` is an iter root (e.g. `/foo/iter-002`), returns the parent.
 *
 * Throws on ambiguous or unknown inputs — callers should have classified first
 * if they want to disambiguate.
 */
export function resolveLoopRoot(input: string): string {
  const kind = detectRootKind(input);
  switch (kind) {
    case 'loop':       return input;
    case 'iteration':  return path.dirname(input);
    case 'ambiguous':  throw new Error(`resolveLoopRoot: path is ambiguous (looks like both loop and iter): ${input}`);
    case 'unknown':    throw new Error(`resolveLoopRoot: path does not look like a loop or iter root: ${input}`);
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
      throw new Error(`resolveIterRoot: path is ambiguous (looks like both loop and iter): ${input}`);
    case 'unknown':
      throw new Error(`resolveIterRoot: path does not look like a loop or iter root: ${input}`);
  }
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
