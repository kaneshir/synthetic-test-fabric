/**
 * Generic MCP protocol probe battery (#46) — portable adversarial probes that
 * work against ANY compliant MCP server. The protocol surface is standardized
 * even when application authz isn't, so these probes ship out of the box.
 *
 * This module is **protocol-portable only**. Product-specific authz probes
 * (OAuth audience binding, AAL escalation, cross-org leakage, confirmation-token
 * forgery, idempotency abuse) live downstream in the adopter (e.g. Redy #1393).
 *
 * Classification is on the **JSON-RPC layer** (rejections ride over HTTP 200),
 * and each probe declares its own expected-secure signal — a stale-session 404,
 * for example, is *secure* for the stale-session probe, not "inconclusive".
 */

import { randomUUID } from 'crypto';
import { McpExecutor, McpTargetConfig } from './executor';
import { generateInputs } from './schema-gen';

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export type ProbeVerdict = 'secure' | 'violation' | 'inconclusive';

export interface ProbeOutcome {
  /** True if the request was rejected (JSON-RPC error, result.isError, or HTTP >= 400). */
  rejected: boolean;
  /** JSON-RPC error code, when present. */
  errorCode?: number;
  httpStatus: number;
  detail: string;
}

export interface ProbeResult {
  name: string;
  description: string;
  verdict: ProbeVerdict;
  expectedSecure: string;
  outcome: ProbeOutcome;
}

export interface ProbeBatteryResult {
  results: ProbeResult[];
  secure: number;
  violations: number;
  inconclusive: number;
  /** True if no advertised tool had a fuzzable schema, so schema enforcement couldn't be probed. */
  schemaProbeSkipped: boolean;
  /** Hard gate: a violation OR an inconclusive fails the battery. */
  passed: boolean;
}

/**
 * Classify a probe. A boundary holds (`secure`) only if the probe's own
 * expected-secure signal matched. Otherwise: a request that *succeeded* where
 * rejection was expected is a `violation`; a request that was rejected but not
 * in the expected way is `inconclusive` (a crash/typo must not pass as secure).
 */
export function classifyVerdict(isSecure: boolean, rejected: boolean): ProbeVerdict {
  if (isSecure) return 'secure';
  if (!rejected) return 'violation';
  return 'inconclusive';
}

// ---------------------------------------------------------------------------
// Probe specs
// ---------------------------------------------------------------------------

interface ProbeContext {
  endpoint: string;
  token: string;
  sessionId: string;
  protocolVersion: string;
  readToolName?: string;
  invalidArgs?: unknown;
  timeoutMs: number;
}

interface ProbeSpec {
  name: string;
  description: string;
  expectedSecure: string;
  /** Needs a discovered read tool + a schema-invalid input. */
  requiresReadTool?: boolean;
  build(ctx: ProbeContext): { headers: Record<string, string>; body: string };
  isSecure(o: ProbeOutcome): boolean;
}

function headers(
  ctx: ProbeContext,
  opts: { auth?: boolean; session?: string | null; version?: string } = {},
): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (opts.auth !== false) h['Authorization'] = `Bearer ${ctx.token}`;
  const session = opts.session === undefined ? ctx.sessionId : opts.session;
  if (session) h['Mcp-Session-Id'] = session;
  h['MCP-Protocol-Version'] = opts.version ?? ctx.protocolVersion;
  return h;
}

const rpc = (method: string, params: Record<string, unknown> = {}): string =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });

const PROBE_SPECS: ProbeSpec[] = [
  {
    name: 'unauthenticated',
    description: 'tools/list with no Authorization header',
    expectedSecure: 'rejected with -32001 (or HTTP 401)',
    build: (ctx) => ({ headers: headers(ctx, { auth: false, session: null }), body: rpc('tools/list') }),
    isSecure: (o) => o.errorCode === -32001 || o.httpStatus === 401,
  },
  {
    name: 'malformed-missing-jsonrpc',
    description: 'request body without jsonrpc:"2.0"',
    expectedSecure: 'rejected with -32600 (invalid request)',
    build: (ctx) => ({ headers: headers(ctx), body: JSON.stringify({ id: 1, method: 'tools/list', params: {} }) }),
    isSecure: (o) => o.errorCode === -32600,
  },
  {
    name: 'malformed-parse-error',
    description: 'syntactically invalid JSON body',
    expectedSecure: 'rejected with -32700 (parse error)',
    build: (ctx) => ({ headers: headers(ctx), body: '{ not valid json' }),
    isSecure: (o) => o.errorCode === -32700,
  },
  {
    name: 'unknown-tool',
    description: 'tools/call for a non-existent tool',
    expectedSecure: 'rejected with -32004 or -32601 (not found)',
    build: (ctx) => ({ headers: headers(ctx), body: rpc('tools/call', { name: 'stf.__nonexistent__', arguments: {} }) }),
    isSecure: (o) => o.errorCode === -32004 || o.errorCode === -32601,
  },
  {
    name: 'schema-violating-args',
    description: 'tools/call a known tool with schema-invalid arguments',
    expectedSecure: 'rejected with -32602 (invalid params)',
    requiresReadTool: true,
    build: (ctx) => ({
      headers: headers(ctx),
      body: rpc('tools/call', { name: ctx.readToolName, arguments: ctx.invalidArgs as Record<string, unknown> }),
    }),
    isSecure: (o) => o.errorCode === -32602,
  },
  {
    name: 'stale-session',
    description: 'session-scoped call with a forged Mcp-Session-Id',
    expectedSecure: 'rejected with HTTP 404 (client should reinitialize)',
    build: (ctx) => ({ headers: headers(ctx, { session: `stale-${randomUUID()}` }), body: rpc('tools/list') }),
    isSecure: (o) => o.httpStatus === 404,
  },
  {
    name: 'missing-session',
    description: 'session-scoped call with no Mcp-Session-Id',
    expectedSecure: 'rejected with HTTP 404 or -32001',
    build: (ctx) => ({ headers: headers(ctx, { session: null }), body: rpc('tools/list') }),
    isSecure: (o) => o.httpStatus === 404 || o.errorCode === -32001,
  },
  {
    name: 'unsupported-protocol-version',
    description: 'initialize with an unsupported protocol version',
    expectedSecure: 'rejected with -32602',
    build: (ctx) => ({
      headers: headers(ctx, { session: null, version: '1999-01-01' }),
      body: rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'probe', version: '1' } }),
    }),
    isSecure: (o) => o.errorCode === -32602,
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface ProbeOptions {
  log?: (message: string) => void;
}

