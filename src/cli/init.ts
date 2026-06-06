/**
 * `fab init` and `fab adapter scaffold` — project + per-adapter scaffolders.
 *
 * `scaffoldProject(opts)` writes a complete starter tree (fabric.config.ts +
 * 8 adapter stubs + flows/.gitkeep). `scaffoldAdapter(type, opts)` writes a
 * single adapter file for one of the 8 supported interfaces.
 *
 * Both commands share the same `ADAPTER_TEMPLATES` registry so the generated
 * code is consistent across `fab init` and `fab adapter scaffold`.
 *
 * Stub policy: required interface methods throw `new Error('TODO: implement
 * <method>')` so unimplemented adapters fail loudly. Optional methods (reset,
 * clean, validateEnvironment, importRun) are no-ops by default.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Adapter type registry
// ---------------------------------------------------------------------------

/** All 8 adapter types fab knows how to scaffold. */
export const ADAPTER_TYPES = [
  'app', 'simulation', 'scoring', 'feedback',
  'memory', 'browser', 'reporter', 'planner',
] as const;

export type AdapterType = typeof ADAPTER_TYPES[number];

/** Interface name (in the synthetic-test-fabric package) for each adapter type. */
export const ADAPTER_INTERFACES: Record<AdapterType, string> = {
  app:        'AppAdapter',
  simulation: 'SimulationAdapter',
  scoring:    'ScoringAdapter',
  feedback:   'FeedbackAdapter',
  memory:     'MemoryAdapter',
  browser:    'BrowserAdapter',
  reporter:   'Reporter',
  planner:    'ScenarioPlanner',
};

/** Default class name for each adapter type — used when --name not provided. */
export const DEFAULT_ADAPTER_CLASS_NAMES: Record<AdapterType, string> = {
  app:        'MyAppAdapter',
  simulation: 'MySimulationAdapter',
  scoring:    'MyScoringAdapter',
  feedback:   'MyFeedbackAdapter',
  memory:     'MyMemoryAdapter',
  browser:    'MyBrowserAdapter',
  reporter:   'MyReporter',
  planner:    'MyScenarioPlanner',
};

