/**
 * MCP target **fixture server** (#45) — a throwaway, in-process Streamable-HTTP
 * MCP server used by STF's own tests so the target-testing executor (#43),
 * discovery (#44), and protocol probe battery (#46) never touch a real backend.
 *
 * It deliberately emulates the *hard parts* of a production MCP contract
 * (verified against Redy `backend-api/src/mcp/`), so a trivial echo server is
 * insufficient. It covers:
 *   - `initialize` → `Mcp-Session-Id` lifecycle + idle expiry (stale → HTTP 404)
 *   - both response forms: plain JSON and request-scoped SSE
 *   - paginated `tools/list` (`nextCursor`)
 *   - scope + AAL tool visibility + enforcement
 *   - two-phase write contract (preview → confirmation token → commit) with
 *     idempotency semantics
 *   - protocol-version negotiation (unsupported → error)
 *   - JSON-RPC error codes carried **over HTTP 200** (the Redy envelope: 401→
 *     -32001, 403→-32003, 404→-32004, 429→-32029, 400→-32602)
 *
 * No network egress, no secrets, no external deps beyond node stdlib + crypto.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// JSON-RPC error codes (mirrors Redy `mcp.service.ts` jsonRpcCodeForStatus)
// ---------------------------------------------------------------------------

export const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602, // ← maps from HTTP 400
  INTERNAL_ERROR: -32000,
  UNAUTHORIZED: -32001, // ← HTTP 401 (auth / audience / session-expired)
  FORBIDDEN: -32003, // ← HTTP 403 (scope / AAL step-up)
  NOT_FOUND: -32004, // ← HTTP 404 (unknown tool)
  RATE_LIMITED: -32029, // ← HTTP 429
} as const;

export const DEFAULT_PROTOCOL_VERSION = '2025-03-26';

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export type Aal = 'normal' | 'aal2';

export interface FixtureTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScopes: string[];
  /** When 'aal2', the tool is hidden from tools/list AND step-up-rejected on direct call unless the session is aal2. */
  assurance?: Aal;
  /** Write tools require the two-phase preview→commit contract. */
  write?: boolean;
  readOnlyHint?: boolean;
  /** When true, the tool always returns an internal error (drives inconclusive-probe tests). */
  broken?: boolean;
}

export interface FixtureToken {
  scopes: string[];
  aal: Aal;
  /** Audience the token is bound to; the server requires it to equal config.audience. */
  audience: string;
  expired?: boolean;
}

export interface FixtureConfig {
  /** Supported protocol versions; initialize negotiates against this set. Default ['2025-03-26']. */
  protocolVersions?: string[];
  /** Required token audience. Default 'mcp'. */
  audience?: string;
  /** Tool catalog. Default: a representative set (read / scope-gated / aal2-write / broken). */
  tools?: FixtureTool[];
  /** Idle session TTL in ms. Default 60_000. */
  sessionIdleMs?: number;
  /** tools/list page size. Default 100 (set small to exercise pagination). */
  pageSize?: number;
  /** Token registry. Default: valid-readonly / valid-aal2 / wrong-aud / expired. */
  tokens?: Record<string, FixtureToken>;
}

export interface FixtureHandle {
  url: string; // full endpoint, e.g. http://127.0.0.1:54321/mcp
  port: number;
  close(): Promise<void>;
  /** Force every live session to expire — drives the stale-session → 404 → reinitialize path deterministically. */
  expireAllSessions(): void;
  /** Number of *effective* write mutations committed (idempotent replays do not increment). */
  mutationCount(): number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TOOLS: FixtureTool[] = [
  {
    name: 'fixture.read.item',
    description: 'Read a demo item (read-only).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    requiredScopes: ['read'],
    readOnlyHint: true,
  },
  {
    name: 'fixture.read.restricted',
    description: 'Read a restricted resource (scope-gated).',
    inputSchema: { type: 'object', properties: {} },
    requiredScopes: ['read:restricted'],
    readOnlyHint: true,
  },
  {
    name: 'fixture.write.create',
    description: 'Create a record (two-phase write, AAL2).',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string' },
        idempotencyKey: { type: 'string' },
        confirmationToken: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['mode', 'name'],
    },
    requiredScopes: ['write'],
    assurance: 'aal2',
    write: true,
  },
  {
    name: 'fixture.broken',
    description: 'Always fails with an internal error (drives inconclusive probes).',
    inputSchema: { type: 'object', properties: {} },
    requiredScopes: ['read'],
    readOnlyHint: true,
    broken: true,
  },
];

export const DEFAULT_TOKENS: Record<string, FixtureToken> = {
  'valid-readonly': { scopes: ['read'], aal: 'normal', audience: 'mcp' },
  'valid-aal2': { scopes: ['read', 'read:restricted', 'write'], aal: 'aal2', audience: 'mcp' },
  'wrong-aud': { scopes: ['read', 'write'], aal: 'aal2', audience: 'api' },
  expired: { scopes: ['read'], aal: 'normal', audience: 'mcp', expired: true },
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  token: FixtureToken;
  protocolVersion: string;
  lastSeen: number;
}

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

