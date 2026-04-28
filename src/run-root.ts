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
