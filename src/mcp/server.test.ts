// Tests for fab-mcp — the MCP server wrapping fab commands.
//
// We spawn the BUILT server (dist/mcp/server.js) as a subprocess and speak
// MCP over stdio. This mirrors how Claude Code talks to it. The dist must
// be built before this test runs — if it's missing we build on demand so
// the test isn't order-dependent.

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(REPO_ROOT, 'dist', 'mcp', 'server.js');

beforeAll(() => {
  if (!fs.existsSync(SERVER)) {
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' });
  }
});

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Spawn fab-mcp, send one or more JSON-RPC requests, return responses ordered
 * by request id. Notifications (no `id`) are ignored — only count responses
 * whose id matches one of the request ids we sent.
 */
async function rpcRoundTrip(
  requests: Array<{ id?: number | string }>,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<JsonRpcResponse[]> {
  const child: ChildProcess = spawn(process.execPath, [SERVER], {
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, ...opts.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const expectedIds = new Set(requests.map((r) => r.id).filter((id) => id !== undefined));
  let buffer = '';
  const responses = new Map<number | string, JsonRpcResponse>();

  child.stderr!.on('data', () => { /* swallow */ });

  // Send all requests.
  const payload = requests.map((r) => JSON.stringify(r)).join('\n') + '\n';
  child.stdin!.write(payload);

  return new Promise<JsonRpcResponse[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(
        `rpcRoundTrip timed out. Expected ${expectedIds.size} responses, got ${responses.size}. ` +
        `Buffer tail: ${buffer.slice(-300)}`,
      ));
    }, 30_000);

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse & { id?: number | string };
          // Only count if it's a response to one of our requests.
          if (parsed.id !== undefined && expectedIds.has(parsed.id)) {
            responses.set(parsed.id, parsed);
            if (responses.size === expectedIds.size) {
              clearTimeout(timeout);
              child.kill();
              const ordered = requests
                .filter((r): r is { id: number | string } => r.id !== undefined)
                .map((r) => responses.get(r.id)!);
              resolve(ordered);
              return;
            }
          }
        } catch {
          /* not JSON — ignore */
        }
      }
    });
  });
}

interface McpToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function envelopeOf(response: McpToolResponse): Record<string, unknown> {
  return JSON.parse(response.content[0].text) as Record<string, unknown>;
}

const initRequest = (id = 1): object => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fab-mcp-test', version: '0.0.0' },
  },
});

const listToolsRequest = (id = 2): object => ({
  jsonrpc: '2.0', id, method: 'tools/list', params: {},
});

const callToolRequest = (id: number, name: string, args: Record<string, unknown> = {}): object => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
});

describe('fab-mcp — tools/list', () => {
  it('returns exactly 19 tools, all prefixed stf_', async () => {
    const [, listResp] = await rpcRoundTrip([initRequest(), listToolsRequest()]);
    const tools = (listResp.result as { tools: Array<{ name: string }> }).tools;
    expect(tools).toHaveLength(19);
    for (const t of tools) {
      expect(t.name).toMatch(/^stf_/);
    }
  });

  it('every tool has an inputSchema', async () => {
    const [, listResp] = await rpcRoundTrip([initRequest(), listToolsRequest()]);
    const tools = (listResp.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
    }
  });
});