const FIXTURE_SECRET = 'stf-fixture-hmac-secret';

function sign(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', FIXTURE_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token: string): Record<string, unknown> | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', FIXTURE_SECRET).update(body).digest('base64url');
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  // Length-guard before timingSafeEqual (it throws on unequal lengths).
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

function payloadHash(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Minimal JSON-Schema-shaped required/type validation — enough to drive schema-invalid probes. */
function validateArgs(schema: Record<string, unknown>, args: Record<string, unknown>): string | null {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) return `missing required field: ${key}`;
  }
  const props = (schema.properties as Record<string, { type?: string }> | undefined) ?? {};
  for (const [key, val] of Object.entries(args)) {
    const spec = props[key];
    if (!spec?.type) continue;
    const actual = typeof val;
    const ok =
      (spec.type === 'string' && actual === 'string') ||
      (spec.type === 'number' && actual === 'number') ||
      (spec.type === 'boolean' && actual === 'boolean') ||
      (spec.type === 'object' && actual === 'object');
    if (!ok) return `field ${key} expected ${spec.type}, got ${actual}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function startFixture(config: FixtureConfig = {}): Promise<FixtureHandle> {
  const protocolVersions = config.protocolVersions ?? [DEFAULT_PROTOCOL_VERSION];
  const audience = config.audience ?? 'mcp';
  const tools = config.tools ?? DEFAULT_TOOLS;
  const sessionIdleMs = config.sessionIdleMs ?? 60_000;
  const pageSize = config.pageSize ?? 100;
  const tokens = config.tokens ?? DEFAULT_TOKENS;

  const sessions = new Map<string, Session>();
  const idempotency = new Map<string, { hash: string; result: unknown }>();
  let mutations = 0;

  const visibleTo = (session: Session, t: FixtureTool): boolean => {
    const hasScopes = t.requiredScopes.every((s) => session.token.scopes.includes(s));
    const hasAal = t.assurance !== 'aal2' || session.token.aal === 'aal2';
    return hasScopes && hasAal;
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        handle();
      } catch (err) {
        // A handler crash must be a deterministic outcome, never a hung socket.
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, 200, errorEnvelope(null, JSON_RPC.INTERNAL_ERROR, `fixture handler error: ${message}`));
      }
    });

    function handle(): void {
      let body: JsonRpcRequest = {};
      const raw = Buffer.concat(chunks).toString();
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return sendJson(res, 200, errorEnvelope(null, JSON_RPC.PARSE_ERROR, 'parse error'));
        }
      }

      const wantsSse = (req.headers['accept'] ?? '').includes('text/event-stream');
      const id: JsonRpcId = body.id ?? null;
      const method = body.method;

      // ── auth (token + audience + expiry) ────────────────────────────────
      const auth = req.headers['authorization'];
      const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
      const token = bearer ? tokens[bearer] : undefined;
      if (!token) {
        return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.UNAUTHORIZED, 'missing or unknown token'));
      }
      if (token.audience !== audience) {
        return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.UNAUTHORIZED, 'token audience denied', { reason: 'mcp_audience_denied' }));
      }
      if (token.expired) {
        return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.UNAUTHORIZED, 'token expired', { reason: 'mcp_token_expired' }));
      }

      // ── basic JSON-RPC envelope check ───────────────────────────────────
      if (body.jsonrpc !== '2.0' || typeof method !== 'string') {
        return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.INVALID_REQUEST, 'invalid JSON-RPC request'));
      }

      // ── initialize (no session required) ────────────────────────────────
      if (method === 'initialize') {
        const requested = (body.params?.protocolVersion as string) ?? DEFAULT_PROTOCOL_VERSION;
        if (!protocolVersions.includes(requested)) {
          return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.INVALID_PARAMS, `unsupported protocol version: ${requested}`, {
            supported: protocolVersions,
          }));
        }
        const sessionId = crypto.randomUUID();
        sessions.set(sessionId, { id: sessionId, token, protocolVersion: requested, lastSeen: Date.now() });
        res.setHeader('Mcp-Session-Id', sessionId);
        res.setHeader('MCP-Protocol-Version', requested);
        return respond(res, wantsSse, 200, resultEnvelope(id, {
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: 'stf-mcp-fixture', version: '0.1.0' },
        }));
      }

      // ── session required for everything else ────────────────────────────
      const sessionHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        // Stale/unknown session → HTTP 404 (spec): client should reinitialize.
        return sendJson(res, 404, errorEnvelope(id, JSON_RPC.UNAUTHORIZED, 'unknown or expired session', { reason: 'mcp_session_expired' }));
      }
      if (Date.now() - session.lastSeen > sessionIdleMs) {
        sessions.delete(session.id);
        return sendJson(res, 404, errorEnvelope(id, JSON_RPC.UNAUTHORIZED, 'session idle-expired', { reason: 'mcp_session_expired' }));
      }
      session.lastSeen = Date.now();

      // ── notifications/initialized (fire-and-forget) ─────────────────────
      if (method === 'notifications/initialized') {
        res.writeHead(202).end();
        return;
      }

      // ── tools/list (paginated, scope+AAL filtered) ──────────────────────
      if (method === 'tools/list') {
        const visible = tools.filter((t) => visibleTo(session, t));
        const cursor = Number(body.params?.cursor ?? 0) || 0;
        const page = visible.slice(cursor, cursor + pageSize);
        const nextCursor = cursor + pageSize < visible.length ? String(cursor + pageSize) : undefined;
        const wire = page.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !!t.readOnlyHint, destructiveHint: !!t.write },
        }));
        return respond(res, wantsSse, 200, resultEnvelope(id, nextCursor ? { tools: wire, nextCursor } : { tools: wire }));
      }

      // ── tools/call ──────────────────────────────────────────────────────
      if (method === 'tools/call') {
        const name = body.params?.name as string | undefined;
        const args = (body.params?.arguments as Record<string, unknown>) ?? {};
        const tool = tools.find((t) => t.name === name);
        if (!tool) {
          return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.NOT_FOUND, `unknown tool: ${name}`));
        }
        // scope gate (direct-call enforcement even though it's also hidden from list)
        if (!tool.requiredScopes.every((s) => session.token.scopes.includes(s))) {
          return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.FORBIDDEN, 'insufficient scope', { requiredScopes: tool.requiredScopes }));
        }
        // AAL step-up gate
        if (tool.assurance === 'aal2' && session.token.aal !== 'aal2') {
          return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.FORBIDDEN, 'AAL2 step-up required', { reason: 'aal2_required' }));
        }
        // schema validation
        const schemaErr = validateArgs(tool.inputSchema, args);
        if (schemaErr) {
          return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.INVALID_PARAMS, schemaErr));
        }
        if (tool.broken) {
          return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.INTERNAL_ERROR, 'tool is intentionally broken'));
        }

        // write contract: preview → commit
        if (tool.write) {
          const mode = args.mode;
          if (mode === 'preview') {
            const confirmationToken = sign({ tool: tool.name, hash: payloadHash(omit(args, ['mode', 'confirmationToken'])) });
            return respond(res, wantsSse, 200, resultEnvelope(id, {
              content: [{ type: 'text', text: `Preview: will create "${args.name}"` }],
              isError: false,
              structuredContent: { confirmationToken, expiresAt: new Date(Date.now() + 900_000).toISOString() },
            }));
          }
          if (mode === 'commit') {
            const provided = args.confirmationToken;
            const decoded = typeof provided === 'string' ? verify(provided) : null;
            const expectedHash = payloadHash(omit(args, ['mode', 'confirmationToken', 'idempotencyKey']));
            if (!decoded || decoded.tool !== tool.name || decoded.hash !== expectedHash) {
              return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.FORBIDDEN, 'invalid or unbound confirmation token'));
            }
            // idempotency
            const key = args.idempotencyKey as string | undefined;
            if (key) {
              const prior = idempotency.get(key);
              if (prior) {
                if (prior.hash !== expectedHash) {
                  return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.INVALID_PARAMS, 'idempotency key reused with different payload'));
                }
                // same key + same payload → replay stored result, NO second mutation
                return respond(res, wantsSse, 200, resultEnvelope(id, prior.result));
              }
            }
            mutations += 1;
            const result = {
              content: [{ type: 'text', text: `Created "${args.name}"` }],
              isError: false,
              structuredContent: { id: crypto.randomUUID(), status: 'committed' },
            };
            if (key) idempotency.set(key, { hash: expectedHash, result });
            return respond(res, wantsSse, 200, resultEnvelope(id, result));
          }
          return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.INVALID_PARAMS, `write tool requires mode preview|commit, got: ${String(mode)}`));
        }

        // read tool
        return respond(res, wantsSse, 200, resultEnvelope(id, {
          content: [{ type: 'text', text: `ok:${tool.name}` }],
          isError: false,
          structuredContent: { tool: tool.name, args },
        }));
      }

      return respond(res, wantsSse, 200, errorEnvelope(id, JSON_RPC.METHOD_NOT_FOUND, `unknown method: ${method}`));
    }
  });

  return new Promise<FixtureHandle>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        port,
        close: () =>
          new Promise<void>((r) => {
            sessions.clear();
            server.close(() => r());
          }),
        expireAllSessions: () => sessions.clear(),
        mutationCount: () => mutations,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// wire helpers
// ---------------------------------------------------------------------------

function resultEnvelope(id: JsonRpcId, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result };
}

function errorEnvelope(id: JsonRpcId, code: number, message: string, data?: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

function omit(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k)) out[k] = v;
  return out;
}

function respond(res: http.ServerResponse, sse: boolean, status: number, envelope: Record<string, unknown>): void {
  if (sse) return sendSse(res, status, envelope);
  return sendJson(res, status, envelope);
}

function sendJson(res: http.ServerResponse, status: number, envelope: Record<string, unknown>): void {
  const text = JSON.stringify(envelope);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(text);
}

function sendSse(res: http.ServerResponse, status: number, envelope: Record<string, unknown>): void {
  res.writeHead(status, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`);
  res.end();
}
