import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export interface McpClientOptions {
  /** Path to directory containing lisa.db — passed as LISA_MEMORY_DIR to binary. */
  memoryDir: string;
  /** Optional app URL passed as LISA_APP_URL to binary. */
  appUrl?: string;
  /** Override the binary command. Defaults to buildLisaMcpCommand() from @kaneshir/lisa-mcp. */
  command?: { cmd: string; args: string[] };
  /** Per-request timeout in ms. Default: 30_000. */
  timeoutMs?: number;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  private readonly opts: Required<Pick<McpClientOptions, 'memoryDir' | 'timeoutMs'>> &
    Pick<McpClientOptions, 'appUrl' | 'command'>;

  private proc: ChildProcess | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, (r: JsonRpcResponse) => void>();
  private initialized = false;

  constructor(opts: McpClientOptions) {
    this.opts = {
      memoryDir: opts.memoryDir,
      appUrl: opts.appUrl,
      command: opts.command,
      timeoutMs: opts.timeoutMs ?? 30_000,
    };
  }

  async spawn(): Promise<void> {
    const { cmd, args } = await this.resolveCommand();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LISA_MEMORY_DIR: this.opts.memoryDir,
    };
    if (this.opts.appUrl) env.LISA_APP_URL = this.opts.appUrl;

    this.proc = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString();
      const lines = this.buf.split('\n');
      this.buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // non-JSON log lines from binary — ignore
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        }
      }
    });

    this.proc.on('error', (err) => {
      this.rejectAll(`Process error: ${err.message}`);
    });

    this.proc.on('close', (code, signal) => {
      const msg = signal
        ? `lisa-mcp process killed (signal: ${signal})`
        : `lisa-mcp process exited (code: ${code})`;
      this.rejectAll(msg);
      this.proc = null;
      this.initialized = false;
    });

    await this.initialize();
  }

  async getTools(): Promise<McpTool[]> {
    const res = await this.call('tools/list', {});
    if (res.error) throw new Error(`tools/list failed: ${res.error.message}`);
    return (res.result as { tools: McpTool[] }).tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const res = await this.call('tools/call', { name, arguments: args });
    if (res.error) throw new Error(`tools/call ${name} failed: ${res.error.message}`);
    return res.result as McpCallResult;
  }

  close(): void {
    this.proc?.kill();
    // close event will fire and call rejectAll + clear state
  }

  private rejectAll(message: string): void {
    for (const resolve of this.pending.values()) {
      resolve({ id: -1, error: { code: -32000, message } });
    }
    this.pending.clear();
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    const res = await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'stf-mcp-client', version: '1.0.0' },
    });
    if (res.error) {
      throw new Error(`MCP initialize failed: ${res.error.message}`);
    }
    // Notification — no response expected
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    this.initialized = true;
  }

  private call(method: string, params: object): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        reject(new Error('McpClient not spawned — call spawn() first'));
        return;
      }

      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.proc?.kill();
        reject(new Error(`MCP request timed out: ${method} (${this.opts.timeoutMs}ms)`));
      }, this.opts.timeoutMs);

      this.pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });

      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private send(obj: object): void {
    this.proc?.stdin?.write(JSON.stringify(obj) + '\n');
  }

  private async resolveCommand(): Promise<{ cmd: string; args: string[] }> {
    if (this.opts.command) return this.opts.command;
    try {
      const pkg = await import('@kaneshir/lisa-mcp') as { buildLisaMcpCommand(): { cmd: string; args: string[] } };
      return pkg.buildLisaMcpCommand();
    } catch {
      throw new Error(
        'lisa-mcp binary not found. Install @kaneshir/lisa-mcp or pass command to McpClient.',
      );
    }
  }
}

/**
 * Convenience factory — resolves memoryDir from iterRoot using the standard convention.
 */
export function createMcpClient(
  iterRoot: string,
  opts?: Omit<McpClientOptions, 'memoryDir'>,
): McpClient {
  return new McpClient({
    ...opts,
    memoryDir: path.join(iterRoot, '.lisa_memory'),
  });
}
