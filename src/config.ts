import * as fs from 'fs';
import * as path from 'path';

export interface SyntheticConfig {
  projectRoot: string;
  playwrightCwd: string;        // directory containing playwright.config.ts
  cliBinPath: string;           // path to the CLI binary (run.cjs or equivalent)
  knownFlowsPath: string;       // path to flows.yaml for known-paths diffing
  scorecardScriptPath?: string; // path to testing-scorecard.js (optional)
}

const CONFIG_FILENAMES = ['synthetic.config.js', 'synthetic.config.ts'];

/**
 * Walk up from startDir looking for synthetic.config.js (or .ts compiled to .js).
 * Returns the SyntheticConfig default export when found.
 * Throws a descriptive error if no config file is found.
 */
export function loadSyntheticConfig(startDir?: string): SyntheticConfig {
  const start = path.resolve(startDir ?? process.cwd());
  let currentDir = start;

  while (currentDir !== path.parse(currentDir).root) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(currentDir, filename);
      if (fs.existsSync(candidate)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(candidate) as { default?: SyntheticConfig } | SyntheticConfig;
        const config: SyntheticConfig | undefined =
          (mod as { default?: SyntheticConfig }).default ?? (mod as SyntheticConfig);
        const REQUIRED: Array<keyof SyntheticConfig> = ['projectRoot', 'playwrightCwd', 'cliBinPath', 'knownFlowsPath'];
        const missing = REQUIRED.filter((k) => typeof (config as unknown as Record<string, unknown>)?.[k] !== 'string');
        if (!config || missing.length > 0) {
          throw new Error(
            `synthetic.config.js found at ${candidate} but is missing required fields: ${missing.join(', ')}. ` +
            `Ensure it exports a 'default' object with projectRoot, playwrightCwd, cliBinPath, and knownFlowsPath.`,
          );
        }
        return config;
      }
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  throw new Error(
    'synthetic.config.js not found — create one at your project root. ' +
    'See docs/testing/test-fabric-extraction-boundary-map.md',
  );
}
