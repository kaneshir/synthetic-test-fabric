import { startFixture, FixtureHandle, JSON_RPC, DEFAULT_PROTOCOL_VERSION } from './fixture-server';

interface RpcOpts {
  method: string;
  params?: Record<string, unknown>;
  token?: string;
  sessionId?: string;
  accept?: string;
  id?: number;
}

interface RpcResult {
  status: number;
  sessionId?: string;
  protocolVersion?: string;
  body: { jsonrpc?: string; id?: unknown; result?: any; error?: { code: number; message: string; data?: any } };
}

async function rpc(url: string, opts: RpcOpts): Promise<RpcResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token !== undefined) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.sessionId) headers['Mcp-Session-Id'] = opts.sessionId;
  if (opts.accept) headers['Accept'] = opts.accept;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: opts.id ?? 1, method: opts.method, params: opts.params ?? {} }),
  });

  const text = await res.text();
  let body: RpcResult['body'] = {};
  if (text) {
    if (text.startsWith('event:')) {
      // SSE: extract the single data line
      const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
      body = dataLine ? JSON.parse(dataLine.slice(6)) : {};
    } else {
      body = JSON.parse(text);
    }
  }
  return {
    status: res.status,
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
    protocolVersion: res.headers.get('mcp-protocol-version') ?? undefined,
    body,
  };
}

/** initialize with the given token and return the session id. */
async function init(url: string, token: string, protocolVersion?: string): Promise<RpcResult> {
  return rpc(url, { method: 'initialize', token, params: { protocolVersion: protocolVersion ?? DEFAULT_PROTOCOL_VERSION } });
}

