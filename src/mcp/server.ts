#!/usr/bin/env node
/**
 * `fab-mcp` — MCP server wrapping every `fab` command.
 *
 * Exposes 19 tools, all prefixed `stf_*`, that subprocess into the bundled
 * `fab` CLI with `--json`. Outcome translation honors the #18 caller contract:
 *
 *   status: "ok"  + data.ok: true       → MCP success (envelope JSON in content)
 *   status: "ok"  + data.ok: false       → MCP success (NOT isError; agent reads data.ok)
 *   status: "error"                       → MCP error (isError: true; full envelope in content)
 *
 * Stdout-purity is preserved end-to-end via mcp/runner.ts: child stdout is
 * the only source for the envelope; child stderr is forwarded as MCP log
 * notifications so adapter progress reaches the agent without contaminating
 * the result.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  LoggingMessageNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { runFabCommand, resolveEnvTimeoutMs } from './runner';

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/** Per-tool default timeout in ms. */
const TIMEOUT_SHORT  = 30_000;
const TIMEOUT_MEDIUM = 120_000;
const TIMEOUT_LONG   = 300_000;
const TIMEOUT_XLONG  = 1_800_000;

interface ToolDefinition {
  name: string;
  description: string;
  /** zod schema for input validation. */
  schema: z.ZodTypeAny;
  /** Default timeout if input doesn't override via timeout_ms. */
  defaultTimeoutMs: number;
  /** Build the fab CLI argv from the validated input. */
  buildArgs: (input: any) => string[];
}

// Common option shapes.
const rootSchema = { root: z.string().describe('Loop root or iteration root directory') };
const optionalTimeout = { timeout_ms: z.number().int().positive().optional().describe('Per-call timeout in milliseconds (overrides default)') };

