#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FabricOrchestrator } from '../orchestrator';
import { resolveLoopPaths, makeLoopId } from '../run-root';
import { loadFabricConfig } from './load-config';

const program = new Command();

program
  .name('fab')
  .description('Synthetic Test Fabric CLI — autonomous QA loop')
  .version('0.1.0');

// ---------------------------------------------------------------------------
// orchestrate — full autonomous loop
// ---------------------------------------------------------------------------
program
  .command('orchestrate')
  .description('Run the full SEED→VERIFY→RUN→ANALYZE→GENERATE_FLOWS→TEST→SCORE→FEEDBACK loop')
  .option('--iterations <n>', 'Number of loop iterations', parseInt, 1)
  .option('--ticks <n>', 'Simulation ticks per iteration', parseInt, 5)
  .option('--seekers <n>', 'Seeker count', parseInt, 2)
  .option('--employers <n>', 'Employer count', parseInt, 1)
  .option('--employees <n>', 'Employee count', parseInt, 0)
  .option('--scenario <name>', 'Named scenario for the seed step')
  .option('--root <dir>', 'Persistent loop root directory (created if absent)')
  .option('--live-llm', 'Enable live LLM calls during simulation')
  .option('--allow-regression-failures', 'Continue to SCORE even when regression flows fail')
  .option('--config <path>', 'Path to fabric.config.ts (default: ./fabric.config.ts)')
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const d = config.defaults ?? {};
    const orchestrator = new FabricOrchestrator(config.adapters);
    await orchestrator.run({
      iterations:               opts.iterations               ?? d.iterations               ?? 1,
      ticks:                    opts.ticks                    ?? d.ticks                    ?? 5,
      seekers:                  opts.seekers                  ?? d.seekers                  ?? 2,
      employers:                opts.employers                ?? d.employers                ?? 1,
      employees:                opts.employees                ?? d.employees                ?? 0,
      scenarioName:             opts.scenario                 ?? d.scenarioName,
      loopRoot:                 opts.root                     ?? d.loopRoot,
      liveLlm:                  opts.liveLlm                  ?? d.liveLlm                  ?? false,
      allowRegressionFailures:  opts.allowRegressionFailures  ?? d.allowRegressionFailures  ?? true,
    });
  });

// ---------------------------------------------------------------------------
// fresh — one-shot run root
// ---------------------------------------------------------------------------
program
  .command('fresh')
  .description('One-shot fresh run: seed → verify → [flows] → [score+feedback]')
  .option('--flows', 'Run Playwright flows after seeding')
  .option('--plan', 'Compute score and generate feedback JSON after seeding')
  .option('--scenario <name>', 'Named scenario for the seed step')
  .option('--root <dir>', 'Use a specific run root directory (created if absent)')
  .option('--keep', 'Keep run root on success (always kept on failure)')
  .option('--seekers <n>', 'Seeker count', parseInt, 2)
  .option('--employers <n>', 'Employer count', parseInt, 1)
  .option('--employees <n>', 'Employee count', parseInt, 0)
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const explicitRoot = !!opts.root;
    const runRoot = opts.root ?? makeTempRoot('fab-fresh');
    const iterPaths = resolveLoopPaths(runRoot, 1);

    fs.mkdirSync(iterPaths.iterRoot, { recursive: true });
    fs.mkdirSync(path.dirname(iterPaths.lisaDbPath), { recursive: true });

    let success = false;
    try {
      console.log(`[fab fresh] Run root: ${runRoot}`);

      console.log('[fab fresh] → SEED');
      await config.adapters.app.seed(iterPaths.iterRoot, {
        seekers: opts.seekers,
        employers: opts.employers,
        employees: opts.employees,
        scenarioName: opts.scenario,
      });

      console.log('[fab fresh] → VERIFY');
      await config.adapters.app.verify(iterPaths.iterRoot);

      if (opts.flows) {
        console.log('[fab fresh] → FLOWS');
        const result = await config.adapters.browser.runSpecs({
          iterRoot: iterPaths.iterRoot,
          project: 'flows',
          allowFailures: false,
        });
        console.log(`[fab fresh] flows: ${result.passed}/${result.total} passed`);
      }

      if (opts.plan) {
        console.log('[fab fresh] → SCORE');
        const score = await config.adapters.scoring.score(iterPaths.iterRoot);
        console.log('[fab fresh] → FEEDBACK');
        await config.adapters.feedback.feedback(iterPaths.iterRoot, {
          score,
          loopId: makeLoopId(),
          iteration: 1,
          previousIterRoot: null,
        });
        for (const r of config.adapters.reporters) {
          await r.report(score, iterPaths.iterRoot).catch(() => {});
        }
      }

      success = true;
      console.log(`[fab fresh] Done. Root: ${runRoot}`);
    } finally {
      if (!success) {
        console.log(`[fab fresh] Failed. Run root preserved: ${runRoot}`);
      } else if (!opts.keep && !explicitRoot) {
        fs.rmSync(runRoot, { recursive: true, force: true });
      }
    }
  });

