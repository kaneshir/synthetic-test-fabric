/**
 * demo/run.ts — App-neutral demo for synthetic-test-fabric.
 *
 * Proves the framework runs the full loop against a plain static HTML app
 * with no external backend, payment provider, or product-specific dependencies.
 *
 * Usage:
 *   npx tsx demo/run.ts
 *   npx tsx demo/run.ts --iterations 2
 *   npx tsx demo/run.ts --allow-regression-failures
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseArgs } from 'util';

// Load demo/.env if present — no external dependency required.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
import { FabricOrchestrator, makeLoopId } from '../dist/index.js';
import type { OrchestratorAdapters, OrchestratorOptions } from '../dist/index.js';
import {
  DemoAppAdapter,
  DemoSimulationAdapter,
  DemoScoringAdapter,
  DemoFeedbackAdapter,
  DemoMemoryAdapter,
  DemoBrowserAdapter,
  DemoReporter,
  DemoScenarioPlanner,
} from './adapters';

const { values: flags } = parseArgs({
  options: {
    iterations:                  { type: 'string', default: '1' },
    ticks:                       { type: 'string', default: '2' },
    'allow-regression-failures': { type: 'boolean', default: false },
    'loop-root':                 { type: 'string' },
    'flow-model':                { type: 'string' },
  },
  strict: false,
});

const demoRoot = __dirname;
const loopRoot = (flags['loop-root'] as string | undefined)
  ?? process.env.LOOP_ROOT
  ?? path.join(os.tmpdir(), `stf-demo-${Date.now()}`);

const flowModel = (flags['flow-model'] as string | undefined)
  ?? process.env.FLOW_MODEL;

const dbUrl = process.env.DATABASE_URL
  ?? path.join(loopRoot, 'demo-history.db');

async function main(): Promise<void> {
  const adapters: OrchestratorAdapters = {
    app:        new DemoAppAdapter(),
    simulation: new DemoSimulationAdapter(),
    scoring:    new DemoScoringAdapter(),
    feedback:   new DemoFeedbackAdapter(),
    memory:     new DemoMemoryAdapter(),
    browser:    new DemoBrowserAdapter(demoRoot),
    reporters:  [new DemoReporter()],
    planner:    new DemoScenarioPlanner(),
  };

  const options: OrchestratorOptions = {
    loopId:                  makeLoopId(),
    loopRoot,
    dbUrl,
    iterations:              parseInt(flags.iterations as string, 10),
    ticks:                   parseInt(flags.ticks as string, 10),
    liveLlm:                 false,
    allowRegressionFailures: flags['allow-regression-failures'] as boolean,
    seekers:                 2,
    employers:               1,
    employees:               0,
    ...(flowModel ? { flowModel } : {}),
  };

  console.log(`[demo] Loop root: ${loopRoot}`);
  const orchestrator = new FabricOrchestrator(adapters);
  await orchestrator.run(options);
  console.log('\n[demo] ✓ Demo complete.');
}

main().catch((err) => {
  console.error('[demo] Fatal:', err);
  process.exit(1);
});