/**
 * Run the generic protocol probe battery against an MCP target. Establishes a
 * valid session for setup, then fires each probe with a raw request and
 * classifies the result on the JSON-RPC layer.
 */
export async function runProtocolProbes(config: McpTargetConfig, opts: ProbeOptions = {}): Promise<ProbeBatteryResult> {
  const log = opts.log ?? (() => undefined);
  // Resolve the token ONCE and pass it explicitly, so a rotating/fresh provider
  // can't initialize the session under a different token than the raw probes use
  // (which would cause a false session/principal mismatch).
  const token = config.tokenProvider ? await config.tokenProvider() : config.token ?? '';

  const exec = new McpExecutor({ ...config, token, tokenProvider: undefined });
  await exec.initialize();

  // Find the first non-destructive tool that has a fuzzable (boundary-invalid)
  // schema. Scan ALL read tools, not just the first — a no-arg first tool must
  // not disable the schema probe if a later tool is fuzzable.
  let readToolName: string | undefined;
  let invalidArgs: unknown;
  try {
    const tools = await exec.listTools();
    for (const t of tools.filter((tool) => tool.annotations?.destructiveHint !== true)) {
      const gen = generateInputs(t.inputSchema);
      if (gen.invalid.length) {
        readToolName = t.name;
        invalidArgs = gen.invalid[0].input;
        break;
      }
    }
  } catch {
    /* discovery failure just disables the schema-violation probe */
  }
  const schemaProbeSkipped = readToolName === undefined;

  const ctx: ProbeContext = {
    endpoint: config.endpoint,
    token,
    sessionId: exec.currentSessionId ?? '',
    protocolVersion: exec.negotiatedProtocolVersion ?? '2025-03-26',
    readToolName,
    invalidArgs,
    timeoutMs: config.timeoutMs ?? 30_000,
  };

  const results: ProbeResult[] = [];
  for (const spec of PROBE_SPECS) {
    if (spec.requiresReadTool && (!ctx.readToolName || ctx.invalidArgs === undefined)) {
      // Don't silently drop — record inconclusive so the hard gate reflects that
      // schema enforcement could not be verified (and #47 can read schemaProbeSkipped).
      log(`probe '${spec.name}' → inconclusive (no advertised tool has a fuzzable schema)`);
      results.push({
        name: spec.name,
        description: spec.description,
        verdict: 'inconclusive',
        expectedSecure: spec.expectedSecure,
        outcome: { rejected: true, httpStatus: 0, detail: 'no advertised tool has a fuzzable schema' },
      });
      continue;
    }
    const { headers: h, body } = spec.build(ctx);
    const outcome = await rawSend(ctx.endpoint, h, body, ctx.timeoutMs);
    const verdict = classifyVerdict(spec.isSecure(outcome), outcome.rejected);
    if (verdict !== 'secure') log(`probe '${spec.name}' → ${verdict} (expected: ${spec.expectedSecure}; got ${describe(outcome)})`);
    results.push({ name: spec.name, description: spec.description, verdict, expectedSecure: spec.expectedSecure, outcome });
  }

  const secure = results.filter((r) => r.verdict === 'secure').length;
  const violations = results.filter((r) => r.verdict === 'violation').length;
  const inconclusive = results.filter((r) => r.verdict === 'inconclusive').length;
  return { results, secure, violations, inconclusive, schemaProbeSkipped, passed: violations === 0 && inconclusive === 0 };
}

// ---------------------------------------------------------------------------
// Raw transport
// ---------------------------------------------------------------------------

async function rawSend(endpoint: string, h: Record<string, string>, body: string, timeoutMs: number): Promise<ProbeOutcome> {
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: h, body, signal: AbortSignal.timeout(timeoutMs) });
    const envelope = await parseRpc(res);
    const rejected = !!envelope.error || envelope.result?.isError === true || res.status >= 400;
    return {
      rejected,
      errorCode: envelope.error?.code,
      httpStatus: res.status,
      detail: envelope.error?.message ?? '',
    };
  } catch (err) {
    // Transport/timeout — rejected, but not a clean protocol signal → inconclusive territory.
    return { rejected: true, httpStatus: 0, detail: `transport error: ${(err as Error)?.message}` };
  }
}

async function parseRpc(res: Response): Promise<any> {
  if (res.status === 202) return {};
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (!text) return {};
  if (ct.includes('text/event-stream') || text.startsWith('event:') || text.startsWith('data:')) {
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    try {
      return line ? JSON.parse(line.slice(line.indexOf(':') + 1).trim()) : {};
    } catch {
      return {};
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function describe(o: ProbeOutcome): string {
  return `http=${o.httpStatus} code=${o.errorCode ?? 'none'} rejected=${o.rejected}`;
}
