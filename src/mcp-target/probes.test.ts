import * as http from 'http';
import { AddressInfo } from 'net';

import { startFixture, FixtureHandle } from './fixture-server';
import { runProtocolProbes, classifyVerdict } from './probes';

describe('classifyVerdict — gate semantics', () => {
  it('secure when the probe’s expected signal matched', () => {
    expect(classifyVerdict(true, true)).toBe('secure');
    expect(classifyVerdict(true, false)).toBe('secure');
  });
  it('violation when not secure and the request was NOT rejected (succeeded where rejection expected)', () => {
    expect(classifyVerdict(false, false)).toBe('violation');
  });
  it('inconclusive when rejected but not in the expected way (crash/typo must not pass as secure)', () => {
    expect(classifyVerdict(false, true)).toBe('inconclusive');
  });
});

describe('runProtocolProbes — compliant fixture', () => {
  let fx: FixtureHandle;
  beforeEach(async () => {
    fx = await startFixture();
  });
  afterEach(async () => {
    await fx.close();
  });

  it('every generic probe holds; battery passes', async () => {
    const res = await runProtocolProbes({ endpoint: fx.url, dbPath: '', simulationId: 's', agentId: 'a', token: 'valid-aal2' });
    const byName = Object.fromEntries(res.results.map((r) => [r.name, r.verdict]));

    expect(res.results.length).toBe(8);
    expect(res.violations).toBe(0);
    expect(res.inconclusive).toBe(0);
    expect(res.passed).toBe(true);
    // the key anti-regression: a stale-session 404 is SECURE for this probe, not "inconclusive"
    expect(byName['stale-session']).toBe('secure');
    expect(byName['unauthenticated']).toBe('secure');
    expect(byName['schema-violating-args']).toBe('secure');
    expect(byName['unsupported-protocol-version']).toBe('secure');
  });
});

describe('runProtocolProbes — non-compliant server (ignores auth/session)', () => {
  let server: http.Server;
  let url: string;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: any = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          /* naive server ignores malformed input and still answers ok */
        }
        res.setHeader('Mcp-Session-Id', 'sess-1');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (body.method === 'initialize') {
          return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: {} } }));
        }
        if (body.method === 'tools/list') {
          return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }));
        }
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, result: { content: [], isError: false } }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
      done();
    });
  });
  afterAll((done) => {
    server.close(done);
  });

  it('flags violations and fails the battery (server returns success where rejection was expected)', async () => {
    const res = await runProtocolProbes({ endpoint: url, dbPath: '', simulationId: 's', agentId: 'a', token: 'whatever' });
    const byName = Object.fromEntries(res.results.map((r) => [r.name, r.verdict]));

    expect(res.violations).toBeGreaterThan(0);
    expect(res.passed).toBe(false);
    expect(byName['unauthenticated']).toBe('violation'); // accepted an unauthenticated call
    expect(byName['stale-session']).toBe('violation'); // accepted a forged session (no 404)
  });
});