// ---------------------------------------------------------------------------
// smoke — fastest handoff check
// ---------------------------------------------------------------------------
program
  .command('smoke')
  .description('Fastest handoff check: seed → verify → one bounded smoke flow')
  .option('--root <dir>', 'Use a specific run root directory')
  .option('--keep', 'Keep run root after completion')
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const explicitRoot = !!opts.root;
    const runRoot = opts.root ?? makeTempRoot('fab-smoke');
    const iterPaths = resolveLoopPaths(runRoot, 1);

    fs.mkdirSync(iterPaths.iterRoot, { recursive: true });
    fs.mkdirSync(path.dirname(iterPaths.lisaDbPath), { recursive: true });

    let success = false;
    try {
      console.log(`[fab smoke] Run root: ${runRoot}`);

      console.log('[fab smoke] → SEED');
      await config.adapters.app.seed(iterPaths.iterRoot, {
        seekers: 1,
        employers: 1,
        employees: 0,
      });

      console.log('[fab smoke] → VERIFY');
      await config.adapters.app.verify(iterPaths.iterRoot);

      console.log('[fab smoke] → SMOKE FLOW');
      const result = await config.adapters.browser.runSpecs({
        iterRoot: iterPaths.iterRoot,
        project: 'smoke',
        allowFailures: false,
      });
      console.log(`[fab smoke] ${result.passed}/${result.total} passed`);

      success = true;
      console.log('[fab smoke] Passed.');
    } finally {
      if (!success) {
        console.log(`[fab smoke] Failed. Run root preserved: ${runRoot}`);
      } else if (!opts.keep && !explicitRoot) {
        fs.rmSync(runRoot, { recursive: true, force: true });
      }
    }
  });

// ---------------------------------------------------------------------------
// Primitive commands — operate on an explicit run root
// ---------------------------------------------------------------------------

program
  .command('seed')
  .description('Seed simulation fixtures into a run root')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--scenario <name>', 'Named scenario')
  .option('--seekers <n>', 'Seeker count', parseInt, 2)
  .option('--employers <n>', 'Employer count', parseInt, 1)
  .option('--employees <n>', 'Employee count', parseInt, 0)
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    fs.mkdirSync(iterPaths.iterRoot, { recursive: true });
    fs.mkdirSync(path.dirname(iterPaths.lisaDbPath), { recursive: true });
    await config.adapters.app.seed(iterPaths.iterRoot, {
      seekers: opts.seekers,
      employers: opts.employers,
      employees: opts.employees,
      scenarioName: opts.scenario,
    });
    console.log(`[fab seed] Done. Root: ${opts.root}`);
  });

program
  .command('verify')
  .description('Fail-closed fixture verification')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    await config.adapters.app.verify(iterPaths.iterRoot);
    console.log('[fab verify] OK');
  });

program
  .command('flows')
  .description('Run Playwright flows against an existing run root')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--grep <pattern>', 'Filter specs by name pattern')
  .option('--project <name>', 'Playwright project name', 'flows')
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    const result = await config.adapters.browser.runSpecs({
      iterRoot: iterPaths.iterRoot,
      project: opts.project,
      allowFailures: false,
      grep: opts.grep,
    });
    console.log(`[fab flows] ${result.passed}/${result.total} passed`);
    if (result.failed > 0) process.exit(1);
  });

program
  .command('score')
  .description('Compute fabric score from an existing run root')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    const score = await config.adapters.scoring.score(iterPaths.iterRoot);
    for (const r of config.adapters.reporters) {
      await r.report(score, iterPaths.iterRoot).catch(() => {});
    }
    console.log(`[fab score] Overall: ${score.overall}`);
  });

