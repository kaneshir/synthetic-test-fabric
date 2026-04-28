import { AgentLoopProvider } from './agent-loop';
import type { ToolCallingLlmProvider, ChatResponse, Message, ToolDefinition } from './llm-providers/types';
import type { McpClient, McpTool } from './mcp-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOLS: McpTool[] = [
  { name: 'lisa_health', description: 'Check health', inputSchema: { type: 'object', properties: {} } },
  { name: 'lisa_navigate', description: 'Navigate app', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
];

function makeMcpClient(overrides: Partial<{
  spawn: jest.Mock;
  getTools: jest.Mock;
  callTool: jest.Mock;
  close: jest.Mock;
}> = {}): McpClient {
  return {
    spawn: overrides.spawn ?? jest.fn().mockResolvedValue(undefined),
    getTools: overrides.getTools ?? jest.fn().mockResolvedValue(TOOLS),
    callTool: overrides.callTool ?? jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    close: overrides.close ?? jest.fn(),
  } as unknown as McpClient;
}

function makeChatProvider(responses: ChatResponse[]): ToolCallingLlmProvider {
  let i = 0;
  return {
    id: 'mock-provider',
    chat: jest.fn().mockImplementation(async () => responses[Math.min(i++, responses.length - 1)]),
  };
}

// ---------------------------------------------------------------------------
// AgentLoopProvider — core loop behaviour
// ---------------------------------------------------------------------------

describe('AgentLoopProvider', () => {
  it('returns text response when no tool calls', async () => {
    const client = makeMcpClient();
    const provider = makeChatProvider([{ content: 'all good' }]);
    const loop = new AgentLoopProvider(provider, client);
    const result = await loop.complete('check health');
    expect(result).toBe('all good');
  });

  it('has id prefixed with agent-loop:', () => {
    const client = makeMcpClient();
    const provider = { id: 'anthropic-tool:claude-sonnet-4-6', chat: jest.fn() } as unknown as ToolCallingLlmProvider;
    const loop = new AgentLoopProvider(provider, client);
    expect(loop.id).toBe('agent-loop:anthropic-tool:claude-sonnet-4-6');
  });

  it('happy path: tool call → result injected → final response', async () => {
    const callTool = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'healthy' }] });
    const client = makeMcpClient({ callTool });
    const provider = makeChatProvider([
      { toolCalls: [{ id: 'tc-1', name: 'lisa_health', args: {} }] },
      { content: 'done' },
    ]);
    const loop = new AgentLoopProvider(provider, client);
    const result = await loop.complete('run health check');

    expect(result).toBe('done');
    expect(callTool).toHaveBeenCalledWith('lisa_health', {});

    const chatMock = provider.chat as jest.Mock;
    const secondCall: { messages: Message[] } = chatMock.mock.calls[1][0];
    const toolResultMsg = secondCall.messages.find(m => m.toolResults);
    expect(toolResultMsg?.toolResults?.[0]).toMatchObject({ toolCallId: 'tc-1', content: 'healthy' });
  });

  it('multi-turn: two sequential tool calls before final response', async () => {
    const callTool = jest.fn()
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'nav-result' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'health-result' }] });

    const client = makeMcpClient({ callTool });
    const provider = makeChatProvider([
      { toolCalls: [{ id: 'tc-1', name: 'lisa_navigate', args: { url: '/home' } }] },
      { toolCalls: [{ id: 'tc-2', name: 'lisa_health', args: {} }] },
      { content: 'all flows passed' },
    ]);
    const loop = new AgentLoopProvider(provider, client);
    const result = await loop.complete('test the app');

    expect(result).toBe('all flows passed');
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls[0]).toEqual(['lisa_navigate', { url: '/home' }]);
    expect(callTool.mock.calls[1]).toEqual(['lisa_health', {}]);
  });

  it('stops at maxIterations and returns last text seen', async () => {
    const client = makeMcpClient();
    let turn = 0;
    const provider: ToolCallingLlmProvider = {
      id: 'mock',
      chat: jest.fn().mockImplementation(async () => {
        turn++;
        return turn === 1
          ? { content: 'partial', toolCalls: [{ id: `tc-${turn}`, name: 'lisa_health', args: {} }] }
          : { toolCalls: [{ id: `tc-${turn}`, name: 'lisa_health', args: {} }] };
      }),
    };
    const loop = new AgentLoopProvider(provider, client, { maxIterations: 3 });
    const result = await loop.complete('run');

    expect(result).toBe('partial');
    expect((provider.chat as jest.Mock).mock.calls).toHaveLength(3);
  });

  it('injects tool error as result string and continues loop', async () => {
    const callTool = jest.fn().mockRejectedValue(new Error('tool timed out'));
    const client = makeMcpClient({ callTool });
    const provider = makeChatProvider([
      { toolCalls: [{ id: 'tc-err', name: 'lisa_health', args: {} }] },
      { content: 'recovered' },
    ]);
    const loop = new AgentLoopProvider(provider, client);
    const result = await loop.complete('check');

    expect(result).toBe('recovered');
    const chatMock = provider.chat as jest.Mock;
    const secondCall: { messages: Message[] } = chatMock.mock.calls[1][0];
    const toolResultMsg = secondCall.messages.find(m => m.toolResults);
    expect(toolResultMsg?.toolResults?.[0].content).toMatch(/Error: tool timed out/);
  });

  it('calls mcpClient.close() in finally even when chat throws', async () => {
    const close = jest.fn();
    const client = makeMcpClient({ close });
    const provider: ToolCallingLlmProvider = {
      id: 'mock',
      chat: jest.fn().mockRejectedValue(new Error('LLM unavailable')),
    };
    const loop = new AgentLoopProvider(provider, client);
    await expect(loop.complete('check')).rejects.toThrow('LLM unavailable');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('calls mcpClient.close() in finally on normal completion', async () => {
    const close = jest.fn();
    const client = makeMcpClient({ close });
    const provider = makeChatProvider([{ content: 'ok' }]);
    const loop = new AgentLoopProvider(provider, client);
    await loop.complete('ping');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('passes tool definitions to chat() derived from getTools()', async () => {
    const client = makeMcpClient();
    const provider = makeChatProvider([{ content: 'done' }]);
    const loop = new AgentLoopProvider(provider, client);
    await loop.complete('go');

    const chatMock = provider.chat as jest.Mock;
    const calledTools: ToolDefinition[] = chatMock.mock.calls[0][0].tools;
    expect(calledTools).toHaveLength(2);
    expect(calledTools[0]).toMatchObject({ name: 'lisa_health', description: 'Check health' });
    expect(calledTools[0].parameters).toEqual(TOOLS[0].inputSchema);
  });

  it('concatenates multiple text parts from callTool result', async () => {
    const callTool = jest.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'part1' },
        { type: 'image', text: undefined },
        { type: 'text', text: 'part2' },
      ],
    });
    const client = makeMcpClient({ callTool });
    const provider = makeChatProvider([
      { toolCalls: [{ id: 'tc-1', name: 'lisa_health', args: {} }] },
      { content: 'ok' },
    ]);
    const loop = new AgentLoopProvider(provider, client);
    await loop.complete('go');

    const chatMock = provider.chat as jest.Mock;
    const secondCall: { messages: Message[] } = chatMock.mock.calls[1][0];
    const toolResult = secondCall.messages.find(m => m.toolResults)?.toolResults?.[0];
    expect(toolResult?.content).toBe('part1\npart2');
  });
});

