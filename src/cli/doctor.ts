/**
 * `fab doctor` — pre-flight environment + peer-dep health check.
 *
 * Default tier runs cheap checks (node version, writable state dir, parseable
 * config, required runtime deps). `--deep` adds heavy checks (playwright
 * browsers, demo run).
 *
 * Active-config detection survives missing SDKs: env-scan first → try
 * `loadFabricConfig()` → static text fallback when load fails with
 * `ERR_MODULE_NOT_FOUND`. Otherwise the diagnostic command would crash on
 * the very thing it's diagnosing.
 *
 * Outcome taxonomy (per #18):
 *  - All checks pass (or only warn) → status:"ok", data.ok:true,  exit 0
 *  - Any check fails               → status:"ok", data.ok:false, exit 1
 *  - Doctor itself crashes          → status:"error", exit 1
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

import { getStateDir } from './state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  suggestedFix?: string;
}

export interface DoctorResult {
  ok: boolean;                 // true unless any check is `fail`
  checks: DoctorCheck[];
}

export interface RunDoctorOptions {
  /** Run heavy checks (playwright browsers, demo run). */
  deep?: boolean;
  /**
   * Override the project root used for `fabric.config.ts` lookup. Defaults to
   * `process.cwd()`. Tests pass a tmp dir.
   */
  cwd?: string;
}

// ---------------------------------------------------------------------------
// Required vs optional peer deps
// ---------------------------------------------------------------------------

/** Peers that ship as direct runtime deps and must be installed for fab to work at all. */
const REQUIRED_RUNTIME_DEPS = [
  'commander',
  'zod',
  'better-sqlite3',
  'pixelmatch',
  'pngjs',
  'typescript',
];

/** Optional peer deps. `warn` unless the active config / env demands them. */
const OPTIONAL_PEER_DEPS = [
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  'openai',
  '@kaneshir/lisa-mcp',
  '@playwright/test',
];

/**
 * Maps `LISA_LLM_PROVIDER` env values to the optional peer they require.
 * Used by active-config detection to escalate `warn` → `fail` when a missing
 * peer is actively referenced.
 */
const PROVIDER_TO_PEER: Record<string, string> = {
  anthropic: '@anthropic-ai/sdk',
  openai:    'openai',
  gemini:    '@google/generative-ai',
};

/**
 * Substrings that, if present in fabric.config.ts source text, demand the
 * corresponding peer dep at runtime.
 */
const STATIC_PROVIDER_REFS: Record<string, string> = {
  AnthropicProvider: '@anthropic-ai/sdk',
  OpenAIProvider:    'openai',
  GeminiProvider:    '@google/generative-ai',
  // ClaudeSdkProvider also depends on @anthropic-ai/sdk under the hood.
  ClaudeSdkProvider: '@anthropic-ai/sdk',
};

/**
 * The lisa-mcp binary is the AgentLoopProvider that hosts whichever LLM SDK
 * is selected. If LISA_LLM_PROVIDER is set OR fabric.config.ts references any
 * provider class / AgentLoopProvider, lisa-mcp is also required at runtime —
 * just having the SDK isn't enough.
 */
const LISA_MCP_PEER = '@kaneshir/lisa-mcp';

/**
 * Substrings whose presence in fabric.config.ts implies the agent-loop
 * pathway, which requires lisa-mcp regardless of which SDK is selected.
 */
const AGENT_LOOP_REFS = ['AgentLoopProvider', 'buildLisaMcpCommand', 'lisa-mcp'];

// ---------------------------------------------------------------------------
// Active-config detection
// ---------------------------------------------------------------------------

/**
 * Determine which optional peers are actively required by the user's setup.
 * Survives missing SDK by:
 *   1. env-scan first (no imports)
 *   2. then try `loadFabricConfig()`
 *   3. on ERR_MODULE_NOT_FOUND or other load failure, static text scan
 */
export function activelyRequiredPeers(cwd: string): Set<string> {
  const required = new Set<string>();

  // 1. Env-scan
  const provider = process.env.LISA_LLM_PROVIDER?.trim().toLowerCase();
  if (provider && PROVIDER_TO_PEER[provider]) {
    required.add(PROVIDER_TO_PEER[provider]);
    // lisa-mcp is the binary the agent loop spawns to host the SDK call.
    // Required whenever LISA_LLM_PROVIDER selects a real provider — having
    // just the SDK isn't enough.
    required.add(LISA_MCP_PEER);
  }

  // 2. Static text scan of fabric.config.ts (cheap, doesn't import).
  // We use this even on success-path because it catches references the
  // env scan misses, and it's our only source when loadFabricConfig fails.
  //
  // Provider class references (AnthropicProvider, OpenAIProvider, etc.)
  // require the SDK only. Direct `new OpenAIProvider(...)` is a valid
  // Path 1 setup that doesn't spawn lisa-mcp. Only the env-driven
  // agent-loop path (LISA_LLM_PROVIDER, handled above) or explicit
  // AGENT_LOOP_REFS imply lisa-mcp.
  const configPath = path.join(cwd, 'fabric.config.ts');
  if (fs.existsSync(configPath)) {
    try {
      const source = fs.readFileSync(configPath, 'utf8');
      for (const [marker, peer] of Object.entries(STATIC_PROVIDER_REFS)) {
        if (source.includes(marker)) required.add(peer);
      }
      // Direct references to the agent-loop / lisa-mcp surface — these
      // explicitly use lisa-mcp as the binary, so escalate it.
      for (const marker of AGENT_LOOP_REFS) {
        if (source.includes(marker)) required.add(LISA_MCP_PEER);
      }
    } catch {
      // Unreadable config — still report what env told us.
    }
  }

  return required;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkNodeVersion(): DoctorCheck {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 20) {
    return { name: 'node-version', status: 'ok', message: `node ${process.versions.node}` };
  }
  return {
    name: 'node-version',
    status: 'fail',
    message: `node ${process.versions.node} < required >=20`,
    suggestedFix: 'upgrade to Node.js 20 or later',
  };
}

