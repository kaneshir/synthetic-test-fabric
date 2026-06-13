/**
 * MCP discovery + coverage (#44) — builds on McpExecutor.listTools():
 *
 *  - **Catalog pinning**: snapshot the advertised tool set (names + input-schema
 *    hashes + optional catalog version) so drift (added/removed/changed tools)
 *    is flagged instead of silently changing the coverage number.
 *  - **Coverage**: invoke each advertised tool with a schema-generated valid
 *    input and report covered / uncovered / policy-skipped / unsupported-schema.
 *    Read-only by default — write/destructive tools are skipped unless opted in.
 *  - **Schema fuzzing hook**: boundary-invalid inputs (from schema-gen) are
 *    available per tool for #46 probes.
 */

import * as crypto from 'crypto';
import { McpExecutor, McpToolMeta } from './executor';
import { generateInputs } from './schema-gen';
import { BEHAVIOR_OUTCOMES, BehaviorOutcome } from '../outcomes';

// ---------------------------------------------------------------------------
// Catalog pinning
// ---------------------------------------------------------------------------

export interface CatalogSnapshot {
  catalogVersion?: string;
  tools: Array<{ name: string; schemaHash: string }>;
}

export interface CatalogDiff {
  added: string[];
  removed: string[];
  changed: string[]; // same name, different input-schema hash
  versionChanged: boolean;
  drifted: boolean;
}

function schemaHash(schema: unknown): string {
  // Stable hash of the input schema (key order normalized).
  return crypto.createHash('sha256').update(stableStringify(schema ?? {})).digest('hex').slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(',')}}`;
}

export function snapshotCatalog(tools: McpToolMeta[], catalogVersion?: string): CatalogSnapshot {
  return {
    catalogVersion,
    tools: tools
      .map((t) => ({ name: t.name, schemaHash: schemaHash(t.inputSchema) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function diffCatalog(pinned: CatalogSnapshot, current: CatalogSnapshot): CatalogDiff {
  const pinnedMap = new Map(pinned.tools.map((t) => [t.name, t.schemaHash]));
  const currentMap = new Map(current.tools.map((t) => [t.name, t.schemaHash]));

  const added = current.tools.filter((t) => !pinnedMap.has(t.name)).map((t) => t.name);
  const removed = pinned.tools.filter((t) => !currentMap.has(t.name)).map((t) => t.name);
  const changed = current.tools
    .filter((t) => pinnedMap.has(t.name) && pinnedMap.get(t.name) !== t.schemaHash)
    .map((t) => t.name);
  const versionChanged = (pinned.catalogVersion ?? null) !== (current.catalogVersion ?? null);

  return {
    added,
    removed,
    changed,
    versionChanged,
    drifted: added.length > 0 || removed.length > 0 || changed.length > 0 || versionChanged,
  };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export interface McpCoverageResult {
  toolsTotal: number;
  /** Tools invoked with a valid input that returned success. */
  covered: string[];
  /** Tools invoked but not successful (with the classified outcome). */
  uncovered: Array<{ name: string; outcome: BehaviorOutcome }>;
  /** Write/destructive tools skipped because writes weren't opted in. */
  skippedByPolicy: string[];
  /** Tools whose input schema used constructs the generator can't model. */
  unsupportedSchemas: Array<{ name: string; constructs: string[] }>;
  /** Tools that correctly rejected a boundary-invalid input. */
  invalidRejected: string[];
  /** Coverage ratio over the in-policy tool set (excludes skippedByPolicy). */
  coverageRatio: number;
  /** Protocol version exercised, for the artifact (#47/#1394). */
  protocolVersion?: string;
}

export interface CoverageOptions {
  /** Exercise write/destructive tools too (requires the executor's allowWrites). Default false. */
  includeWrites?: boolean;
  /** Also send one boundary-invalid input per tool and record correct rejections. Default true. */
  probeInvalid?: boolean;
  /** Sink for skip/unsupported notices so truncation is never silent. */
  log?: (message: string) => void;
}

/**
 * Discover the target's advertised tools and measure coverage by invoking each
 * with a schema-generated valid input. Read-only by default.
 */
export async function runMcpCoverage(executor: McpExecutor, opts: CoverageOptions = {}): Promise<McpCoverageResult> {
  const log = opts.log ?? (() => undefined);
  const probeInvalid = opts.probeInvalid ?? true;
  const tools = await executor.listTools();

  const result: McpCoverageResult = {
    toolsTotal: tools.length,
    covered: [],
    uncovered: [],
    skippedByPolicy: [],
    unsupportedSchemas: [],
    invalidRejected: [],
    coverageRatio: 0,
    protocolVersion: executor.negotiatedProtocolVersion,
  };

  for (const tool of tools) {
    const isWrite = tool.annotations?.destructiveHint === true;
    if (isWrite && !opts.includeWrites) {
      result.skippedByPolicy.push(tool.name);
      log(`skipped (write, read-only policy): ${tool.name}`);
      continue;
    }

    const gen = generateInputs(tool.inputSchema);
    if (gen.unsupported.length) {
      result.unsupportedSchemas.push({ name: tool.name, constructs: gen.unsupported });
      log(`unsupported schema constructs for ${tool.name}: ${gen.unsupported.join(', ')}`);
    }

    const r = await executor.callTool(tool.name, gen.valid as Record<string, unknown>, { write: isWrite });
    if (r.ok) result.covered.push(tool.name);
    else result.uncovered.push({ name: tool.name, outcome: r.outcome });

    if (probeInvalid && gen.invalid.length) {
      const inv = await executor.callTool(tool.name, gen.invalid[0].input as Record<string, unknown>, { write: isWrite });
      // A schema-invalid input should be rejected (not a success).
      if (!inv.ok && inv.outcome === BEHAVIOR_OUTCOMES.ERROR_400) result.invalidRejected.push(tool.name);
    }
  }

  const inPolicy = result.toolsTotal - result.skippedByPolicy.length;
  result.coverageRatio = inPolicy > 0 ? result.covered.length / inPolicy : 0;
  return result;
}
