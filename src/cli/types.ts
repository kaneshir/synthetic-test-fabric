import type { OrchestratorAdapters, OrchestratorOptions } from '../orchestrator';

export interface FabricConfig {
  adapters: OrchestratorAdapters;
  defaults?: Partial<OrchestratorOptions>;
  /**
   * Directory where visual regression baselines are stored.
   * Defaults to `.fab-baselines/` in process.cwd().
   * Commit for small projects; gitignore + CI artifact storage for large ones.
   */
  baselineDir?: string;
}
