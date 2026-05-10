#!/usr/bin/env node
import { Command, Option } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FabricOrchestrator } from '../orchestrator';
import { resolveLoopPaths, makeLoopId } from '../run-root';
// Mirror of the orchestrator's fallback at orchestrator.ts:111 so the CLI can
// record the same loopRoot that orchestrator.run() will use when neither
// --root nor defaults.loopRoot is provided.
const DEFAULT_ORCHESTRATE_LOOP_ROOT_PARENT = '/tmp/fabric-loop';
import { loadFabricConfig } from './load-config';
import {
  detectModesFromArgv,
  emitOk,
  emitDomainFailure,
  emitError,
  emitTopLevelError,
  isJsonMode,
} from './json-envelope';
import { installStdoutGuard } from './stdout-guard';
import { recordCommand, readState, getStatePath } from './state';
import type { LastRootKind } from './state';

// ---------------------------------------------------------------------------
// JSON-mode setup — must run BEFORE commander parses so unknown-command /
// missing-required-option errors still emit a JSON envelope when --json is set.
// ---------------------------------------------------------------------------

detectModesFromArgv();
if (isJsonMode()) {
  installStdoutGuard();
  // Special-case --help / --version: commander writes help/version text to
  // stdout (which the guard just redirected) then calls exitOverride, which
  // would leave stdout empty in --json mode and violate the contract.
  // Pre-handle them with a minimal envelope before commander runs.
  const argvAfterScript = process.argv.slice(2);
  const wantsVersion = argvAfterScript.includes('--version') || argvAfterScript.includes('-V');
  const wantsHelp = argvAfterScript.includes('--help') || argvAfterScript.includes('-h');
  if (wantsVersion) {
    emitOk('version', { version: '0.1.0' });
  }
  if (wantsHelp) {
    emitOk('help', {
      message: 'fab help is intended for human reading. Run without --json to see the full help text.',
    });
  }
}

// ---------------------------------------------------------------------------
// Helper: every command accepts --json and --debug
// ---------------------------------------------------------------------------

// Commander passes (value, previous) to coercion callbacks. Using `parseInt`
// directly is wrong because parseInt's second arg is `radix` — `parseInt('1', 1)`
// returns NaN (radix 1 is unsupported). Always pass radix 10 explicitly.
function parseIntArg(v: string): number { return parseInt(v, 10); }

function withJsonOptions<T extends Command>(cmd: T): T {
  cmd.addOption(new Option('--json', 'Emit a machine-readable JSON envelope on stdout').default(false));
  cmd.addOption(new Option('--debug', 'Include stack traces in error envelopes').default(false));
  return cmd;
}

const program = new Command();

program
  .name('fab')
  .description('Synthetic Test Fabric CLI — autonomous QA loop')
  .version('0.1.0')
  // Global --json / --debug also accepted at program level so callers can put
  // the flag before OR after the subcommand: `fab --json seed` or `fab seed --json`.
  // Both positions are honored by detectModesFromArgv (raw argv scan); these
  // declarations just keep commander from rejecting the flag at the program scope.
  .option('--json', 'Emit a machine-readable JSON envelope on stdout')
  .option('--debug', 'Include stack traces in error envelopes')
  // Make commander throw on parse / unknown-option / missing-required-option errors
  // so the top-level catch can emit a JSON envelope when --json is set.
  // Help / version are still allowed to exit 0 normally.
  .exitOverride((err) => {
    if (err.code === 'commander.help' || err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      process.exit(0);
    }
    throw err;
  });