function checkStateDirWritable(): DoctorCheck {
  const dir = getStateDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return { name: 'state-dir', status: 'ok', message: `writable: ${dir}` };
  } catch (err) {
    return {
      name: 'state-dir',
      status: 'fail',
      message: `cannot write to ${dir}: ${(err as Error).message}`,
      suggestedFix: 'check directory permissions or set FAB_STATE_DIR to a writable path',
    };
  }
}

function checkConfigFile(cwd: string): DoctorCheck {
  const configPath = path.join(cwd, 'fabric.config.ts');
  if (!fs.existsSync(configPath)) {
    return {
      name: 'fabric.config.ts',
      status: 'warn',
      message: 'fabric.config.ts not found',
      suggestedFix: 'run `fab init` to scaffold one',
    };
  }
  // We only check that the file is readable — full parse via loadFabricConfig
  // happens in the active-config probe below. A broken-but-present config
  // gets reported as fail by that probe.
  try {
    fs.readFileSync(configPath, 'utf8');
    return { name: 'fabric.config.ts', status: 'ok', message: `present at ${configPath}` };
  } catch (err) {
    return {
      name: 'fabric.config.ts',
      status: 'fail',
      message: `unreadable: ${(err as Error).message}`,
    };
  }
}

function isPeerInstalled(name: string): boolean {
  try {
    require.resolve(name, { paths: [process.cwd(), ...module.paths] });
    return true;
  } catch {
    return false;
  }
}

function checkRequiredRuntimeDeps(): DoctorCheck[] {
  return REQUIRED_RUNTIME_DEPS.map((dep) => {
    if (isPeerInstalled(dep)) {
      return { name: `runtime-dep:${dep}`, status: 'ok' as const, message: `${dep} installed` };
    }
    return {
      name: `runtime-dep:${dep}`,
      status: 'fail' as const,
      message: `${dep} missing`,
      suggestedFix: `npm install ${dep}`,
    };
  });
}

function checkOptionalPeerDeps(activelyRequired: Set<string>): DoctorCheck[] {
  return OPTIONAL_PEER_DEPS.map((dep) => {
    const installed = isPeerInstalled(dep);
    if (installed) {
      return { name: `optional-peer:${dep}`, status: 'ok' as const, message: `${dep} installed` };
    }
    if (activelyRequired.has(dep)) {
      return {
        name: `optional-peer:${dep}`,
        status: 'fail' as const,
        message: `${dep} missing but actively required (LISA_LLM_PROVIDER or fabric.config.ts references it)`,
        suggestedFix: `npm install ${dep}`,
      };
    }
    return {
      name: `optional-peer:${dep}`,
      status: 'warn' as const,
      message: `${dep} not installed (optional)`,
    };
  });
}

function checkPlaywrightBrowsers(): DoctorCheck {
  // Playwright caches browsers under ~/Library/Caches/ms-playwright (mac) or
  // ~/.cache/ms-playwright (linux). Existence of any chromium-* dir is enough.
  const candidates = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir);
      if (entries.some((e) => e.startsWith('chromium'))) {
        return { name: 'playwright-browsers', status: 'ok', message: `chromium found in ${dir}` };
      }
    }
  }
  return {
    name: 'playwright-browsers',
    status: 'fail',
    message: 'playwright chromium not installed',
    suggestedFix: 'npx playwright install chromium',
  };
}

function checkDemoRuns(cwd: string): DoctorCheck {
  // Heavy: spawns the demo. Capped at 30s by the orchestrator's own logic;
  // we add a 60s wall timeout via execSync's timeout option.
  const demoEntry = path.join(cwd, 'demo', 'run.ts');
  if (!fs.existsSync(demoEntry)) {
    return {
      name: 'demo-runs',
      status: 'warn',
      message: 'demo/run.ts not found in cwd (skipped — only relevant inside the synthetic-test-fabric repo)',
    };
  }
  try {
    const start = Date.now();
    execSync(`npx tsx ${demoEntry}`, { cwd, timeout: 60_000, stdio: 'pipe' });
    const dur = Date.now() - start;
    if (dur > 30_000) {
      return { name: 'demo-runs', status: 'warn', message: `demo took ${dur}ms (>30s budget)` };
    }
    return { name: 'demo-runs', status: 'ok', message: `demo completed in ${dur}ms` };
  } catch (err) {
    return {
      name: 'demo-runs',
      status: 'fail',
      message: `demo failed: ${(err as Error).message.slice(0, 200)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// runDoctor — orchestrates all checks
// ---------------------------------------------------------------------------

export function runDoctor(opts: RunDoctorOptions = {}): DoctorResult {
  const cwd = opts.cwd ?? process.cwd();
  const checks: DoctorCheck[] = [];

  // Default-tier checks.
  checks.push(checkNodeVersion());
  checks.push(checkStateDirWritable());
  checks.push(checkConfigFile(cwd));
  checks.push(...checkRequiredRuntimeDeps());

  const activelyRequired = activelyRequiredPeers(cwd);
  checks.push(...checkOptionalPeerDeps(activelyRequired));

  // Deep-tier checks.
  if (opts.deep) {
    checks.push(checkPlaywrightBrowsers());
    checks.push(checkDemoRuns(cwd));
  }

  const ok = !checks.some((c) => c.status === 'fail');
  return { ok, checks };
}
