/**
 * McpExecutor (#43) — a Streamable-HTTP MCP **target client** for STF target
 * testing. The MCP analog of `src/api-executor.ts`: it drives an MCP server as
 * a system-under-test and records a BehaviorEvent per tool call.
 *
 * This is a separate HTTP/Streamable path — it does NOT overload the stdio
 * `src/mcp-client.ts` (which spawns the lisa-mcp binary for the inverse,
 * agent-consuming-MCP use case).
 *
 * Faithful to the hard parts of a production contract (exercised by the #45
 * fixture):
 *   - `initialize` → `Mcp-Session-Id` lifecycle; protocol-version negotiation;
 *     `MCP-Protocol-Version` header on subsequent requests
 *   - both response forms parsed: plain JSON and request-scoped SSE
 *   - stale-session (HTTP 404) → reinitialize-and-retry once
 *   - paginated `tools/list` (follows `nextCursor`)
 *   - outcomes classified on the JSON-RPC layer (errors ride over HTTP 200),
 *     raw `mcp_error_<code>` preserved in the event detail
 *   - read-only by default: write/destructive tools require `allowWrites`
 *   - generic two-phase `previewThenCommit` (opaque confirmation-token passthrough)
 */

import { randomUUID } from 'crypto';
import { BehaviorEventRecorder } from '../recorder';
import { classifyMcpOutcome, BehaviorOutcome, BEHAVIOR_OUTCOMES } from '../outcomes';

// ---------------------------------------------------------------------------
// Public types (transport-agnostic surface)
// ---------------------------------------------------------------------------

export interface McpTargetConfig {
  /** Full endpoint URL, e.g. http://host/mcp */
  endpoint: string;
  /** Path to lisa.db — behavior events are written here. */
  dbPath: string;
  simulationId: string;
  agentId: string;
  /** Static bearer token, or an async provider resolved on initialize. */
  token?: string;
  tokenProvider?: () => string | Promise<string>;
  /** Extra headers attached to every request. */
  headers?: Record<string, string>;
  /** Protocol versions to negotiate; the first is preferred. Default ['2025-03-26']. */
  protocolVersions?: string[];
  /** Read-only by default — write/destructive tool calls throw unless this is true. */
  allowWrites?: boolean;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
}

export interface McpToolMeta {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

export interface JsonRpcEnvelope<T = any> {
  jsonrpc?: string;
  id?: string | number | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolResult<T = any> {
  /** True iff a JSON-RPC result is present and not flagged isError. */
  ok: boolean;
  outcome: BehaviorOutcome;
  /** JSON-RPC error code, when the call was rejected at the protocol layer. */
  errorCode?: number;
  /** Tool-level isError flag (success envelope that nonetheless reports failure). */
  isError: boolean;
  /** Raw JSON-RPC envelope — not collapsed, so write-contract layers can read preview/token fields. */
  raw: JsonRpcEnvelope<T>;
  httpStatus: number;
  durationMs: number;
}

export interface CallToolOptions {
  /**
   * Force write classification, bypassing the discovered-annotation inference:
   * `true` = treat as write (gated by allowWrites), `false` = assert read-only.
   * When omitted, write status is inferred from the tool's `destructiveHint`
   * (auto-discovering the catalog if needed); unknown/hidden tools are left to
   * server-side authz rather than client-blocked.
   */
  write?: boolean;
  /** Override the behavior-event entity id. Defaults to agentId. */
  entityId?: string;
  /** Override the behavior-event tick. */
  tick?: number;
}

export class McpError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = 'McpError';
  }
}

/** Thrown by the read-only guardrail before any network call is made. */
export class McpWriteBlockedError extends McpError {
  constructor(toolName: string) {
    super(`write tool "${toolName}" blocked: McpTargetConfig.allowWrites is not enabled`);
    this.name = 'McpWriteBlockedError';
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class McpExecutor {
  private readonly cfg: Required<Pick<McpTargetConfig, 'endpoint' | 'dbPath' | 'simulationId' | 'agentId' | 'timeoutMs'>> &
    McpTargetConfig;
  private readonly preferredVersions: string[];

  private rpcId = 1;
  private _tick = 0;
  private bearer?: string;
  private sessionId?: string;
  private _protocolVersion?: string;
  private _capabilities?: Record<string, unknown>;
  private catalog = new Map<string, McpToolMeta>();

  constructor(config: McpTargetConfig) {
    this.cfg = {
      ...config,
      endpoint: config.endpoint,
      dbPath: config.dbPath,
      simulationId: config.simulationId,
      agentId: config.agentId,
      timeoutMs: config.timeoutMs ?? 30_000,
    };
    this.preferredVersions = config.protocolVersions ?? ['2025-03-26'];
  }

  get negotiatedProtocolVersion(): string | undefined { return this._protocolVersion; }
  get capabilities(): Record<string, unknown> | undefined { return this._capabilities; }
  get currentSessionId(): string | undefined { return this.sessionId; }

  setTick(tick: number): void { this._tick = tick; }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /**
   * Run the initialize handshake. Negotiates by trying each configured protocol
   * version in order (preferred first) until the server accepts one, so a
   * single unsupported preferred version doesn't fail a target that supports a
   * later configured one.
   */
  async initialize(): Promise<void> {
    if (!this.bearer) {
      this.bearer = this.cfg.tokenProvider ? await this.cfg.tokenProvider() : this.cfg.token;
    }
    let lastError: { code?: number; message: string } | undefined;
    for (const version of this.preferredVersions) {
      const { envelope, sessionIdHeader, httpStatus } = await this.send('initialize', {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: 'stf-mcp-executor', version: '1.0.0' },
      });
      if (!envelope.error && httpStatus === 200) {
        this.sessionId = sessionIdHeader ?? this.sessionId;
        this._protocolVersion = (envelope.result?.protocolVersion as string) ?? version;
        this._capabilities = (envelope.result?.capabilities as Record<string, unknown>) ?? {};
        await this.send('notifications/initialized', {}, { notification: true }).catch(() => undefined);
        return;
      }
      lastError = envelope.error ?? { message: `HTTP ${httpStatus}` };
    }
    throw new McpError(`initialize failed: ${lastError?.message ?? 'unknown'}`, lastError?.code);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.sessionId) await this.initialize();
  }