describe('MCP fixture server (#45)', () => {
  let fx: FixtureHandle;
  beforeEach(async () => {
    fx = await startFixture();
  });
  afterEach(async () => {
    await fx.close();
  });

  // ── lifecycle / negotiation ──────────────────────────────────────────────
  it('initialize issues a session id + echoes the negotiated protocol version', async () => {
    const r = await init(fx.url, 'valid-readonly');
    expect(r.status).toBe(200);
    expect(r.sessionId).toBeTruthy();
    expect(r.protocolVersion).toBe(DEFAULT_PROTOCOL_VERSION);
    expect(r.body.result.protocolVersion).toBe(DEFAULT_PROTOCOL_VERSION);
  });

  it('rejects an unsupported protocol version with -32602', async () => {
    const r = await init(fx.url, 'valid-readonly', '2099-01-01');
    expect(r.body.error?.code).toBe(JSON_RPC.INVALID_PARAMS);
    expect(r.sessionId).toBeUndefined();
  });

  // ── auth / audience / expiry (JSON-RPC error over HTTP 200) ──────────────
  it('missing/unknown token → -32001 over HTTP 200', async () => {
    const r = await rpc(fx.url, { method: 'initialize' }); // no token
    expect(r.status).toBe(200);
    expect(r.body.error?.code).toBe(JSON_RPC.UNAUTHORIZED);
  });

  it('wrong audience → -32001 with audience-denied reason', async () => {
    const r = await init(fx.url, 'wrong-aud');
    expect(r.body.error?.code).toBe(JSON_RPC.UNAUTHORIZED);
    expect(r.body.error?.data?.reason).toBe('mcp_audience_denied');
  });

  it('expired token → -32001', async () => {
    const r = await init(fx.url, 'expired');
    expect(r.body.error?.code).toBe(JSON_RPC.UNAUTHORIZED);
  });

  // ── session lifecycle ────────────────────────────────────────────────────
  it('stale/unknown session → HTTP 404 (client should reinitialize)', async () => {
    const r = await rpc(fx.url, { method: 'tools/list', token: 'valid-readonly', sessionId: 'does-not-exist' });
    expect(r.status).toBe(404);
    expect(r.body.error?.data?.reason).toBe('mcp_session_expired');
  });

  it('expireAllSessions forces a live session to 404, then reinitialize works', async () => {
    const s = await init(fx.url, 'valid-readonly');
    fx.expireAllSessions();
    const stale = await rpc(fx.url, { method: 'tools/list', token: 'valid-readonly', sessionId: s.sessionId });
    expect(stale.status).toBe(404);
    const fresh = await init(fx.url, 'valid-readonly');
    expect(fresh.sessionId).toBeTruthy();
  });

  // ── tools/list: scope + AAL filtering ────────────────────────────────────
  it('read-only session sees only read-scoped, non-AAL2 tools', async () => {
    const s = await init(fx.url, 'valid-readonly');
    const r = await rpc(fx.url, { method: 'tools/list', token: 'valid-readonly', sessionId: s.sessionId });
    const names = r.body.result.tools.map((t: any) => t.name);
    expect(names).toContain('fixture.read.item');
    expect(names).not.toContain('fixture.read.restricted'); // scope-gated
    expect(names).not.toContain('fixture.write.create'); // aal2 + write scope
  });

  it('aal2 all-scope session sees the full catalog', async () => {
    const s = await init(fx.url, 'valid-aal2');
    const r = await rpc(fx.url, { method: 'tools/list', token: 'valid-aal2', sessionId: s.sessionId });
    const names = r.body.result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(['fixture.read.item', 'fixture.read.restricted', 'fixture.write.create']));
  });

  // ── tools/list: pagination ───────────────────────────────────────────────
  it('paginates tools/list via nextCursor and surfaces every tool', async () => {
    const small = await startFixture({ pageSize: 1, tokens: { all: { scopes: ['read', 'read:restricted', 'write'], aal: 'aal2', audience: 'mcp' } } });
    try {
      const s = await init(small.url, 'all');
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const r = await rpc(small.url, { method: 'tools/list', token: 'all', sessionId: s.sessionId, params: cursor ? { cursor } : {} });
        seen.push(...r.body.result.tools.map((t: any) => t.name));
        cursor = r.body.result.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(expect.arrayContaining(['fixture.read.item', 'fixture.read.restricted', 'fixture.write.create', 'fixture.broken']));
      expect(new Set(seen).size).toBe(seen.length); // no dupes across pages
    } finally {
      await small.close();
    }
  });

  // ── tools/call: authz enforcement on direct calls ────────────────────────
  it('scope-gated tool called without scope → -32003', async () => {
    const s = await init(fx.url, 'valid-readonly');
    const r = await rpc(fx.url, { method: 'tools/call', token: 'valid-readonly', sessionId: s.sessionId, params: { name: 'fixture.read.restricted', arguments: {} } });
    expect(r.body.error?.code).toBe(JSON_RPC.FORBIDDEN);
  });

  it('AAL2 write called by a normal-AAL session → -32003 step-up', async () => {
    // give the token write scope but only normal aal
    const f = await startFixture({ tokens: { w: { scopes: ['write'], aal: 'normal', audience: 'mcp' } } });
    try {
      const s = await init(f.url, 'w');
      const r = await rpc(f.url, { method: 'tools/call', token: 'w', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'preview', name: 'x' } } });
      expect(r.body.error?.code).toBe(JSON_RPC.FORBIDDEN);
      expect(r.body.error?.data?.reason).toBe('aal2_required');
    } finally {
      await f.close();
    }
  });

  it('unknown tool → -32004', async () => {
    const s = await init(fx.url, 'valid-aal2');
    const r = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'nope.nope', arguments: {} } });
    expect(r.body.error?.code).toBe(JSON_RPC.NOT_FOUND);
  });

  it('schema-invalid args → -32602', async () => {
    const s = await init(fx.url, 'valid-aal2');
    const r = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'preview' /* missing required name */ } } });
    expect(r.body.error?.code).toBe(JSON_RPC.INVALID_PARAMS);
  });

  it('broken tool → -32000 (drives inconclusive probes)', async () => {
    const s = await init(fx.url, 'valid-readonly');
    const r = await rpc(fx.url, { method: 'tools/call', token: 'valid-readonly', sessionId: s.sessionId, params: { name: 'fixture.broken', arguments: {} } });
    expect(r.body.error?.code).toBe(JSON_RPC.INTERNAL_ERROR);
  });

  // ── SSE response form ────────────────────────────────────────────────────
  it('serves a request-scoped SSE response when Accept includes text/event-stream', async () => {
    const s = await init(fx.url, 'valid-readonly');
    const r = await rpc(fx.url, {
      method: 'tools/call',
      token: 'valid-readonly',
      sessionId: s.sessionId,
      accept: 'application/json, text/event-stream',
      params: { name: 'fixture.read.item', arguments: { id: 'a' } },
    });
    expect(r.status).toBe(200);
    expect(r.body.result.isError).toBe(false);
    expect(r.body.result.structuredContent.tool).toBe('fixture.read.item');
  });

  // ── two-phase write + idempotency ────────────────────────────────────────
  it('preview→commit creates exactly one mutation', async () => {
    const s = await init(fx.url, 'valid-aal2');
    const preview = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'preview', name: 'widget' } } });
    const confirmationToken = preview.body.result.structuredContent.confirmationToken;
    expect(confirmationToken).toBeTruthy();

    const commit = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'commit', name: 'widget', idempotencyKey: 'k1', confirmationToken } } });
    expect(commit.body.result.structuredContent.status).toBe('committed');
    expect(fx.mutationCount()).toBe(1);
  });

  it('idempotent replay (same key + same payload) returns the stored result with NO second mutation', async () => {
    const s = await init(fx.url, 'valid-aal2');
    const preview = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'preview', name: 'widget' } } });
    const confirmationToken = preview.body.result.structuredContent.confirmationToken;
    const args = { mode: 'commit', name: 'widget', idempotencyKey: 'k1', confirmationToken };
    const first = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: args } });
    const replay = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: args } });
    expect(replay.body.result.structuredContent.id).toBe(first.body.result.structuredContent.id);
    expect(fx.mutationCount()).toBe(1); // replay did NOT mutate again
  });

  it('same idempotency key + different payload → -32602', async () => {
    const s = await init(fx.url, 'valid-aal2');
    const p1 = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'preview', name: 'widget' } } });
    await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'commit', name: 'widget', idempotencyKey: 'k2', confirmationToken: p1.body.result.structuredContent.confirmationToken } } });
    const p2 = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'preview', name: 'DIFFERENT' } } });
    const conflict = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'commit', name: 'DIFFERENT', idempotencyKey: 'k2', confirmationToken: p2.body.result.structuredContent.confirmationToken } } });
    expect(conflict.body.error?.code).toBe(JSON_RPC.INVALID_PARAMS);
  });

  it('forged/tampered confirmation token → -32003', async () => {
    const s = await init(fx.url, 'valid-aal2');
    const commit = await rpc(fx.url, { method: 'tools/call', token: 'valid-aal2', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'commit', name: 'widget', idempotencyKey: 'k3', confirmationToken: 'forged.deadbeef' } } });
    expect(commit.body.error?.code).toBe(JSON_RPC.FORBIDDEN);
    expect(fx.mutationCount()).toBe(0);
  });

  it('unknown method → -32601', async () => {
    const s = await init(fx.url, 'valid-readonly');
    const r = await rpc(fx.url, { method: 'no/such/method', token: 'valid-readonly', sessionId: s.sessionId });
    expect(r.body.error?.code).toBe(JSON_RPC.METHOD_NOT_FOUND);
  });

  // ── session is bound to its initializing bearer ──────────────────────────
  it('a different bearer presenting an existing session id is rejected (no privilege bleed)', async () => {
    // initialize an AAL2 session, then try to reuse its id with a read-only token
    const s = await init(fx.url, 'valid-aal2');
    const hijack = await rpc(fx.url, { method: 'tools/list', token: 'valid-readonly', sessionId: s.sessionId });
    expect(hijack.body.error?.code).toBe(JSON_RPC.UNAUTHORIZED);
    expect(hijack.body.error?.data?.reason).toBe('mcp_session_principal_mismatch');

    // and it must not have leaked write access either
    const write = await rpc(fx.url, { method: 'tools/call', token: 'valid-readonly', sessionId: s.sessionId, params: { name: 'fixture.write.create', arguments: { mode: 'preview', name: 'x' } } });
    expect(write.body.result).toBeUndefined();
    expect(write.body.error?.code).toBe(JSON_RPC.UNAUTHORIZED);
  });

  // ── transport shape enforcement ──────────────────────────────────────────
  it('rejects a non-POST method with HTTP 405', async () => {
    const res = await fetch(fx.url, { method: 'GET', headers: { Authorization: 'Bearer valid-readonly' } });
    expect(res.status).toBe(405);
  });

  it('rejects a wrong endpoint path with HTTP 404', async () => {
    const res = await fetch(`http://127.0.0.1:${fx.port}/wrong`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-readonly' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(404);
  });
});