describe('fab-mcp — tools/call envelope translation', () => {
  it('stf_status (success) returns MCP success with envelope JSON', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-state-'));
    try {
      const [, , callResp] = await rpcRoundTrip(
        [initRequest(), listToolsRequest(), callToolRequest(3, 'stf_status', {})],
        { env: { FAB_STATE_DIR: stateDir } },
      );
      const tool = callResp.result as McpToolResponse;
      expect(tool.isError).not.toBe(true);
      const env = envelopeOf(tool);
      expect(env.command).toBe('status');
      expect(env.status).toBe('ok');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('stf_check below threshold (domain failure) returns MCP success NOT isError', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-check-'));
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-state-'));
    try {
      // Pre-write a low-score fabric-score.json so check fails domain.
      const iter = path.join(dir, 'iter-001');
      fs.mkdirSync(iter, { recursive: true });
      fs.writeFileSync(path.join(iter, 'fabric-score.json'), JSON.stringify({
        simulationId: 'x', generatedAt: '2026-01-01T00:00:00Z', overall: 0.3, dimensions: {}, details: {},
      }));
      const [, , callResp] = await rpcRoundTrip(
        [initRequest(), listToolsRequest(), callToolRequest(3, 'stf_check', { root: dir, threshold: 0.5 })],
        { env: { FAB_STATE_DIR: stateDir } },
      );
      const tool = callResp.result as McpToolResponse;
      // Domain failure: tool ran successfully, found a problem. NOT isError.
      expect(tool.isError).not.toBe(true);
      const env = envelopeOf(tool);
      expect(env.status).toBe('ok');
      expect((env.data as { ok: boolean }).ok).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('stf_inspect on bad path (infra error) returns isError with full envelope', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-state-'));
    try {
      const [, , callResp] = await rpcRoundTrip(
        [initRequest(), listToolsRequest(), callToolRequest(3, 'stf_inspect', { root: '/tmp/definitely-not-' + Date.now() })],
        { env: { FAB_STATE_DIR: stateDir } },
      );
      const tool = callResp.result as McpToolResponse;
      expect(tool.isError).toBe(true);
      const env = envelopeOf(tool);
      expect(env.status).toBe('error');
      // Full envelope JSON survives the transport — error.code etc. preserved.
      expect((env.error as { message: string }).message).toBeDefined();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('stf_inspect on ambiguous root preserves AMBIGUOUS_ROOT code', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-ambig-'));
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-state-'));
    try {
      // Ambiguous: has both iter-001/ AND fabric-score.json at root.
      fs.mkdirSync(path.join(dir, 'iter-001'));
      fs.writeFileSync(path.join(dir, 'fabric-score.json'), '{}');
      const [, , callResp] = await rpcRoundTrip(
        [initRequest(), listToolsRequest(), callToolRequest(3, 'stf_inspect', { root: dir })],
        { env: { FAB_STATE_DIR: stateDir } },
      );
      const tool = callResp.result as McpToolResponse;
      expect(tool.isError).toBe(true);
      const env = envelopeOf(tool);
      expect((env.error as { code: string }).code).toBe('AMBIGUOUS_ROOT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('unknown tool name returns isError with UNKNOWN_TOOL', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-state-'));
    try {
      const [, , callResp] = await rpcRoundTrip(
        [initRequest(), listToolsRequest(), callToolRequest(3, 'stf_nonexistent', {})],
        { env: { FAB_STATE_DIR: stateDir } },
      );
      const tool = callResp.result as McpToolResponse;
      expect(tool.isError).toBe(true);
      const env = envelopeOf(tool);
      expect((env.error as { code: string }).code).toBe('UNKNOWN_TOOL');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('invalid input shape returns isError with INVALID_INPUT', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-state-'));
    try {
      // stf_inspect requires `root` (string) — pass something invalid.
      const [, , callResp] = await rpcRoundTrip(
        [initRequest(), listToolsRequest(), callToolRequest(3, 'stf_inspect', { root: 123 as unknown as string })],
        { env: { FAB_STATE_DIR: stateDir } },
      );
      const tool = callResp.result as McpToolResponse;
      expect(tool.isError).toBe(true);
      const env = envelopeOf(tool);
      expect((env.error as { code: string }).code).toBe('INVALID_INPUT');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe('fab-mcp — runner path resolution', () => {
  it('runFabCommand resolves the bundled fab CLI relative to its module', async () => {
    // This is the regression test for the #27 path-resolution bug. Spawn
    // fab-mcp from a cwd that does NOT contain the package — the server
    // should still find dist/cli/fab.js relative to its own module.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-cwd-'));
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-mcp-test-state-'));
    try {
      const [, , callResp] = await rpcRoundTrip(
        [initRequest(), listToolsRequest(), callToolRequest(3, 'stf_status', {})],
        { cwd, env: { FAB_STATE_DIR: stateDir } },
      );
      const tool = callResp.result as McpToolResponse;
      // Even from /tmp/random-dir, the server resolves the bundled fab
      // CLI and stf_status returns successfully (empty state, but ok).
      expect(tool.isError).not.toBe(true);
      const env = envelopeOf(tool);
      expect(env.status).toBe('ok');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