  /**
   * Send a session-scoped request, recovering from a stale session: an HTTP 404
   * means the session expired, so reinitialize once and retry. Shared by both
   * listTools() and callTool() so discovery and calls are equally resilient.
   */
  private async sessionRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ envelope: JsonRpcEnvelope; httpStatus: number; durationMs: number }> {
    await this.ensureInitialized();
    let r = await this.send(method, params);
    if (r.httpStatus === 404) {
      this.sessionId = undefined;
      await this.initialize();
      r = await this.send(method, params);
    }
    return { envelope: r.envelope, httpStatus: r.httpStatus, durationMs: r.durationMs };
  }

  /**
   * Resolve whether a tool is a write before any network call. Honors an
   * explicit opts.write; otherwise infers from the discovered `destructiveHint`,
   * auto-discovering the catalog once when writes are disabled so a *visible*
   * destructive tool can't slip through before discovery (the key safety case).
   *
   * Unknown/hidden tools are NOT client-blocked: a tool hidden from the session
   * can't actually mutate (the server rejects it), and adversarial probes must
   * be able to attempt tools they shouldn't have access to. So the guard blocks
   * only tools *known* to be destructive; hidden/unknown tools fall through to
   * server-side authz enforcement.
   */
  private async resolveIsWrite(name: string, opts: CallToolOptions): Promise<boolean> {
    if (opts.write !== undefined) return opts.write;
    if (this.catalog.has(name)) return this.catalog.get(name)!.annotations?.destructiveHint ?? false;
    if (this.cfg.allowWrites) return false; // writes permitted → no need to gate-discover
    try {
      await this.listTools();
    } catch {
      return false; // discovery failed → let the call proceed; server still enforces authz
    }
    const meta = this.catalog.get(name);
    return meta ? meta.annotations?.destructiveHint ?? false : false; // hidden/unknown → server-enforced
  }

  // ── discovery ──────────────────────────────────────────────────────────────

  /** Paginated tools/list — follows nextCursor to completion so coverage can't false-green. */
  async listTools(): Promise<McpToolMeta[]> {
    const out: McpToolMeta[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 1000; guard++) {
      const { envelope } = await this.sessionRequest('tools/list', cursor ? { cursor } : {});
      if (envelope.error) throw new McpError(`tools/list failed: ${envelope.error.message}`, envelope.error.code);
      const page = (envelope.result?.tools as McpToolMeta[]) ?? [];
      out.push(...page);
      cursor = envelope.result?.nextCursor as string | undefined;
      if (!cursor) break;
    }
    this.catalog = new Map(out.map((t) => [t.name, t]));
    return out;
  }

  // ── tool calls ─────────────────────────────────────────────────────────────

  /**
   * Call a tool. Never throws on a JSON-RPC/network error — returns a classified
   * McpToolResult so lanes and probes can inspect the outcome. Throws only the
   * read-only guardrail (McpWriteBlockedError) before any network call.
   */
  async callTool<T = any>(name: string, args: Record<string, unknown> = {}, opts: CallToolOptions = {}): Promise<McpToolResult<T>> {
    // Read-only guardrail runs pre-network and fails closed for unknown writes.
    const isWrite = await this.resolveIsWrite(name, opts);
    if (isWrite && !this.cfg.allowWrites) throw new McpWriteBlockedError(name);

    const { envelope, httpStatus, durationMs } = await this.sessionRequest('tools/call', { name, arguments: args });

    const isError = envelope.result?.isError === true;
    const outcome = classifyMcpOutcome(envelope);
    const ok = !envelope.error && !isError && httpStatus < 400;
    const detail = envelope.error
      ? `mcp_error_${envelope.error.code}: ${envelope.error.message}`
      : isError
        ? 'mcp_result_isError'
        : null;

    this.record(`tools/call ${name}`, opts.entityId ?? this.cfg.agentId, opts.tick ?? this._tick, ok ? 'completed' : 'failed', outcome, detail, name);

    return { ok, outcome, errorCode: envelope.error?.code, isError, raw: envelope, httpStatus, durationMs };
  }

  /**
   * Generic two-phase write: preview → extract opaque confirmation token → commit.
   * Product-specific token binding/idempotency lives downstream — this only
   * passes the token through. Requires allowWrites.
   */
  async previewThenCommit<T = any>(
    name: string,
    args: Record<string, unknown>,
    opts: { idempotencyKey?: string } = {},
  ): Promise<{ preview: McpToolResult; commit: McpToolResult<T> }> {
    const preview = await this.callTool(name, { ...args, mode: 'preview' }, { write: true });
    const token =
      (preview.raw.result?.structuredContent?.confirmationToken as string | undefined) ??
      (preview.raw.result?.confirmationToken as string | undefined);
    // Fail fast: never send commit if preview failed or returned no token —
    // a commit with an undefined token would create a spurious second event.
    if (!preview.ok || !token) {
      const commit: McpToolResult<T> = {
        ok: false,
        outcome: BEHAVIOR_OUTCOMES.SKIPPED,
        isError: false,
        raw: {},
        httpStatus: 0,
        durationMs: 0,
      };
      return { preview, commit };
    }
    const commit = await this.callTool<T>(
      name,
      { ...args, mode: 'commit', confirmationToken: token, idempotencyKey: opts.idempotencyKey },
      { write: true },
    );
    return { preview, commit };
  }

  /** Flush buffered behavior events to disk. */
  flush(): void {
    try {
      BehaviorEventRecorder.getInstance(this.cfg.dbPath, 'simulation').flush();
    } catch {
      /* recorder may be uninitialized in stub scenarios — non-fatal */
    }
  }

  // ── transport ──────────────────────────────────────────────────────────────

  private async send(
    method: string,
    params: Record<string, unknown>,
    opts: { notification?: boolean } = {},
  ): Promise<{ envelope: JsonRpcEnvelope; sessionIdHeader?: string; httpStatus: number; durationMs: number }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.cfg.headers,
    };
    if (this.bearer) headers['Authorization'] = `Bearer ${this.bearer}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (this._protocolVersion) headers['MCP-Protocol-Version'] = this._protocolVersion;

    const payload: Record<string, unknown> = { jsonrpc: '2.0', method, params };
    if (!opts.notification) payload.id = this.rpcId++;

    const start = Date.now();
    try {
      const res = await fetch(this.cfg.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      const sessionIdHeader = res.headers.get('mcp-session-id') ?? undefined;
      const envelope = await parseBody(res);
      return { envelope, sessionIdHeader, httpStatus: res.status, durationMs: Date.now() - start };
    } catch (err) {
      // Network / timeout → synthesize an envelope so callers still get an outcome.
      const aborted = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
      return {
        envelope: { error: { code: aborted ? -32000 : -32000, message: aborted ? 'request timed out' : `transport error: ${(err as Error)?.message}` } },
        httpStatus: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  private record(
    action: string,
    entityId: string,
    tick: number,
    execution_state: 'completed' | 'failed',
    outcome: BehaviorOutcome,
    outcome_detail: string | null,
    toolName: string,
  ): void {
    try {
      BehaviorEventRecorder.getInstance(this.cfg.dbPath, 'simulation').record({
        execution_id: randomUUID(), // fresh per call → each call lands as its own event
        simulation_id: this.cfg.simulationId,
        agent_id: this.cfg.agentId,
        entity_id: entityId,
        persona_definition_id: null,
        tick,
        sim_time: new Date().toISOString(),
        action,
        reasoning: null,
        event_source: 'agent',
        event_kind: 'action',
        execution_state,
        outcome,
        outcome_detail,
        screen_path: toolToScreen(toolName),
        entity_refs: JSON.stringify({ surface: 'mcp', toolName }),
      });
    } catch {
      /* recording must never break the call flow */
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an MCP response body as either plain JSON or a request-scoped SSE stream. */
async function parseBody(res: Response): Promise<JsonRpcEnvelope> {
  if (res.status === 202) return {}; // accepted notification, no body
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (!text) return {};
  if (ct.includes('text/event-stream') || text.startsWith('event:') || text.startsWith('data:')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    return dataLine ? JSON.parse(dataLine.slice(dataLine.indexOf(':') + 1).trim()) : {};
  }
  return JSON.parse(text);
}

/** Stable screen_path for an MCP tool name: `redy.consumer.products.list` → `mcp_consumer_products_list`. */
export function toolToScreen(toolName: string): string {
  const parts = toolName.split('.');
  const trimmed = parts.length > 1 ? parts.slice(1) : parts; // drop vendor prefix
  return `mcp_${trimmed.join('_')}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}

// Re-export for convenience so adapters can assert outcomes without a second import.
export { BEHAVIOR_OUTCOMES };