// ---------------------------------------------------------------------------
// orchestrate — full autonomous loop
// ---------------------------------------------------------------------------
withJsonOptions(program
  .command('orchestrate')
  .description('Run the full SEED→VERIFY→RUN→ANALYZE→GENERATE_FLOWS→TEST→SCORE→FEEDBACK loop')
  .option('--iterations <n>', 'Number of loop iterations', parseIntArg,1)
  .option('--ticks <n>', 'Simulation ticks per iteration', parseIntArg,5)
  .option('--seekers <n>', 'Seeker count', parseIntArg,2)
  .option('--employers <n>', 'Employer count', parseIntArg,1)
  .option('--employees <n>', 'Employee count', parseIntArg,0)
  .option('--scenario <name>', 'Named scenario for the seed step')
  .option('--root <dir>', 'Persistent loop root directory (created if absent)')
  .option('--live-llm', 'Enable live LLM calls during simulation')
  .option('--allow-regression-failures', 'Continue to SCORE even when regression flows fail')
  .option('--config <path>', 'Path to fabric.config.ts (default: ./fabric.config.ts)'))
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const d = config.defaults ?? {};
    const iterations = opts.iterations ?? d.iterations ?? 1;
    // Pre-resolve loopRoot so we can record the same value `fab status` will
    // surface later. If neither --root nor defaults.loopRoot is set, mirror
    // the orchestrator's fallback (/tmp/fabric-loop/<loopId>) and pass it
    // explicitly so we both agree on the path.
    const loopId = makeLoopId();
    const effectiveLoopRoot = opts.root
      ?? d.loopRoot
      ?? path.join(DEFAULT_ORCHESTRATE_LOOP_ROOT_PARENT, loopId);

    const orchestrator = new FabricOrchestrator(config.adapters);
    const score = await orchestrator.run({
      iterations,
      ticks:                    opts.ticks                    ?? d.ticks                    ?? 5,
      seekers:                  opts.seekers                  ?? d.seekers                  ?? 2,
      employers:                opts.employers                ?? d.employers                ?? 1,
      employees:                opts.employees                ?? d.employees                ?? 0,
      scenarioName:             opts.scenario                 ?? d.scenarioName,
      loopRoot:                 effectiveLoopRoot,
      loopId,
      liveLlm:                  opts.liveLlm                  ?? d.liveLlm                  ?? false,
      allowRegressionFailures:  opts.allowRegressionFailures  ?? d.allowRegressionFailures  ?? true,
    });
    recordCommand({
      command: 'orchestrate',
      lastRoot: effectiveLoopRoot,
      lastIteration: iterations,
      lastRootKind: 'persistent',
      lastScore: score.overall,
      lastPhase: 'FEEDBACK',
    });
    emitOk('orchestrate', {
      score: score.overall,
      iterations,
      loopRoot: effectiveLoopRoot,
    }, { runRoot: effectiveLoopRoot });
  });

// ---------------------------------------------------------------------------
// fresh — one-shot run root
// ---------------------------------------------------------------------------
withJsonOptions(program
  .command('fresh')
  .description('One-shot fresh run: seed → verify → [flows] → [score+feedback]')
  .option('--flows', 'Run Playwright flows after seeding')
  .option('--plan', 'Compute score and generate feedback JSON after seeding')
  .option('--scenario <name>', 'Named scenario for the seed step')
  .option('--root <dir>', 'Use a specific run root directory (created if absent)')
  .option('--keep', 'Keep run root on success (always kept on failure)')
  .option('--seekers <n>', 'Seeker count', parseIntArg,2)
  .option('--employers <n>', 'Employer count', parseIntArg,1)
  .option('--employees <n>', 'Employee count', parseIntArg,0)
  .option('--config <path>', 'Path to fabric.config.ts'))
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const explicitRoot = !!opts.root;
    const runRoot = opts.root ?? makeTempRoot('fab-fresh');
    const iterPaths = resolveLoopPaths(runRoot, 1);

    fs.mkdirSync(iterPaths.iterRoot, { recursive: true });
    fs.mkdirSync(path.dirname(iterPaths.lisaDbPath), { recursive: true });

    let success = false;
    let flowsResult: { passed: number; failed: number; total: number } | null = null;
    let scoreResult: number | null = null;
    let lastPhase: string | null = null;
    let lastFailure: { phase: string; message: string } | null = null;

    try {
      console.log(`[fab fresh] Run root: ${runRoot}`);

      lastPhase = 'SEED';
      console.log('[fab fresh] → SEED');
      await config.adapters.app.seed(iterPaths.iterRoot, {
        seekers: opts.seekers,
        employers: opts.employers,
        employees: opts.employees,
        scenarioName: opts.scenario,
      });

      lastPhase = 'VERIFY';
      console.log('[fab fresh] → VERIFY');
      await config.adapters.app.verify(iterPaths.iterRoot);

      if (opts.flows) {
        lastPhase = 'TEST';
        console.log('[fab fresh] → FLOWS');
        const result = await config.adapters.browser.runSpecs({
          iterRoot: iterPaths.iterRoot,
          project: 'flows',
          allowFailures: false,
        });
        flowsResult = { passed: result.passed, failed: result.failed, total: result.total };
        console.log(`[fab fresh] flows: ${result.passed}/${result.total} passed`);
      }

      if (opts.plan) {
        lastPhase = 'SCORE';
        console.log('[fab fresh] → SCORE');
        const score = await config.adapters.scoring.score(iterPaths.iterRoot);
        scoreResult = score.overall;
        lastPhase = 'FEEDBACK';
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
    } catch (err) {
      lastFailure = { phase: lastPhase ?? 'UNKNOWN', message: (err as Error).message };
      throw err;
    } finally {
      if (!success) {
        console.log(`[fab fresh] Failed. Run root preserved: ${runRoot}`);
      } else if (!opts.keep && !explicitRoot) {
        fs.rmSync(runRoot, { recursive: true, force: true });
      }

      // Record state for `fab status` — fires on both success and failure paths.
      const ephemeral = !explicitRoot;
      const cleanedUp = success && ephemeral && !opts.keep;
      const rootKind: LastRootKind = ephemeral
        ? (cleanedUp ? 'ephemeral_deleted' : 'ephemeral_kept')
        : 'persistent';
      recordCommand({
        command: 'fresh',
        lastRoot: cleanedUp ? null : runRoot,
        lastIteration: 1,
        lastRootKind: rootKind,
        lastScore: scoreResult,
        lastPhase,
        lastFailure,
      });
    }

    emitOk('fresh', {
      root: runRoot,
      keep: opts.keep ?? false,
      explicitRoot,
      flows: flowsResult,
      score: scoreResult,
    }, { runRoot });
  });

