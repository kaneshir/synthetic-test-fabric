/**
 * MCP target scoring (#47) — combines discovery coverage (#44) and the protocol
 * probe battery (#46) into a single assessment, shaped for `FabricScore.details.mcp`.
 *
 * Per the agreed decision, MCP results live under `FabricScore.details.mcp` (the
 * open escape hatch) rather than a new entry in the closed `dimensions` union, so
 * existing typed consumers are unaffected. The exercised protocol version is
 * carried in the artifact so a later run against a newer server is distinguishable.
 */

import { McpExecutor, McpTargetConfig } from './executor';
import { runMcpCoverage } from './discovery';
import { runProtocolProbes } from './probes';

export interface McpTargetScore {
  /** Optional capability profile the target claims to implement (e.g. 'read-only-surface'). */
  surface?: string;
  /** Protocol version actually negotiated/exercised this run. */
  protocolVersion?: string;
  coverage: {
    toolsTotal: number;
    covered: number;
    uncovered: number;
    skippedByPolicy: number;
    unsupportedSchemas: number;
    ratio: number;
  };
  adversarial: {
    secure: number;
    violations: number;
    inconclusive: number;
    /** True if no advertised tool had a fuzzable schema (schema enforcement unverified). */
    schemaProbeSkipped: boolean;
    passed: boolean;
  };
  /** Overall gate: adversarial held AND coverage met the threshold. */
  passed: boolean;
}

export interface AssessMcpTargetOptions {
  /** Capability profile label, echoed into the score. */
  surface?: string;
  /** Exercise write/destructive tools in coverage too (needs the executor's allowWrites). */
  includeWrites?: boolean;
  /** Minimum coverage ratio (0–1) required to pass. Default 0 (coverage informational). */
  coverageThreshold?: number;
  log?: (message: string) => void;
}

/**
 * Assess an MCP target end-to-end: discover + measure coverage, then run the
 * generic protocol probe battery. Returns a `details.mcp`-shaped score.
 */
export async function assessMcpTarget(config: McpTargetConfig, opts: AssessMcpTargetOptions = {}): Promise<McpTargetScore> {
  const log = opts.log ?? (() => undefined);
  const threshold = opts.coverageThreshold ?? 0;

  // includeWrites is the user-facing write opt-in for the assessment — make it
  // self-sufficient by enabling the executor's write guard, so coverage doesn't
  // throw McpWriteBlockedError at the first destructive tool.
  const exec = new McpExecutor({ ...config, allowWrites: opts.includeWrites ? true : config.allowWrites });
  const coverage = await runMcpCoverage(exec, { includeWrites: opts.includeWrites, log });
  const probes = await runProtocolProbes(config, { log });

  const coverageMet = coverage.coverageRatio >= threshold;
  return {
    surface: opts.surface,
    protocolVersion: coverage.protocolVersion ?? exec.negotiatedProtocolVersion,
    coverage: {
      toolsTotal: coverage.toolsTotal,
      covered: coverage.covered.length,
      uncovered: coverage.uncovered.length,
      skippedByPolicy: coverage.skippedByPolicy.length,
      unsupportedSchemas: coverage.unsupportedSchemas.length,
      ratio: coverage.coverageRatio,
    },
    adversarial: {
      secure: probes.secure,
      violations: probes.violations,
      inconclusive: probes.inconclusive,
      schemaProbeSkipped: probes.schemaProbeSkipped,
      passed: probes.passed,
    },
    passed: probes.passed && coverageMet,
  };
}

/**
 * Wrap an McpTargetScore for merging into `FabricScore.details`:
 *   score.details = { ...score.details, ...mcpScoreToDetails(mcp) }
 */
export function mcpScoreToDetails(score: McpTargetScore): { mcp: McpTargetScore } {
  return { mcp: score };
}
