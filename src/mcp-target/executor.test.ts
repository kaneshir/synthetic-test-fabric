import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import BetterSqlite3 from 'better-sqlite3';

import { startFixture, FixtureHandle } from './fixture-server';
import { McpExecutor, McpWriteBlockedError, McpTargetConfig } from './executor';
import { applyLisaDbMigrations } from '../schema';
import { BehaviorEventRecorder } from '../recorder';
import { BEHAVIOR_OUTCOMES } from '../outcomes';

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-'));
  const dbPath = path.join(dir, 'lisa.db');
  const db = new BetterSqlite3(dbPath);
  applyLisaDbMigrations(db);
  db.close();
  return dbPath;
}

function readEvents(dbPath: string): Array<{ execution_id: string; outcome: string; outcome_detail: string | null; action: string; entity_refs: string | null }> {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const rows = db.prepare('SELECT execution_id, outcome, outcome_detail, action, entity_refs FROM behavior_events ORDER BY recorded_at').all() as any[];
  db.close();
  return rows;
}

describe('McpExecutor (#43)', () => {
  let fx: FixtureHandle;
  let dbPath: string;

  const exec = (token: string, extra: Partial<McpTargetConfig> = {}): McpExecutor =>
    new McpExecutor({ endpoint: fx.url, dbPath, simulationId: 'sim-1', agentId: 'mcp-agent-1', token, ...extra });

  beforeEach(async () => {
    fx = await startFixture();
    dbPath = tempDbPath();
  });
  afterEach(async () => {
    BehaviorEventRecorder.reset();
    await fx.close();
  });

  // ── lifecycle ──────────────────────────────────────────────────────────────
  it('initialize negotiates the protocol version and captures session + capabilities', async () => {
    const e = exec('valid-readonly');
    await e.initialize();
    expect(e.currentSessionId).toBeTruthy();
    expect(e.negotiatedProtocolVersion).toBe('2025-03-26');
    expect(e.capabilities).toBeDefined();
  });

  // ── discovery (pagination) ─────────────────────────────────────────────────
  it('listTools follows nextCursor and returns the full visible catalog', async () => {
    const small = await startFixture({ pageSize: 1, tokens: { all: { scopes: ['read', 'read:restricted', 'write'], aal: 'aal2', audience: 'mcp' } } });
    const e = new McpExecutor({ endpoint: small.url, dbPath, simulationId: 'sim-1', agentId: 'a', token: 'all' });
    try {
      const tools = await e.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['fixture.read.item', 'fixture.read.restricted', 'fixture.write.create', 'fixture.broken']));
      expect(new Set(names).size).toBe(names.length);
    } finally {
      await small.close();
    }
  });

  // ── reads + SSE parse ───────────────────────────────────────────────────────
  it('callTool read succeeds and parses the SSE response form', async () => {
    const e = exec('valid-readonly');
    const r = await e.callTool('fixture.read.item', { id: 'x' });
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe(BEHAVIOR_OUTCOMES.SUCCESS);
    expect(r.raw.result.structuredContent.tool).toBe('fixture.read.item'); // proves the SSE body was parsed
  });

  // ── outcome classification on the JSON-RPC layer (over HTTP 200) ────────────
  it('scope-gated rejection → ok:false, outcome error_403, errorCode -32003 (HTTP 200)', async () => {
    const e = exec('valid-readonly');
    const r = await e.callTool('fixture.read.restricted', {});
    expect(r.httpStatus).toBe(200); // rejection rode over 200
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe(-32003);
    expect(r.outcome).toBe(BEHAVIOR_OUTCOMES.ERROR_403);
  });

  it('unknown tool → error_404; broken tool (-32000) → error_500', async () => {
    const e = exec('valid-readonly');
    const unknown = await e.callTool('nope.nope', {});
    expect(unknown.outcome).toBe(BEHAVIOR_OUTCOMES.ERROR_404);
    const broken = await e.callTool('fixture.broken', {});
    expect(broken.outcome).toBe(BEHAVIOR_OUTCOMES.ERROR_500);
  });

  // ── read-only-by-default guardrail ──────────────────────────────────────────
  it('write tool throws McpWriteBlockedError when allowWrites is off (no network call)', async () => {
    const e = exec('valid-aal2'); // allowWrites defaults false
    await expect(e.callTool('fixture.write.create', { mode: 'preview', name: 'x' }, { write: true })).rejects.toBeInstanceOf(McpWriteBlockedError);
    // and inferred from discovered annotations (destructiveHint) after listTools
    await e.listTools();
    await expect(e.callTool('fixture.write.create', { mode: 'preview', name: 'x' })).rejects.toBeInstanceOf(McpWriteBlockedError);
    // nothing was recorded
    e.flush();
    expect(readEvents(dbPath).length).toBe(0);
  });

  // ── two-phase write ─────────────────────────────────────────────────────────
  it('previewThenCommit performs exactly one mutation', async () => {
    const e = exec('valid-aal2', { allowWrites: true });
    const { commit } = await e.previewThenCommit('fixture.write.create', { name: 'widget' }, { idempotencyKey: 'k1' });
    expect(commit.ok).toBe(true);
    expect(commit.raw.result.structuredContent.status).toBe('committed');
    expect(fx.mutationCount()).toBe(1);
  });

  // ── stale session → reinitialize-and-retry ──────────────────────────────────
  it('recovers from a stale session (404) by reinitializing and retrying once', async () => {
    const e = exec('valid-readonly');
    await e.initialize();
    const firstSession = e.currentSessionId;
    fx.expireAllSessions();
    const r = await e.callTool('fixture.read.item', { id: 'x' });
    expect(r.ok).toBe(true); // retry after reinit succeeded
    expect(e.currentSessionId).not.toBe(firstSession);
  });

  // ── behavior-event recording ────────────────────────────────────────────────
  it('records one behavior event per call with distinct execution_ids (two-call regression)', async () => {
    const e = exec('valid-readonly');
    await e.callTool('fixture.read.item', { id: 'a' });
    await e.callTool('fixture.read.item', { id: 'b' });
    e.flush();
    const events = readEvents(dbPath);
    expect(events.length).toBe(2);
    expect(new Set(events.map((ev) => ev.execution_id)).size).toBe(2);
    expect(events.every((ev) => JSON.parse(ev.entity_refs!).surface === 'mcp')).toBe(true);
  });

  it('records nothing (and never crashes) in assessment-only mode (empty dbPath)', async () => {
    const e = new McpExecutor({ endpoint: fx.url, dbPath: '', simulationId: 'sim-1', agentId: 'a', token: 'valid-readonly' });
    const r = await e.callTool('fixture.read.item', { id: 'x' });
    expect(r.ok).toBe(true);
    e.flush(); // no-op, no throw
  });

  it('preserves the raw mcp_error_<code> in the event detail', async () => {
    const e = exec('valid-readonly');
    await e.callTool('fixture.read.restricted', {}); // -32003
    e.flush();
    const events = readEvents(dbPath);
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe(BEHAVIOR_OUTCOMES.ERROR_403);
    expect(events[0].outcome_detail).toMatch(/^mcp_error_-32003:/);
  });

  // ── read-only guard: fail closed BEFORE discovery (review P1) ───────────────
  it('blocks a write tool called before discovery (visible: via destructiveHint)', async () => {
    const e = exec('valid-aal2'); // can see the write tool, but allowWrites is off
    await expect(e.callTool('fixture.write.create', { mode: 'preview', name: 'x' })).rejects.toBeInstanceOf(McpWriteBlockedError);
    e.flush();
    expect(readEvents(dbPath).length).toBe(0);
  });

  it('does not client-block a tool hidden from the session — server authz rejects it instead (no mutation)', async () => {
    // A write tool the token can't even see is not client-blocked (probes must be
    // able to attempt it); the server rejects it and nothing mutates.
    const e = exec('valid-readonly');
    const r = await e.callTool('fixture.write.create', { mode: 'preview', name: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe(-32003); // server scope/authz rejection
    expect(fx.mutationCount()).toBe(0);
  });

  it('allows a read tool called before discovery (auto-resolves as read)', async () => {
    const e = exec('valid-readonly'); // allowWrites off, no prior listTools
    const r = await e.callTool('fixture.read.item', { id: 'x' });
    expect(r.ok).toBe(true);
  });

  // ── stale-session recovery in listTools (review P2) ─────────────────────────
  it('listTools recovers from a stale session by reinitializing', async () => {
    const e = exec('valid-readonly');
    await e.initialize();
    fx.expireAllSessions();
    const tools = await e.listTools(); // would throw without the shared reinit path
    expect(tools.length).toBeGreaterThan(0);
  });

  // ── protocol-version negotiation/fallback (review P2) ───────────────────────
  it('negotiates a later configured protocol version when the preferred is unsupported', async () => {
    const e = exec('valid-readonly', { protocolVersions: ['2099-01-01', '2025-03-26'] });
    await e.initialize();
    expect(e.negotiatedProtocolVersion).toBe('2025-03-26');
  });

  // ── previewThenCommit short-circuits on failed preview (review P2) ───────────
  it('does not send commit when preview fails', async () => {
    const f = await startFixture({ tokens: { wnormal: { scopes: ['write'], aal: 'normal', audience: 'mcp' } } });
    try {
      const e = new McpExecutor({ endpoint: f.url, dbPath, simulationId: 'sim-1', agentId: 'a', token: 'wnormal', allowWrites: true });
      const { preview, commit } = await e.previewThenCommit('fixture.write.create', { name: 'widget' }, { idempotencyKey: 'k1' });
      expect(preview.ok).toBe(false); // AAL2 step-up → preview rejected
      expect(commit.outcome).toBe(BEHAVIOR_OUTCOMES.SKIPPED);
      expect(f.mutationCount()).toBe(0);
      e.flush();
      expect(readEvents(dbPath).length).toBe(1); // only the preview event, no commit
    } finally {
      await f.close();
    }
  });
});
