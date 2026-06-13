import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import BetterSqlite3 from 'better-sqlite3';

import { startFixture, FixtureHandle } from './fixture-server';
import { McpExecutor } from './executor';
import { snapshotCatalog, diffCatalog, runMcpCoverage } from './discovery';
import { applyLisaDbMigrations } from '../schema';
import { BehaviorEventRecorder } from '../recorder';

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-disc-'));
  const dbPath = path.join(dir, 'lisa.db');
  const db = new BetterSqlite3(dbPath);
  applyLisaDbMigrations(db);
  db.close();
  return dbPath;
}

describe('catalog pinning (#44)', () => {
  it('detects added / removed / version drift', () => {
    const pinned = snapshotCatalog([{ name: 'a', inputSchema: { type: 'object' } }, { name: 'b', inputSchema: { x: 1 } }], 'v1');
    const current = snapshotCatalog([{ name: 'a', inputSchema: { type: 'object' } }, { name: 'c', inputSchema: {} }], 'v2');
    const d = diffCatalog(pinned, current);
    expect(d.added).toEqual(['c']);
    expect(d.removed).toEqual(['b']);
    expect(d.versionChanged).toBe(true);
    expect(d.drifted).toBe(true);
  });

  it('flags a changed input schema under the same tool name', () => {
    const pinned = snapshotCatalog([{ name: 'a', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } }]);
    const current = snapshotCatalog([{ name: 'a', inputSchema: { type: 'object', properties: { x: { type: 'number' } } } }]);
    expect(diffCatalog(pinned, current).changed).toEqual(['a']);
  });

  it('reports no drift for identical catalogs', () => {
    const t = [{ name: 'a', inputSchema: { type: 'object' } }];
    expect(diffCatalog(snapshotCatalog(t, 'v1'), snapshotCatalog(t, 'v1')).drifted).toBe(false);
  });
});

describe('runMcpCoverage (#44)', () => {
  let fx: FixtureHandle;
  let dbPath: string;
  beforeEach(async () => {
    fx = await startFixture();
    dbPath = tempDbPath();
  });
  afterEach(async () => {
    BehaviorEventRecorder.reset();
    await fx.close();
  });

  it('covers reads, skips writes by policy, reports uncovered + invalid rejection', async () => {
    const e = new McpExecutor({ endpoint: fx.url, dbPath, simulationId: 's', agentId: 'a', token: 'valid-aal2' });
    const logs: string[] = [];
    const cov = await runMcpCoverage(e, { log: (m) => logs.push(m) });

    expect(cov.toolsTotal).toBe(4);
    expect(cov.skippedByPolicy).toEqual(['fixture.write.create']);
    expect(cov.covered).toEqual(expect.arrayContaining(['fixture.read.item', 'fixture.read.restricted']));
    expect(cov.uncovered.map((u) => u.name)).toContain('fixture.broken');
    expect(cov.invalidRejected).toContain('fixture.read.item'); // mistyped id rejected -32602
    expect(cov.coverageRatio).toBeCloseTo(2 / 3, 5); // 2 covered of 3 in-policy
    expect(cov.protocolVersion).toBe('2025-03-26');
    // skips/unsupported are logged, never silent
    expect(logs.some((l) => l.includes('fixture.write.create'))).toBe(true);

    e.flush();
  });

  it('a read-only token under-covers honestly (scope-gated tool not visible)', async () => {
    const e = new McpExecutor({ endpoint: fx.url, dbPath, simulationId: 's', agentId: 'a', token: 'valid-readonly' });
    const cov = await runMcpCoverage(e);
    // valid-readonly sees only read-scoped non-AAL2 tools: read.item + broken
    expect(cov.toolsTotal).toBe(2);
    expect(cov.covered).toEqual(['fixture.read.item']);
    expect(cov.uncovered.map((u) => u.name)).toEqual(['fixture.broken']);
    expect(cov.skippedByPolicy).toEqual([]);
    e.flush();
  });
});
