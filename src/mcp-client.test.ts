import { McpClient, createMcpClient } from './mcp-client';
import * as path from 'path';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mock child_process at module level so spawn is configurable
// ---------------------------------------------------------------------------

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = spawn as jest.Mock;

// ---------------------------------------------------------------------------
// Minimal mock binary process
// ---------------------------------------------------------------------------

interface MockProcess extends EventEmitter {
  stdin: { write: jest.Mock };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
}

function makeMockProc(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = { write: jest.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn(() => { proc.emit('close', 0); });
  return proc;
}

/** Emit a JSON-RPC response on the mock process stdout. */
function respond(proc: MockProcess, id: number, result: unknown): void {
  proc.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'));
}

/** Emit a JSON-RPC error on the mock process stdout. */
function respondError(proc: MockProcess, id: number, message: string): void {
  proc.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -1, message } }) + '\n'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpClient', () => {
  let mockProc: MockProcess;

  beforeEach(() => {
    mockProc = makeMockProc();
    mockSpawn.mockReturnValue(mockProc);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // Helper: spawn client and auto-respond to initialize
  async function spawnClient(opts?: { appUrl?: string; timeoutMs?: number }): Promise<McpClient> {
    const client = new McpClient({
      memoryDir: '/tmp/test-memory',
      command: { cmd: 'lisa-mcp', args: [] },
      ...opts,
    });

    const spawnPromise = client.spawn();
    // initialize is id=1 — respond immediately
    await new Promise(r => setImmediate(r));
    respond(mockProc, 1, { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'lisa-mcp', version: '1.0.1' } });
    await spawnPromise;
    return client;
  }

  describe('spawn()', () => {
    it('starts binary with LISA_MEMORY_DIR env', async () => {
      await spawnClient();
      expect(mockSpawn).toHaveBeenCalledWith(
        'lisa-mcp',
        [],
        expect.objectContaining({
          env: expect.objectContaining({ LISA_MEMORY_DIR: '/tmp/test-memory' }),
        }),
      );
    });

    it('passes LISA_APP_URL when provided', async () => {
      await spawnClient({ appUrl: 'http://localhost:3000' });
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          env: expect.objectContaining({ LISA_APP_URL: 'http://localhost:3000' }),
        }),
      );
    });

    it('sends initialize then notifications/initialized', async () => {
      await spawnClient();
      const calls: string[] = mockProc.stdin.write.mock.calls.map((c: any[]) => c[0] as string);
      const initCall = calls.find(c => c.includes('"initialize"'));
      const notifCall = calls.find(c => c.includes('notifications/initialized'));
      expect(initCall).toBeDefined();
      expect(JSON.parse(initCall!)).toMatchObject({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      });
      expect(notifCall).toBeDefined();
      // notification has no id
      expect(JSON.parse(notifCall!)).not.toHaveProperty('id');
    });
  });

  describe('getTools()', () => {
    const REQUIRED_TOOLS = [
      'lisa_health',
      'lisa_explore',
      'lisa_action',
      'lisa_flow',
      'lisa_run_flow',
    ];

    it('returns tool list including required tools', async () => {
      const client = await spawnClient();

      const toolsPromise = client.getTools();
      await new Promise(r => setImmediate(r));
      respond(mockProc, 2, {
        tools: REQUIRED_TOOLS.map(name => ({
          name,
          description: `${name} tool`,
          inputSchema: { type: 'object', properties: {} },
        })),
      });

      const tools = await toolsPromise;
      const names = tools.map(t => t.name);
      for (const required of REQUIRED_TOOLS) {
        expect(names).toContain(required);
      }
    });

    it('throws on JSON-RPC error', async () => {
      const client = await spawnClient();
      const toolsPromise = client.getTools();
      await new Promise(r => setImmediate(r));
      respondError(mockProc, 2, 'server error');
      await expect(toolsPromise).rejects.toThrow('tools/list failed: server error');
    });
  });

  describe('callTool()', () => {
    it('round-trips tool name and args', async () => {
      const client = await spawnClient();
      const callPromise = client.callTool('lisa_health', { verbose: true });
      await new Promise(r => setImmediate(r));
      const calls: string[] = mockProc.stdin.write.mock.calls.map((c: any[]) => c[0] as string);
      const toolCall = calls.find(c => c.includes('tools/call'));
      expect(JSON.parse(toolCall!)).toMatchObject({
        method: 'tools/call',
        params: { name: 'lisa_health', arguments: { verbose: true } },
      });
      respond(mockProc, 2, { content: [{ type: 'text', text: 'ok' }] });
      const result = await callPromise;
      expect(result.content[0].text).toBe('ok');
    });

    it('throws on tool execution error', async () => {
      const client = await spawnClient();
      const callPromise = client.callTool('lisa_health', {});
      await new Promise(r => setImmediate(r));
      respondError(mockProc, 2, 'tool failed');
      await expect(callPromise).rejects.toThrow('tools/call lisa_health failed: tool failed');
    });
  });

  describe('non-JSON stdout tolerance', () => {
    it('ignores non-JSON log lines without throwing', async () => {
      const client = new McpClient({
        memoryDir: '/tmp/test-memory',
        command: { cmd: 'lisa-mcp', args: [] },
      });

      const spawnPromise = client.spawn();
      // Emit a non-JSON log line before the response
      mockProc.stdout.emit('data', Buffer.from('[MemoryService] Loaded 0 memories\n'));
      await new Promise(r => setImmediate(r));
      respond(mockProc, 1, { protocolVersion: '2024-11-05', capabilities: {} });
      await expect(spawnPromise).resolves.toBeUndefined();
    });

    it('handles mixed JSON and non-JSON in same chunk', async () => {
      const client = await spawnClient();
      const toolsPromise = client.getTools();
      await new Promise(r => setImmediate(r));

      const mixed = '[MemoryService] info\n' + JSON.stringify({
        jsonrpc: '2.0', id: 2,
        result: { tools: [{ name: 'lisa_health', description: '', inputSchema: {} }] },
      }) + '\n';
      mockProc.stdout.emit('data', Buffer.from(mixed));

      const tools = await toolsPromise;
      expect(tools[0].name).toBe('lisa_health');
    });
  });

  describe('close()', () => {
    it('kills the process', async () => {
      const client = await spawnClient();
      client.close();
      expect(mockProc.kill).toHaveBeenCalled();
    });

    it('rejects pending requests on close', async () => {
      const client = await spawnClient();
      const callPromise = client.callTool('lisa_health', {});
      await new Promise(r => setImmediate(r));
      client.close();
      await expect(callPromise).rejects.toThrow('McpClient closed');
    });
  });

  describe('timeout', () => {
    it('rejects and kills process on timeout', async () => {
      const client = new McpClient({
        memoryDir: '/tmp/test-memory',
        command: { cmd: 'lisa-mcp', args: [] },
        timeoutMs: 50, // real timer — fast enough for a unit test
      });
      // Never respond to initialize → times out
      await expect(client.spawn()).rejects.toThrow(/timed out/);
    }, 2000);
  });

  describe('before spawn()', () => {
    it('callTool rejects if not spawned', async () => {
      const client = new McpClient({
        memoryDir: '/tmp/test-memory',
        command: { cmd: 'lisa-mcp', args: [] },
      });
      await expect(client.callTool('lisa_health', {})).rejects.toThrow('not spawned');
    });
  });

  describe('createMcpClient()', () => {
    it('resolves memoryDir from iterRoot', async () => {
      const client = createMcpClient('/my/iter/root', { command: { cmd: 'test', args: [] } });
      const spawnPromise = client.spawn();
      await new Promise(r => setImmediate(r));
      respond(mockProc, 1, { protocolVersion: '2024-11-05', capabilities: {} });
      await spawnPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          env: expect.objectContaining({
            LISA_MEMORY_DIR: path.join('/my/iter/root', '.lisa_memory'),
          }),
        }),
      );
    });
  });
});