export function isAdapterType(s: string): s is AdapterType {
  return (ADAPTER_TYPES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Template renderer
// ---------------------------------------------------------------------------

const TODO = (fqMethod: string) => `throw new Error('TODO: implement ${fqMethod}');`;

/**
 * Render the body of a stub adapter file for a given type + class name.
 *
 * Produces a complete, parseable TypeScript module that imports interface
 * types from `pkg` and exports a class implementing the requested interface.
 */
export function renderAdapterStub(
  type: AdapterType,
  opts: { pkg?: string; className?: string } = {},
): string {
  const pkg = opts.pkg ?? 'synthetic-test-fabric';
  const className = opts.className ?? DEFAULT_ADAPTER_CLASS_NAMES[type];
  const iface = ADAPTER_INTERFACES[type];

  switch (type) {
    case 'app':
      return `import type { ${iface}, SeededEntity, AppHealthResult } from '${pkg}';

export class ${className} implements ${iface} {
  async seed(_iterRoot: string, _config: { seekers: number; employers: number; employees: number; scenarioName?: string; personaAdjustmentsPath?: string }): Promise<SeededEntity[]> {
    ${TODO(`${className}.seed`)}
  }

  async reset(_iterRoot: string): Promise<void> {
    // No-op is acceptable here; remove app state created by seed() if your
    // app keeps long-lived data between iterations.
  }

  async validateEnvironment(): Promise<AppHealthResult> {
    return { healthy: true, errors: [], warnings: [] };
  }

  async verify(_iterRoot: string): Promise<void> {
    ${TODO(`${className}.verify`)}
  }

  async importRun(_iterRoot: string, _dbUrl: string): Promise<void> {
    // No-op is acceptable; only called when dbUrl is provided.
  }
}
`;

    case 'simulation':
      return `import type { ${iface}, SeededEntity, SimulationRunResult } from '${pkg}';

export class ${className} implements ${iface} {
  async run(_iterRoot: string, _options: { ticks: number; liveLlm: boolean; simulationId?: string }): Promise<SimulationRunResult> {
    ${TODO(`${className}.run`)}
  }

  async exportEntities(_iterRoot: string, _entities: SeededEntity[]): Promise<void> {
    ${TODO(`${className}.exportEntities`)}
  }

  async clean(_iterRoot: string): Promise<void> {
    // No-op is acceptable.
  }
}
`;

    case 'scoring':
      return `import type { ${iface}, FabricScore } from '${pkg}';

export class ${className} implements ${iface} {
  async score(_iterRoot: string): Promise<FabricScore> {
    ${TODO(`${className}.score`)}
  }
}
`;

    case 'feedback':
      return `import type { ${iface}, FabricFeedback, FabricScore } from '${pkg}';

export class ${className} implements ${iface} {
  async feedback(_iterRoot: string, _options: { score: FabricScore; loopId: string; iteration: number; previousIterRoot: string | null }): Promise<FabricFeedback> {
    ${TODO(`${className}.feedback`)}
  }
}
`;

    case 'memory':
      return `import type { ${iface}, RecorderInput, SeededEntity } from '${pkg}';

export class ${className} implements ${iface} {
  migrate(_dbPath: string): void {
    ${TODO(`${className}.migrate`)}
  }

  writeEvent(_dbPath: string, _event: RecorderInput): void {
    ${TODO(`${className}.writeEvent`)}
  }

  resolveEntity(_dbPath: string, _alias: string): SeededEntity | null {
    return null;
  }

  listEntities(_dbPath: string, _simulationId: string): SeededEntity[] {
    return [];
  }
}
`;

    case 'browser':
      return `import type { ${iface}, BrowserRunResult, LlmProvider } from '${pkg}';

export class ${className} implements ${iface} {
  async runSpecs(_options: {
    iterRoot: string;
    project: string;
    allowFailures: boolean;
    grep?: string;
    retryCount?: number;
    retryDelayMs?: number;
    quarantinedFlows?: string[];
    llmProvider?: LlmProvider;
  }): Promise<BrowserRunResult> {
    ${TODO(`${className}.runSpecs`)}
  }
}
`;

    case 'reporter':
      return `import type { ${iface}, FabricScore, FabricReport } from '${pkg}';

export class ${className} implements ${iface} {
  async report(_score: FabricScore, _iterRoot: string): Promise<FabricReport> {
    return { format: 'console', content: '(stub reporter — replace with real implementation)' };
  }
}
`;

    case 'planner':
      return `import type { ${iface}, FabricScore, ScenarioPlan } from '${pkg}';

export class ${className} implements ${iface} {
  async plan(_score: FabricScore, _iterRoot: string): Promise<ScenarioPlan> {
    return {
      scenarioName: 'baseline_browser_flow',
      rationale: 'stub planner — always returns baseline; replace with your selection logic',
      personaAdjustments: [],
    };
  }
}
`;
  }
}

// ---------------------------------------------------------------------------
// scaffoldProject (used by `fab init`)
// ---------------------------------------------------------------------------

export interface InitOptions {
  /** Target directory for scaffolding (defaults to process.cwd()). */
  dir?: string;
  /** Overwrite existing files instead of failing. */
  force?: boolean;
  /** Package name to import from in generated stubs. Default 'synthetic-test-fabric'. */
  packageName?: string;
}

export interface InitResult {
  filesCreated: string[];
  filesSkipped: string[];     // populated only when not --force and conflicts present
}

export class InitConflictError extends Error {
  readonly code = 'INIT_CONFLICT';
  readonly conflicts: string[];
  constructor(conflicts: string[]) {
    super(`fab init: ${conflicts.length} file(s) already exist; pass --force to overwrite`);
    this.name = 'InitConflictError';
    this.conflicts = conflicts;
  }
}

export function scaffoldProject(opts: InitOptions = {}): InitResult {
  const targetDir = path.resolve(opts.dir ?? process.cwd());
  const pkg = opts.packageName ?? 'synthetic-test-fabric';

  // Build file list: fabric.config.ts + one stub per adapter type + flows/.gitkeep
  const files: { relPath: string; content: string }[] = [
    { relPath: 'fabric.config.ts', content: fabricConfigTemplate(pkg) },
    ...ADAPTER_TYPES.map((type) => ({
      relPath: `src/adapters/${DEFAULT_ADAPTER_CLASS_NAMES[type]}.ts`,
      content: renderAdapterStub(type, { pkg }),
    })),
    { relPath: 'flows/.gitkeep', content: '' },
  ];

  const conflicts = files
    .map((f) => path.join(targetDir, f.relPath))
    .filter((p) => fs.existsSync(p));
  if (conflicts.length > 0 && !opts.force) {
    throw new InitConflictError(conflicts);
  }

  const filesCreated: string[] = [];
  for (const f of files) {
    const full = path.join(targetDir, f.relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content);
    filesCreated.push(full);
  }

  return { filesCreated, filesSkipped: [] };
}

function fabricConfigTemplate(pkg: string): string {
  return `// Generated by \`fab init\`. Wire your real adapters in src/adapters/ and customize this file.
import type { FabricConfig } from '${pkg}';
import { MyAppAdapter } from './src/adapters/MyAppAdapter';
import { MySimulationAdapter } from './src/adapters/MySimulationAdapter';
import { MyScoringAdapter } from './src/adapters/MyScoringAdapter';
import { MyFeedbackAdapter } from './src/adapters/MyFeedbackAdapter';
import { MyMemoryAdapter } from './src/adapters/MyMemoryAdapter';
import { MyBrowserAdapter } from './src/adapters/MyBrowserAdapter';
import { MyReporter } from './src/adapters/MyReporter';
import { MyScenarioPlanner } from './src/adapters/MyScenarioPlanner';

const config: FabricConfig = {
  adapters: {
    app:        new MyAppAdapter(),
    simulation: new MySimulationAdapter(),
    scoring:    new MyScoringAdapter(),
    feedback:   new MyFeedbackAdapter(),
    memory:     new MyMemoryAdapter(),
    browser:    new MyBrowserAdapter(),
    reporters:  [new MyReporter()],
    planner:    new MyScenarioPlanner(),
  },
};

export default config;
`;
}

// ---------------------------------------------------------------------------
// scaffoldAdapter (used by `fab adapter scaffold <type>`)
// ---------------------------------------------------------------------------

export interface ScaffoldAdapterOptions {
  /** Output file path. If omitted, content is returned but not written. */
  out?: string;
  /** Class name for the generated stub. Defaults to DEFAULT_ADAPTER_CLASS_NAMES[type]. */
  name?: string;
  /** Package import path. Default 'synthetic-test-fabric'. */
  packageName?: string;
  /** Overwrite existing file at `out` instead of failing. */
  force?: boolean;
}

export interface ScaffoldAdapterResult {
  type: AdapterType;
  className: string;
  interfaceName: string;
  content: string;
  /** Absolute path the stub was written to, or null if `out` was omitted (stdout mode). */
  filePath: string | null;
}

export class ScaffoldAdapterError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ScaffoldAdapterError';
    this.code = code;
  }
}