const TOOLS: ToolDefinition[] = [
  // ── short / interactive ─────────────────────────────────────────────
  {
    name: 'stf_status',
    description: '"Where am I" — show the most recent fab command outcome from ~/.fab/state.json. First call when orienting.',
    schema: z.object({}),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: () => ['status'],
  },
  {
    name: 'stf_inspect',
    description: 'Structured summary of a loop or iteration root. Returns phase, score, flows, recent behavior events, latest screenshot.',
    schema: z.object({
      ...rootSchema,
      kind: z.enum(['loop', 'iteration']).optional().describe('Force interpretation when path is ambiguous'),
    }),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => {
      const args = ['inspect', '--root', input.root];
      if (input.kind) args.push('--kind', input.kind);
      return args;
    },
  },
  {
    name: 'stf_init',
    description: 'Scaffold a new fabric.config.ts + 8 adapter stubs into a target directory. Use when onboarding a new product to STF.',
    schema: z.object({
      dir: z.string().optional().describe('Target directory (default: cwd)'),
      force: z.boolean().optional().describe('Overwrite existing files'),
    }),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => {
      const args = ['init'];
      if (input.dir) args.push('--dir', input.dir);
      if (input.force) args.push('--force');
      return args;
    },
  },
  {
    name: 'stf_doctor',
    description: 'Pre-flight environment + peer-dep health check. Run before onboarding or when CI is failing for opaque reasons.',
    schema: z.object({
      deep: z.boolean().optional().describe('Include heavy checks (playwright browsers, demo run)'),
      ...optionalTimeout,
    }),
    defaultTimeoutMs: TIMEOUT_MEDIUM,
    buildArgs: (input) => {
      const args = ['doctor'];
      if (input.deep) args.push('--deep');
      return args;
    },
  },
  {
    name: 'stf_score',
    description: 'Compute fabric score from an existing run root. Reads fabric-score.json via the scoring adapter.',
    schema: z.object(rootSchema),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => ['score', '--root', input.root],
  },
  {
    name: 'stf_seed',
    description: 'Seed simulation fixtures into a run root. Primitive — usually called via fab smoke / fresh / orchestrate.',
    schema: z.object({
      ...rootSchema,
      scenario: z.string().optional(),
      seekers: z.number().int().nonnegative().optional(),
      employers: z.number().int().nonnegative().optional(),
      employees: z.number().int().nonnegative().optional(),
    }),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => {
      const args = ['seed', '--root', input.root];
      if (input.scenario) args.push('--scenario', input.scenario);
      if (input.seekers != null)   args.push('--seekers', String(input.seekers));
      if (input.employers != null) args.push('--employers', String(input.employers));
      if (input.employees != null) args.push('--employees', String(input.employees));
      return args;
    },
  },
  {
    name: 'stf_verify',
    description: 'Fail-closed fixture verification on an existing run root.',
    schema: z.object(rootSchema),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => ['verify', '--root', input.root],
  },
  {
    name: 'stf_feedback',
    description: 'Generate feedback JSON from an existing run root. Requires fabric-score.json present (run stf_score first).',
    schema: z.object(rootSchema),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => ['feedback', '--root', input.root],
  },
  {
    name: 'stf_analyze',
    description: 'Extract discovered screen paths from behavior events.',
    schema: z.object(rootSchema),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => ['analyze', '--root', input.root],
  },
  {
    name: 'stf_check',
    description: 'CI score gate — exit 1 if fabric-score.json overall is below threshold. Returns data.ok=false on threshold failure (NOT isError).',
    schema: z.object({
      ...rootSchema,
      threshold: z.number().optional().describe('Minimum passing score (0-10), default 8.0'),
    }),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => {
      const args = ['check', '--root', input.root];
      if (input.threshold != null) args.push('--threshold', String(input.threshold));
      return args;
    },
  },
  // ── baseline trio ───────────────────────────────────────────────────
  {
    name: 'stf_baseline_list',
    description: 'List all visual regression baselines.',
    schema: z.object({ baseline_dir: z.string().optional() }),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => {
      const args = ['baseline', 'list'];
      if (input.baseline_dir) args.push('--baseline-dir', input.baseline_dir);
      return args;
    },
  },
  {
    name: 'stf_baseline_update',
    description: 'Accept the current screenshot as the new baseline for a flow.',
    schema: z.object({
      flow: z.string(),
      ...rootSchema,
      baseline_dir: z.string().optional(),
    }),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => {
      const args = ['baseline', 'update', input.flow, '--root', input.root];
      if (input.baseline_dir) args.push('--baseline-dir', input.baseline_dir);
      return args;
    },
  },
  {
    name: 'stf_baseline_reset',
    description: 'Delete all baselines — next run will re-capture from scratch.',
    schema: z.object({ baseline_dir: z.string().optional() }),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => {
      const args = ['baseline', 'reset'];
      if (input.baseline_dir) args.push('--baseline-dir', input.baseline_dir);
      return args;
    },
  },
  // ── adapter scaffolding + validation ────────────────────────────────
  {
    name: 'stf_adapter_scaffold',
    description: 'Generate a single adapter stub. type ∈ {app, simulation, scoring, feedback, memory, browser, reporter, planner}.',
    schema: z.object({
      type: z.enum(['app', 'simulation', 'scoring', 'feedback', 'memory', 'browser', 'reporter', 'planner']),
      out: z.string().optional().describe('Output file path (omit to receive content in envelope.data.content)'),
      name: z.string().optional().describe('Override the generated class name'),
      force: z.boolean().optional(),
    }),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => {
      const args = ['adapter', 'scaffold', input.type];
      if (input.out)   args.push('--out', input.out);
      if (input.name)  args.push('--name', input.name);
      if (input.force) args.push('--force');
      return args;
    },
  },
  {
    name: 'stf_adapter_validate',
    description: 'Type-check a TS adapter file against its target interface. Reports missing methods. Returns data.ok=false on validation failure (NOT isError).',
    schema: z.object({
      path: z.string(),
      type: z.enum(['app', 'simulation', 'scoring', 'feedback', 'memory', 'browser', 'reporter', 'planner']).optional()
        .describe('Force adapter type (default: auto-detect from class name suffix)'),
    }),
    defaultTimeoutMs: TIMEOUT_SHORT,
    buildArgs: (input) => {
      const args = ['adapter', 'validate', input.path];
      if (input.type) args.push('--type', input.type);
      return args;
    },
  },
  // ── medium / smoke ──────────────────────────────────────────────────
  {
    name: 'stf_smoke',
    description: 'Fastest handoff check: seed → verify → one bounded smoke flow. Use for "is everything wired correctly".',
    schema: z.object({
      root: z.string().optional(),
      keep: z.boolean().optional().describe('Keep the run root after completion'),
      ...optionalTimeout,
    }),
    defaultTimeoutMs: TIMEOUT_MEDIUM,
    buildArgs: (input) => {
      const args = ['smoke'];
      if (input.root) args.push('--root', input.root);
      if (input.keep) args.push('--keep');
      return args;
    },
  },
  // ── long / flows ────────────────────────────────────────────────────
  {
    name: 'stf_flows',
    description: 'Run Playwright flows against an existing run root.',
    schema: z.object({
      ...rootSchema,
      grep: z.string().optional(),
      project: z.string().optional().describe('Playwright project name (default: flows)'),
      ...optionalTimeout,
    }),
    defaultTimeoutMs: TIMEOUT_LONG,
    buildArgs: (input) => {
      const args = ['flows', '--root', input.root];
      if (input.grep)    args.push('--grep', input.grep);
      if (input.project) args.push('--project', input.project);
      return args;
    },
  },
  // ── very long / orchestrate + fresh ─────────────────────────────────
  {
    name: 'stf_fresh',
    description: 'One-shot fresh run: seed → verify → optionally flows → optionally score+feedback. Heavy; default 30min timeout.',
    schema: z.object({
      flows: z.boolean().optional(),
      plan: z.boolean().optional().describe('Compute score and generate feedback after seeding'),
      scenario: z.string().optional(),
      root: z.string().optional(),
      keep: z.boolean().optional(),
      seekers: z.number().int().nonnegative().optional(),
      employers: z.number().int().nonnegative().optional(),
      employees: z.number().int().nonnegative().optional(),
      ...optionalTimeout,
    }),
    defaultTimeoutMs: TIMEOUT_XLONG,
    buildArgs: (input) => {
      const args = ['fresh'];
      if (input.flows)    args.push('--flows');
      if (input.plan)     args.push('--plan');
      if (input.scenario) args.push('--scenario', input.scenario);
      if (input.root)     args.push('--root', input.root);
      if (input.keep)     args.push('--keep');
      if (input.seekers != null)   args.push('--seekers', String(input.seekers));
      if (input.employers != null) args.push('--employers', String(input.employers));
      if (input.employees != null) args.push('--employees', String(input.employees));
      return args;
    },
  },
  {
    name: 'stf_orchestrate',
    description: 'Full autonomous loop: SEED → VERIFY → RUN → ANALYZE → GENERATE_FLOWS → TEST → SCORE → FEEDBACK. Heavy; default 30min timeout.',
    schema: z.object({
      iterations: z.number().int().positive().optional(),
      ticks: z.number().int().positive().optional(),
      seekers: z.number().int().nonnegative().optional(),
      employers: z.number().int().nonnegative().optional(),
      employees: z.number().int().nonnegative().optional(),
      scenario: z.string().optional(),
      root: z.string().optional(),
      live_llm: z.boolean().optional(),
      allow_regression_failures: z.boolean().optional(),
      ...optionalTimeout,
    }),
    defaultTimeoutMs: TIMEOUT_XLONG,
    buildArgs: (input) => {
      const args = ['orchestrate'];
      if (input.iterations != null) args.push('--iterations', String(input.iterations));
      if (input.ticks != null)      args.push('--ticks', String(input.ticks));
      if (input.seekers != null)    args.push('--seekers', String(input.seekers));
      if (input.employers != null)  args.push('--employers', String(input.employers));
      if (input.employees != null)  args.push('--employees', String(input.employees));
      if (input.scenario)           args.push('--scenario', input.scenario);
      if (input.root)               args.push('--root', input.root);
      if (input.live_llm)           args.push('--live-llm');
      if (input.allow_regression_failures) args.push('--allow-regression-failures');
      return args;
    },
  },
];