// ---------------------------------------------------------------------------
// smoke — fastest handoff check
// ---------------------------------------------------------------------------
withJsonOptions(program
  .command('smoke')
  .description('Fastest handoff check: seed → verify → one bounded smoke flow')
  .option('--root <dir>', 'Use a specific run root directory')
  .option('--keep', 'Keep run root after completion')
  .option('--config <path>', 'Path to fabric.config.ts'))
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const explicitRoot = !!opts.root;
    const runRoot = opts.root ?? makeTempRoot('fab-smoke');
    const iterPaths = resolveLoopPaths(runRoot, 1);

    fs.mkdirSync(iterPaths.iterRoot, { recursive: true });
    fs.mkdirSync(path.dirname(iterPaths.lisaDbPath), { recursive: true });

    let success = false;
    let result: { passed: number; failed: number; total: number } | null = null;
    let lastPhase: string | null = null;
    let lastFailure: { phase: string; message: string } | null = null;

    try {
      console.log(`[fab smoke] Run root: ${runRoot}`);

      lastPhase = 'SEED';
      console.log('[fab smoke] → SEED');
      await config.adapters.app.seed(iterPaths.iterRoot, {
        seekers: 1,
        employers: 1,
        employees: 0,
      });

      lastPhase = 'VERIFY';
      console.log('[fab smoke] → VERIFY');
      await config.adapters.app.verify(iterPaths.iterRoot);

      lastPhase = 'TEST';
      console.log('[fab smoke] → SMOKE FLOW');
      const r = await config.adapters.browser.runSpecs({
        iterRoot: iterPaths.iterRoot,
        project: 'smoke',
        allowFailures: false,
      });
      result = { passed: r.passed, failed: r.failed, total: r.total };
      console.log(`[fab smoke] ${r.passed}/${r.total} passed`);

      success = true;
      console.log('[fab smoke] Passed.');
    } catch (err) {
      lastFailure = { phase: lastPhase ?? 'UNKNOWN', message: (err as Error).message };
      throw err;
    } finally {
      if (!success) {
        console.log(`[fab smoke] Failed. Run root preserved: ${runRoot}`);
      } else if (!opts.keep && !explicitRoot) {
        fs.rmSync(runRoot, { recursive: true, force: true });
      }

      const ephemeral = !explicitRoot;
      const cleanedUp = success && ephemeral && !opts.keep;
      const rootKind: LastRootKind = ephemeral
        ? (cleanedUp ? 'ephemeral_deleted' : 'ephemeral_kept')
        : 'persistent';
      recordCommand({
        command: 'smoke',
        lastRoot: cleanedUp ? null : runRoot,
        lastIteration: 1,
        lastRootKind: rootKind,
        lastPhase,
        lastFailure,
      });
    }

    emitOk('smoke', { root: runRoot, keep: opts.keep ?? false, explicitRoot, flows: result }, { runRoot });
  });