program
  .command('feedback')
  .description('Generate feedback JSON from an existing run root')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    if (!fs.existsSync(iterPaths.fabricScorePath)) {
      console.error('[fab feedback] fabric-score.json not found — run `fab score` first');
      process.exit(1);
    }
    const score = JSON.parse(fs.readFileSync(iterPaths.fabricScorePath, 'utf8'));
    await config.adapters.feedback.feedback(iterPaths.iterRoot, {
      score,
      loopId: makeLoopId(),
      iteration: 1,
      previousIterRoot: null,
    });
    console.log('[fab feedback] Done.');
  });

program
  .command('analyze')
  .description('Extract discovered screen paths from behavior events')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    await config.adapters.browser.runSpecs({
      iterRoot: iterPaths.iterRoot,
      project: 'analyze',
      allowFailures: true,
    });
    console.log('[fab analyze] Done.');
  });

// ---------------------------------------------------------------------------
// baseline — visual regression baseline management
// ---------------------------------------------------------------------------

const baseline = program.command('baseline').description('Manage visual regression baselines');

baseline
  .command('list')
  .description('List all baselines with last-updated timestamp')
  .option('--baseline-dir <dir>', 'Baseline directory (default: .fab-baselines)')
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const { listBaselines } = await import('../visual-regression');
    const dir = opts.baselineDir ?? await resolveBaselineDir(opts.config);
    const baselines = listBaselines(dir);
    if (baselines.length === 0) {
      console.log('[fab baseline list] No baselines found.');
      return;
    }
    console.log(`\nBaselines in ${dir}:\n`);
    for (const b of baselines) {
      console.log(`  ${b.name.padEnd(40)} ${b.updatedAt.toLocaleString()}`);
    }
    console.log();
  });

baseline
  .command('update <flow>')
  .description('Accept the current screenshot as the new baseline for <flow>')
  .requiredOption('--root <dir>', 'Run root containing the current screenshot')
  .option('--baseline-dir <dir>', 'Baseline directory (default: .fab-baselines)')
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (flow: string, opts) => {
    const { updateBaseline } = await import('../visual-regression');
    const dir = opts.baselineDir ?? await resolveBaselineDir(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    const currentPng = path.join(iterPaths.iterRoot, 'visual-results', flow, 'current.png');
    if (!fs.existsSync(currentPng)) {
      console.error(`[fab baseline update] No current screenshot at ${currentPng}`);
      console.error('  Run the flow first, then update the baseline.');
      process.exit(1);
    }
    updateBaseline(dir, flow, currentPng);
    console.log(`[fab baseline update] Baseline updated for '${flow}' → ${dir}`);
  });

baseline
  .command('reset')
  .description('Delete all baselines — next run will re-capture from scratch')
  .option('--baseline-dir <dir>', 'Baseline directory (default: .fab-baselines)')
  .option('--config <path>', 'Path to fabric.config.ts')
  .action(async (opts) => {
    const { resetBaselines } = await import('../visual-regression');
    const dir = opts.baselineDir ?? await resolveBaselineDir(opts.config);
    resetBaselines(dir);
    console.log(`[fab baseline reset] All baselines removed from ${dir}`);
  });

async function resolveBaselineDir(configPath?: string): Promise<string> {
  try {
    const config = await loadFabricConfig(configPath);
    return config.baselineDir ?? path.join(process.cwd(), '.fab-baselines');
  } catch {
    return path.join(process.cwd(), '.fab-baselines');
  }
}

// ---------------------------------------------------------------------------
// check — CI score gate
// ---------------------------------------------------------------------------

program
  .command('check')
  .description('Fail with exit code 1 if fabric score is below threshold (use in CI)')
  .requiredOption('--root <dir>', 'Run root directory containing fabric-score.json')
  .option('--threshold <n>', 'Minimum passing score (0–10)', parseFloat, 8.0)
  .option('--config <path>', 'Path to fabric.config.ts (not required for this command)')
  .action(async (opts) => {
    const scorePath = path.join(resolveLoopPaths(opts.root, 1).fabricScorePath);
    if (!fs.existsSync(scorePath)) {
      console.error(`[fab check] fabric-score.json not found at ${scorePath}`);
      console.error('  Run `fab score --root <dir>` first.');
      process.exit(1);
    }
    const score = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
    const { assertScoreThreshold } = await import('../reporters/gate');
    try {
      assertScoreThreshold(score, opts.threshold);
      console.log(`[fab check] ✅ Score ${score.overall.toFixed(1)} ≥ threshold ${opts.threshold.toFixed(1)}`);
    } catch (err: unknown) {
      console.error(`[fab check] ❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`fab: ${err.message}`);
  process.exit(1);
});

function makeTempRoot(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
}