/**
 * Generate a single adapter stub of the requested type.
 *
 * If `out` is provided, writes the file (refusing to overwrite without
 * `force`). If `out` is omitted, returns the content for the caller to
 * pipe to stdout / stash elsewhere.
 */
export function scaffoldAdapter(
  type: string,
  opts: ScaffoldAdapterOptions = {},
): ScaffoldAdapterResult {
  if (!isAdapterType(type)) {
    throw new ScaffoldAdapterError(
      `Unknown adapter type '${type}'. Valid types: ${ADAPTER_TYPES.join(', ')}`,
      'UNKNOWN_ADAPTER_TYPE',
    );
  }

  const className = opts.name ?? DEFAULT_ADAPTER_CLASS_NAMES[type];
  const content = renderAdapterStub(type, { pkg: opts.packageName, className });
  const interfaceName = ADAPTER_INTERFACES[type];

  let filePath: string | null = null;
  if (opts.out !== undefined) {
    const resolved = path.resolve(opts.out);
    if (fs.existsSync(resolved) && !opts.force) {
      throw new ScaffoldAdapterError(
        `${resolved} already exists; pass --force to overwrite`,
        'OUT_PATH_EXISTS',
      );
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    filePath = resolved;
  }

  return { type, className, interfaceName, content, filePath };
}