// ---------------------------------------------------------------------------
// Primitive commands — operate on an explicit run root
// ---------------------------------------------------------------------------

withJsonOptions(program
  .command('seed')
  .description('Seed simulation fixtures into a run root')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--scenario <name>', 'Named scenario')
  .option('--seekers <n>', 'Seeker count', parseIntArg,2)
  .option('--employers <n>', 'Employer count', parseIntArg,1)
  .option('--employees <n>', 'Employee count', parseIntArg,0)
  .option('--config <path>', 'Path to fabric.config.ts'))
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
    recordCommand({ command: 'seed', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent', lastPhase: 'SEED' });
    emitOk('seed', { root: opts.root }, { runRoot: opts.root });
  });

withJsonOptions(program
  .command('verify')
  .description('Fail-closed fixture verification')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--config <path>', 'Path to fabric.config.ts'))
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    await config.adapters.app.verify(iterPaths.iterRoot);
    console.log('[fab verify] OK');
    recordCommand({ command: 'verify', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent', lastPhase: 'VERIFY' });
    emitOk('verify', { root: opts.root }, { runRoot: opts.root });
  });

withJsonOptions(program
  .command('flows')
  .description('Run Playwright flows against an existing run root')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--grep <pattern>', 'Filter specs by name pattern')
  .option('--project <name>', 'Playwright project name', 'flows')
  .option('--config <path>', 'Path to fabric.config.ts'))
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
    if (result.failed > 0) {
      // Domain failure: tool ran successfully, found failing flows.
      recordCommand({
        command: 'flows', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent',
        lastPhase: 'TEST',
        lastFailure: { phase: 'TEST', message: `${result.failed}/${result.total} flows failed` },
      });
      emitDomainFailure('flows', {
        ok: false,
        passed: result.passed,
        failed: result.failed,
        total: result.total,
      }, { runRoot: opts.root });
    }
    recordCommand({ command: 'flows', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent', lastPhase: 'TEST' });
    emitOk('flows', { ok: true, passed: result.passed, failed: result.failed, total: result.total }, { runRoot: opts.root });
  });

withJsonOptions(program
  .command('score')
  .description('Compute fabric score from an existing run root')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--config <path>', 'Path to fabric.config.ts'))
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    const score = await config.adapters.scoring.score(iterPaths.iterRoot);
    for (const r of config.adapters.reporters) {
      await r.report(score, iterPaths.iterRoot).catch(() => {});
    }
    console.log(`[fab score] Overall: ${score.overall}`);
    recordCommand({
      command: 'score', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent',
      lastScore: score.overall, lastPhase: 'SCORE',
    });
    emitOk('score', { overall: score.overall, dimensions: score.dimensions }, { runRoot: opts.root });
  });

