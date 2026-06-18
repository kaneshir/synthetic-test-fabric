import * as http from 'http';
import { AddressInfo } from 'net';
import { McpExecutor } from './executor';
import { classifyMcpOutcome, httpStatusToMcpErrorCode, BEHAVIOR_OUTCOMES } from '../outcomes';

/**
 * Framework-layer rejections: a real MCP server (NestJS/FastAPI/Express) often rejects at a guard
 * BEFORE the JSON-RPC handler, returning a REST-style 4xx with NO JSON-RPC `error` envelope. The
 * executor must classify that as the rejection it is — not silently bucket it as success — and
 * synthesize a recognizable error code, so consumers (probes/gates) can read it.
 */
describe('McpExecutor — framework-layer HTTP rejections', () => {
  let server: http.Server;
  let url: string;
  let toolStatus = 403; // status the server returns on tools/call

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const method = (() => { try { return JSON.parse(raw).method; } catch { return ''; } })();
        if (method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'mcp-session-id': 's1' });
          return res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {} } }));
        }
        if (method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
        // tools/call → a NestJS-style REST error body, NOT a JSON-RPC envelope
        res.writeHead(toolStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ statusCode: toolStatus, code: 'COMMON_FORBIDDEN', error: 'Forbidden', message: 'Not a member of this organization' }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const make = () => new McpExecutor({ endpoint: url, dbPath: '', simulationId: 's', agentId: 'a', token: 't', allowWrites: true });

  it('classifies a REST-style 403 (no JSON-RPC error) as ERROR_403 + a -32003 errorCode, not success', async () => {
    toolStatus = 403;
    const exec = make();
    const r: any = await exec.callTool('redy.supplier.records.list', { orgId: 'foreign' }, { write: true });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe(BEHAVIOR_OUTCOMES.ERROR_403); // ← was SUCCESS before the fix
    expect(r.errorCode).toBe(-32003);                    // ← was undefined before the fix
    expect(r.httpStatus).toBe(403);
  });

  it('maps a REST-style 404 to ERROR_404 + -32004', async () => {
    toolStatus = 404;
    const exec = make();
    const r: any = await exec.callTool('redy.x.y', {}, { write: true });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe(BEHAVIOR_OUTCOMES.ERROR_404);
    expect(r.errorCode).toBe(-32004);
  });

  // pure-function guarantees
  it('classifyMcpOutcome: HTTP status is a FALLBACK only — JSON-RPC error still wins; 200 stays success', () => {
    expect(classifyMcpOutcome({ error: { code: -32003 } }, 200)).toBe(BEHAVIOR_OUTCOMES.ERROR_403); // jsonrpc wins
    expect(classifyMcpOutcome({}, 403)).toBe(BEHAVIOR_OUTCOMES.ERROR_403);                          // fallback to status
    expect(classifyMcpOutcome({}, 200)).toBe(BEHAVIOR_OUTCOMES.SUCCESS);                            // ok
    expect(classifyMcpOutcome({})).toBe(BEHAVIOR_OUTCOMES.SUCCESS);                                 // no status → unchanged
  });

  it('httpStatusToMcpErrorCode maps the canonical statuses', () => {
    expect(httpStatusToMcpErrorCode(401)).toBe(-32001);
    expect(httpStatusToMcpErrorCode(403)).toBe(-32003);
    expect(httpStatusToMcpErrorCode(404)).toBe(-32004);
    expect(httpStatusToMcpErrorCode(429)).toBe(-32029);
    expect(httpStatusToMcpErrorCode(200)).toBeUndefined();
  });
});