/** Exact tool count for #26's tools/list assertion. */
export const TOOL_COUNT = TOOLS.length;
export const TOOL_NAMES = TOOLS.map((t) => t.name) as readonly string[];

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

export function createServer(): Server {
  const server = new Server(
    { name: 'fab-mcp', version: '0.1.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  // tools/list
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      // Convert zod schema to JSON Schema for the MCP wire format. We use a
      // minimal converter: each tool's zod schema is a z.object — we translate
      // the top-level shape directly.
      inputSchema: zodObjectToJsonSchema(t.schema),
    })),
  }));

  // tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({
          command: name,
          status: 'error',
          error: { message: `unknown tool: ${name}`, code: 'UNKNOWN_TOOL' },
        }) }],
      };
    }

    // Validate input against the tool's zod schema. zod errors are
    // infrastructure errors (the agent sent garbage).
    let input;
    try {
      input = tool.schema.parse(args ?? {});
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({
          command: name,
          status: 'error',
          error: { message: `input validation failed: ${(err as Error).message}`, code: 'INVALID_INPUT' },
        }) }],
      };
    }

    const inputObj = input as { timeout_ms?: number };
    const fabArgs = tool.buildArgs(input);
    // Precedence: per-call input.timeout_ms > FAB_MCP_TIMEOUT_MS env > tool default.
    // Env was advertised in docs/mcp-install.md but bypassed before — the
    // server passed tool.defaultTimeoutMs straight through, so the env never
    // reached the runner.
    const timeoutMs = inputObj.timeout_ms ?? resolveEnvTimeoutMs() ?? tool.defaultTimeoutMs;

    // Run, forwarding stderr lines as MCP log notifications so the agent
    // can see adapter progress without it polluting the result envelope.
    const result = await runFabCommand(fabArgs, {
      timeoutMs,
      onStderrLine: (line) => {
        server.notification({
          method: 'notifications/message',
          params: { level: 'info', logger: 'fab-mcp', data: line },
        }).catch(() => {/* best-effort log forwarding */});
      },
    });

    return mapEnvelopeToMcp(result.envelope);
  });

  return server;
}