withJsonOptions(program
  .command('feedback')
  .description('Generate feedback JSON from an existing run root')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--config <path>', 'Path to fabric.config.ts'))
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    if (!fs.existsSync(iterPaths.fabricScorePath)) {
      const msg = `[fab feedback] fabric-score.json not found — run \`fab score\` first`;
      console.error(msg);
      recordCommand({
        command: 'feedback', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent',
        lastFailure: { phase: 'FEEDBACK', message: msg },
      });
      emitError('feedback', { message: msg, code: 'SCORE_FILE_MISSING' }, { runRoot: opts.root });
    }
    const score = JSON.parse(fs.readFileSync(iterPaths.fabricScorePath, 'utf8'));
    await config.adapters.feedback.feedback(iterPaths.iterRoot, {
      score,
      loopId: makeLoopId(),
      iteration: 1,
      previousIterRoot: null,
    });
    console.log('[fab feedback] Done.');
    recordCommand({ command: 'feedback', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent', lastPhase: 'FEEDBACK' });
    emitOk('feedback', { root: opts.root }, { runRoot: opts.root });
  });

withJsonOptions(program
  .command('analyze')
  .description('Extract discovered screen paths from behavior events')
  .requiredOption('--root <dir>', 'Run root directory')
  .option('--config <path>', 'Path to fabric.config.ts'))
  .action(async (opts) => {
    const config = await loadFabricConfig(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    await config.adapters.browser.runSpecs({
      iterRoot: iterPaths.iterRoot,
      project: 'analyze',
      allowFailures: true,
    });
    console.log('[fab analyze] Done.');
    recordCommand({ command: 'analyze', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent', lastPhase: 'ANALYZE' });
    emitOk('analyze', { root: opts.root }, { runRoot: opts.root });
  });

// ---------------------------------------------------------------------------
// baseline — visual regression baseline management
// ---------------------------------------------------------------------------

const baseline = program.command('baseline').description('Manage visual regression baselines');

withJsonOptions(baseline
  .command('list')
  .description('List all baselines with last-updated timestamp')
  .option('--baseline-dir <dir>', 'Baseline directory (default: .fab-baselines)')
  .option('--config <path>', 'Path to fabric.config.ts'))
  .action(async (opts) => {
    const { listBaselines } = await import('../visual-regression');
    const dir = opts.baselineDir ?? await resolveBaselineDir(opts.config);
    const baselines = listBaselines(dir);
    if (baselines.length === 0) {
      console.log('[fab baseline list] No baselines found.');
      emitOk('baseline-list', { baselineDir: dir, baselines: [] });
    }
    console.log(`\nBaselines in ${dir}:\n`);
    for (const b of baselines) {
      console.log(`  ${b.name.padEnd(40)} ${b.updatedAt.toLocaleString()}`);
    }
    console.log();
    emitOk('baseline-list', {
      baselineDir: dir,
      baselines: baselines.map((b) => ({ name: b.name, updatedAt: b.updatedAt.toISOString() })),
    });
  });

withJsonOptions(baseline
  .command('update <flow>')
  .description('Accept the current screenshot as the new baseline for <flow>')
  .requiredOption('--root <dir>', 'Run root containing the current screenshot')
  .option('--baseline-dir <dir>', 'Baseline directory (default: .fab-baselines)')
  .option('--config <path>', 'Path to fabric.config.ts'))
  .action(async (flow: string, opts) => {
    const { updateBaseline } = await import('../visual-regression');
    const dir = opts.baselineDir ?? await resolveBaselineDir(opts.config);
    const iterPaths = resolveLoopPaths(opts.root, 1);
    const currentPng = path.join(iterPaths.iterRoot, 'visual-results', flow, 'current.png');
    if (!fs.existsSync(currentPng)) {
      console.error(`[fab baseline update] No current screenshot at ${currentPng}`);
      console.error('  Run the flow first, then update the baseline.');
      emitError('baseline-update', {
        message: `No current screenshot at ${currentPng}`,
        code: 'SCREENSHOT_MISSING',
      }, { runRoot: opts.root });
    }
    updateBaseline(dir, flow, currentPng);
    console.log(`[fab baseline update] Baseline updated for '${flow}' → ${dir}`);
    emitOk('baseline-update', { flow, baselineDir: dir, source: currentPng }, { runRoot: opts.root });
  });

withJsonOptions(baseline
  .command('reset')
  .description('Delete all baselines — next run will re-capture from scratch')
  .option('--baseline-dir <dir>', 'Baseline directory (default: .fab-baselines)')
  .option('--config <path>', 'Path to fabric.config.ts'))
  .action(async (opts) => {
    const { resetBaselines } = await import('../visual-regression');
    const dir = opts.baselineDir ?? await resolveBaselineDir(opts.config);
    resetBaselines(dir);
    console.log(`[fab baseline reset] All baselines removed from ${dir}`);
    emitOk('baseline-reset', { baselineDir: dir });
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

withJsonOptions(program
  .command('check')
  .description('Fail with exit code 1 if fabric score is below threshold (use in CI)')
  .requiredOption('--root <dir>', 'Run root directory containing fabric-score.json')
  .option('--threshold <n>', 'Minimum passing score (0–10)', parseFloat, 8.0)
  .option('--config <path>', 'Path to fabric.config.ts (not required for this command)'))
  .action(async (opts) => {
    const scorePath = path.join(resolveLoopPaths(opts.root, 1).fabricScorePath);
    if (!fs.existsSync(scorePath)) {
      // Infrastructure error: the command can't run because the input file is missing.
      console.error(`[fab check] fabric-score.json not found at ${scorePath}`);
      console.error('  Run `fab score --root <dir>` first.');
      recordCommand({
        command: 'check', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent',
        lastFailure: { phase: 'CHECK', message: `fabric-score.json not found at ${scorePath}` },
      });
      emitError('check', {
        message: `fabric-score.json not found at ${scorePath}`,
        code: 'SCORE_FILE_MISSING',
      }, { runRoot: opts.root });
    }
    const score = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
    const { assertScoreThreshold } = await import('../reporters/gate');
    try {
      assertScoreThreshold(score, opts.threshold);
      console.log(`[fab check] ✅ Score ${score.overall.toFixed(1)} ≥ threshold ${opts.threshold.toFixed(1)}`);
      recordCommand({
        command: 'check', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent',
        lastScore: score.overall, lastPhase: 'CHECK',
      });
      emitOk('check', { ok: true, score: score.overall, threshold: opts.threshold }, { runRoot: opts.root });
    } catch (err: unknown) {
      const message = (err as Error).message;
      // Domain failure: command ran successfully and found the score below threshold.
      console.error(`[fab check] ❌ ${message}`);
      recordCommand({
        command: 'check', lastRoot: opts.root, lastIteration: 1, lastRootKind: 'persistent',
        lastScore: score.overall, lastPhase: 'CHECK',
        lastFailure: { phase: 'CHECK', message },
      });
      emitDomainFailure('check', {
        ok: false,
        score: score.overall,
        threshold: opts.threshold,
        message,
      }, { runRoot: opts.root });
    }
  });

// ---------------------------------------------------------------------------
// status — show last-command summary from ~/.fab/state.json
// ---------------------------------------------------------------------------

withJsonOptions(program
  .command('status')
  .description('Show the most recent fab command outcome (reads ~/.fab/state.json)'))
  .action(async () => {
    let state;
    try {
      state = readState();
    } catch (err: unknown) {
      // Corrupt or unreadable state file — surface as infrastructure error.
      const message = (err as Error).message;
      console.error(`[fab status] state file unreadable: ${message}`);
      emitError('status', {
        message: `state file unreadable at ${getStatePath()}: ${message}`,
        code: 'STATE_FILE_UNREADABLE',
      });
    }

    if (state === null) {
      console.log('[fab status] no runs yet');
      emitOk('status', { ok: true, state: 'empty' });
    }

    // Populated state — print 5-line digest in text mode, full envelope in --json mode.
    const s = state!;
    const rootDisplay = s.lastRoot ?? '(cleaned up)';
    const phaseDisplay = s.lastPhase ?? '(unknown)';
    const scoreDisplay = s.lastScore != null ? s.lastScore.toFixed(2) : '(none)';
    const failureLine = s.lastFailure
      ? `  failure: ${s.lastFailure.phase} — ${s.lastFailure.message}`
      : null;
    // Only suggest a `next` action for ephemeral_deleted (last run cleaned up).
    // Avoid pointing at `fab inspect` until #20 ships — automation following
    // the hint would hit unknown-command otherwise.
    let next: string | undefined;
    if (s.lastRootKind === 'ephemeral_deleted') {
      next = `fab ${s.lastCommand} --keep …  (last run cleaned up; pass --keep next time to inspect it)`;
    }

    console.log(`[fab status] last command: ${s.lastCommand} @ ${s.lastTimestamp}`);
    console.log(`  root: ${rootDisplay} (${s.lastRootKind ?? 'n/a'})`);
    console.log(`  phase: ${phaseDisplay}   score: ${scoreDisplay}`);
    if (failureLine) console.log(failureLine);
    if (next) console.log(`  next: ${next}`);

    emitOk('status', { ok: true, state: 'populated', ...s }, { runRoot: s.lastRoot ?? undefined, next });
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((err: Error & { code?: string }) => {
  // Commander parse errors already wrote their message to stderr.
  // For other errors in non-JSON mode, surface them to stderr too.
  const isCommanderError = typeof err.code === 'string' && err.code.startsWith('commander.');
  if (!isJsonMode() && !isCommanderError) {
    console.error(`fab: ${err.message}`);
  }
  emitTopLevelError(err, process.argv);
});

function makeTempRoot(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
}