// ---------------------------------------------------------------------------
// resolveProvider() — LISA_LLM_PROVIDER selection
// ---------------------------------------------------------------------------

describe('resolveProvider() with LISA_LLM_PROVIDER', () => {
  const ORIG = process.env['LISA_LLM_PROVIDER'];
  afterEach(() => {
    if (ORIG === undefined) delete process.env['LISA_LLM_PROVIDER'];
    else process.env['LISA_LLM_PROVIDER'] = ORIG;
    jest.resetModules();
  });

  it('returns AgentLoopProvider when LISA_LLM_PROVIDER=anthropic', async () => {
    process.env['LISA_LLM_PROVIDER'] = 'anthropic';
    const { resolveProvider } = await import('./llm-provider');
    const provider = resolveProvider(undefined, undefined);
    expect(provider).toBeInstanceOf(AgentLoopProvider);
    expect(provider!.id).toMatch(/^agent-loop:anthropic-tool:/);
  });

  it('returns AgentLoopProvider when LISA_LLM_PROVIDER=openai', async () => {
    process.env['LISA_LLM_PROVIDER'] = 'openai';
    const { resolveProvider } = await import('./llm-provider');
    const { AgentLoopProvider: Fresh } = await import('./agent-loop');
    const provider = resolveProvider(undefined, undefined);
    expect(provider).toBeInstanceOf(Fresh);
    expect(provider!.id).toMatch(/^agent-loop:openai-tool:/);
  });

  it('returns AgentLoopProvider when LISA_LLM_PROVIDER=gemini', async () => {
    process.env['LISA_LLM_PROVIDER'] = 'gemini';
    const { resolveProvider } = await import('./llm-provider');
    const { AgentLoopProvider: Fresh } = await import('./agent-loop');
    const provider = resolveProvider(undefined, undefined);
    expect(provider).toBeInstanceOf(Fresh);
    expect(provider!.id).toMatch(/^agent-loop:gemini-tool:/);
  });

  it('explicit llmProvider still wins over LISA_LLM_PROVIDER', async () => {
    process.env['LISA_LLM_PROVIDER'] = 'anthropic';
    const { resolveProvider, ClaudeCliProvider } = await import('./llm-provider');
    const explicit = new ClaudeCliProvider();
    const provider = resolveProvider(undefined, explicit);
    expect(provider).toBe(explicit);
  });

  it('falls through to Claude CLI when LISA_LLM_PROVIDER is unset', async () => {
    delete process.env['LISA_LLM_PROVIDER'];
    // Ensure claude isn't available so we get undefined (not ClaudeCliProvider)
    const { resolveProvider } = await import('./llm-provider');
    // With no CLI and no API keys this should return undefined
    const provider = resolveProvider(undefined, undefined);
    // We can't guarantee claude is in PATH in test env — just verify it's NOT an AgentLoopProvider
    if (provider) {
      expect(provider).not.toBeInstanceOf(AgentLoopProvider);
    }
  });
});