/**
 * Map a #18 envelope to an MCP tool response per the #27 caller contract:
 *
 *   status:"ok"  + data.ok:true   → MCP success (envelope JSON in content)
 *   status:"ok"  + data.ok:false   → MCP success (NOT isError; agent reads data.ok)
 *   status:"error"                  → MCP error (isError:true; full envelope JSON)
 *
 * Full envelope JSON in content (not just error.message) so codes like
 * AMBIGUOUS_ROOT / UNKNOWN_ROOT / INIT_CONFLICT survive the transport.
 */
function mapEnvelopeToMcp(envelope: Record<string, unknown>): { isError?: boolean; content: Array<{ type: 'text'; text: string }> } {
  const text = JSON.stringify(envelope);
  const isInfraError = envelope.status === 'error';
  return {
    isError: isInfraError ? true : undefined,
    content: [{ type: 'text', text }],
  };
}

/**
 * Minimal zod → JSON Schema converter. Handles z.object with the field types
 * we use (z.string, z.number, z.boolean, z.enum, z.optional). Good enough
 * for tool input schemas; not a general-purpose converter.
 */
function zodObjectToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (!(schema instanceof z.ZodObject)) {
    return { type: 'object' };
  }
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const isOptional = (value as z.ZodTypeAny).isOptional();
    const inner = isOptional ? (value as z.ZodOptional<z.ZodTypeAny>)._def.innerType : (value as z.ZodTypeAny);
    properties[key] = zodTypeToJsonSchema(inner);
    if (!isOptional) required.push(key);
  }

  return required.length > 0
    ? { type: 'object', properties, required }
    : { type: 'object', properties };
}

function zodTypeToJsonSchema(t: z.ZodTypeAny): Record<string, unknown> {
  const description = t.description;
  const base: Record<string, unknown> = description ? { description } : {};

  if (t instanceof z.ZodString)  return { ...base, type: 'string' };
  if (t instanceof z.ZodNumber)  return { ...base, type: 'number' };
  if (t instanceof z.ZodBoolean) return { ...base, type: 'boolean' };
  if (t instanceof z.ZodEnum)    return { ...base, type: 'string', enum: t._def.values };
  if (t instanceof z.ZodObject)  return { ...base, ...zodObjectToJsonSchema(t) };
  return { ...base, type: 'string' };  // fallback
}

// ---------------------------------------------------------------------------
// Entry point — only runs when invoked as `fab-mcp` (not when imported)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const server = createServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    process.stderr.write(`[fab-mcp] fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}

// LoggingMessageNotificationSchema referenced for type clarity even though
// we use server.notification directly. Keeps the import obvious to readers.
void LoggingMessageNotificationSchema;
