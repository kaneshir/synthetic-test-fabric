import * as http from 'http';
import { AddressInfo } from 'net';
import { McpExecutor, McpError } from './executor';

/**
 * 429 backoff: the executor must behave like a polite client — a rate-limited burst should self-pace and
 * retry (honouring Retry-After), not fail the call. This is what lets a coverage gate run against a live,
 * tier-rate-limited server (e.g. Redy's MCP endpoint on the `free` tier @ 30 req/min) instead of dying on
 * the first 429. Uses dbPath:'' (assessment-only) so no recorder/db is needed.
 */
describe('McpExecutor 429 backoff', () => {
  let server: http.Server;
  let url: string;
  let total = 0;
  let mode: { rejectFirst: number } | { rejectAll: true } = { rejectFirst: 0 };
  // How the 429 advertises its retry delay: a delta-seconds header, an HTTP-date, or none (→ exp backoff).
  let retryAfter: 'zero' | 'date' | 'none' = 'zero';

  function rateLimited(res: http.ServerResponse): void {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (retryAfter === 'zero') headers['Retry-After'] = '0';
    else if (retryAfter === 'date') headers['Retry-After'] = new Date(Date.now() + 300).toUTCString();
    // 'none' → omit the header so the executor must fall back to exponential backoff + jitter
    res.writeHead(429, headers);
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32029, message: 'rate limited' } }));
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        total += 1;
        const reject = 'rejectAll' in mode ? true : total <= mode.rejectFirst;
        if (reject) return rateLimited(res);
        const method = (() => { try { return JSON.parse(raw).method; } catch { return ''; } })();
        if (method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'mcp-session-id': 'sess-1' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {} } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => { total = 0; retryAfter = 'zero'; });

  const make = (extra = {}) =>
    new McpExecutor({ endpoint: url, dbPath: '', simulationId: 's', agentId: 'a', token: 't', retryBackoffBaseMs: 1, ...extra });

  it('retries through a burst of 429s and then succeeds (initialize completes)', async () => {
    mode = { rejectFirst: 3 };
    const exec = make({ rateLimitRetries: 5 });
    await expect(exec.initialize()).resolves.toBeUndefined();
    expect(exec.negotiatedProtocolVersion).toBe('2025-03-26');
    expect(total).toBeGreaterThan(3); // 3 × 429, then a 200 (retry happened)
  });

  it('gives up after rateLimitRetries (bounded — never loops forever) and surfaces the failure', async () => {
    mode = { rejectAll: true };
    const exec = make({ rateLimitRetries: 2 });
    await expect(exec.initialize()).rejects.toBeInstanceOf(McpError);
    expect(total).toBe(3); // 1 initial attempt + 2 retries, then give up
  });

  it('with retries disabled (0), a single 429 fails immediately', async () => {
    mode = { rejectAll: true };
    const exec = make({ rateLimitRetries: 0 });
    await expect(exec.initialize()).rejects.toBeInstanceOf(McpError);
    expect(total).toBe(1); // no retry
  });

  it('falls back to exponential backoff when the 429 carries NO Retry-After header', async () => {
    mode = { rejectFirst: 2 };
    retryAfter = 'none'; // exercises the baseMs * 2**attempt + jitter branch
    const exec = make({ rateLimitRetries: 5, retryBackoffBaseMs: 1 });
    await expect(exec.initialize()).resolves.toBeUndefined();
    expect(total).toBeGreaterThan(2);
  });

  it('honours an HTTP-date Retry-After header', async () => {
    mode = { rejectFirst: 1 };
    retryAfter = 'date'; // Retry-After as an RFC HTTP-date, not delta-seconds
    const exec = make({ rateLimitRetries: 5 });
    await expect(exec.initialize()).resolves.toBeUndefined();
    expect(total).toBeGreaterThan(1);
  });
});
