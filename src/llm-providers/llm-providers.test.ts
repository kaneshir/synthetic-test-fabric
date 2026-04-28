import { AnthropicToolCallingProvider } from './anthropic';
import { OpenAIToolCallingProvider } from './openai';
import { GeminiToolCallingProvider } from './gemini';
import { resolveToolCallingProvider } from './index';
import type { ToolDefinition, Message } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOOL: ToolDefinition = {
  name: 'lisa_health',
  description: 'Check server health',
  parameters: { type: 'object', properties: { verbose: { type: 'boolean' } } },
};

const USER_MSG: Message = { role: 'user', content: 'Check health' };

// ---------------------------------------------------------------------------
// Anthropic adapter
// ---------------------------------------------------------------------------

describe('AnthropicToolCallingProvider', () => {
  function makeClient(mockCreate: jest.Mock) {
    jest.doMock('@anthropic-ai/sdk', () => ({
      __esModule: true,
      default: class { messages = { create: mockCreate }; },
    }), { virtual: true });
    return new AnthropicToolCallingProvider({ apiKey: 'test-key' });
  }

  afterEach(() => jest.resetModules());

  it('formats tools with input_schema', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'healthy' }],
    });
    const provider = makeClient(mockCreate);
    await provider.chat({ messages: [USER_MSG], tools: [TOOL] });

    const call = mockCreate.mock.calls[0][0];
    expect(call.tools[0]).toMatchObject({
      name: 'lisa_health',
      description: 'Check server health',
      input_schema: TOOL.parameters,
    });
  });

  it('parses tool_use content block', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_123', name: 'lisa_health', input: { verbose: true } }],
    });
    const provider = makeClient(mockCreate);
    const res = await provider.chat({ messages: [USER_MSG], tools: [TOOL] });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0]).toEqual({ id: 'tu_123', name: 'lisa_health', args: { verbose: true } });
    expect(res.content).toBeUndefined();
  });

  it('returns text content when no tool calls', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'all good' }],
    });
    const provider = makeClient(mockCreate);
    const res = await provider.chat({ messages: [USER_MSG], tools: [TOOL] });

    expect(res.content).toBe('all good');
    expect(res.toolCalls).toBeUndefined();
  });

  it('formats second-turn tool result as user message with tool_result block', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'done' }] });
    const provider = makeClient(mockCreate);

    const messages: Message[] = [
      USER_MSG,
      { role: 'assistant', toolCalls: [{ id: 'tu_123', name: 'lisa_health', args: {} }] },
      { role: 'user', toolResults: [{ toolCallId: 'tu_123', content: 'ok' }] },
    ];
    await provider.chat({ messages, tools: [TOOL] });

    const formatted = mockCreate.mock.calls[0][0].messages;
    const toolResultMsg = formatted.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_123', content: 'ok' });
  });

  it('handles malformed JSON args gracefully', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'lisa_health', input: 'not-json' }],
    });
    const provider = makeClient(mockCreate);
    const res = await provider.chat({ messages: [USER_MSG], tools: [TOOL] });
    expect(res.toolCalls![0].args).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// OpenAI adapter
// ---------------------------------------------------------------------------

describe('OpenAIToolCallingProvider', () => {
  function makeClient(mockCreate: jest.Mock) {
    jest.doMock('openai', () => ({
      __esModule: true,
      default: class { chat = { completions: { create: mockCreate } }; },
    }), { virtual: true });
    return new OpenAIToolCallingProvider({ apiKey: 'test-key' });
  }

  afterEach(() => jest.resetModules());

  it('formats tools with type:function wrapper', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
    });
    const provider = makeClient(mockCreate);
    await provider.chat({ messages: [USER_MSG], tools: [TOOL] });

    const call = mockCreate.mock.calls[0][0];
    expect(call.tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'lisa_health', description: 'Check server health', parameters: TOOL.parameters },
    });
  });

  it('parses tool_calls from response', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: {
        content: null,
        tool_calls: [{ id: 'call_abc', function: { name: 'lisa_health', arguments: '{"verbose":true}' } }],
      }}],
    });
    const provider = makeClient(mockCreate);
    const res = await provider.chat({ messages: [USER_MSG], tools: [TOOL] });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0]).toEqual({ id: 'call_abc', name: 'lisa_health', args: { verbose: true } });
    expect(res.content).toBeUndefined();
  });

  it('handles null content on tool-only response', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: {
        content: null,
        tool_calls: [{ id: 'call_1', function: { name: 'lisa_health', arguments: '{}' } }],
      }}],
    });
    const provider = makeClient(mockCreate);
    const res = await provider.chat({ messages: [USER_MSG], tools: [TOOL] });
    expect(res.content).toBeUndefined();
    expect(res.toolCalls).toHaveLength(1);
  });

  it('formats second-turn tool result as role:tool message with tool_call_id', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'done' } }] });
    const provider = makeClient(mockCreate);

    const messages: Message[] = [
      USER_MSG,
      { role: 'assistant', toolCalls: [{ id: 'call_abc', name: 'lisa_health', args: {} }] },
      { role: 'user', toolResults: [{ toolCallId: 'call_abc', content: 'ok' }] },
    ];
    await provider.chat({ messages, tools: [TOOL] });

    const formatted = mockCreate.mock.calls[0][0].messages;
    const toolMsg = formatted.find((m: any) => m.role === 'tool');
    expect(toolMsg).toMatchObject({ role: 'tool', tool_call_id: 'call_abc', content: 'ok' });
  });

  it('handles malformed JSON args gracefully', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: {
        content: null,
        tool_calls: [{ id: 'call_1', function: { name: 'lisa_health', arguments: 'not-json' } }],
      }}],
    });
    const provider = makeClient(mockCreate);
    const res = await provider.chat({ messages: [USER_MSG], tools: [TOOL] });
    expect(res.toolCalls![0].args).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Gemini adapter
// ---------------------------------------------------------------------------

describe('GeminiToolCallingProvider', () => {
  function makeClient(mockGenerate: jest.Mock) {
    jest.doMock('@google/generative-ai', () => ({
      GoogleGenerativeAI: class {
        getGenerativeModel() {
          return { generateContent: mockGenerate };
        }
      },
    }), { virtual: true });
    return new GeminiToolCallingProvider({ apiKey: 'test-key' });
  }

  afterEach(() => jest.resetModules());

  it('formats tools with functionDeclarations (camelCase)', async () => {
    const mockGenerate = jest.fn().mockResolvedValue({
      response: { candidates: [{ content: { parts: [{ text: 'ok' }] } }], text: () => 'ok' },
    });
    const provider = makeClient(mockGenerate);
    await provider.chat({ messages: [USER_MSG], tools: [TOOL] });

    const call = mockGenerate.mock.calls[0][0];
    // Tools go to getGenerativeModel(), NOT to generateContent() — verify absence here
    expect(call).not.toHaveProperty('functionDeclarations');
    expect(call).not.toHaveProperty('function_declarations');
  });

  it('passes functionDeclarations to getGenerativeModel', async () => {
    let capturedConfig: any;
    jest.doMock('@google/generative-ai', () => ({
      GoogleGenerativeAI: class {
        getGenerativeModel(config: any) {
          capturedConfig = config;
          return { generateContent: jest.fn().mockResolvedValue({
            response: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
          }) };
        }
      },
    }), { virtual: true });
    const provider = new GeminiToolCallingProvider({ apiKey: 'test-key' });
    await provider.chat({ messages: [USER_MSG], tools: [TOOL] });

    expect(capturedConfig.tools[0]).toHaveProperty('functionDeclarations');
    expect(capturedConfig.tools[0].functionDeclarations[0]).toMatchObject({
      name: 'lisa_health',
      description: 'Check server health',
    });
  });

  it('parses functionCall parts from response', async () => {
    const mockGenerate = jest.fn().mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [
          { functionCall: { name: 'lisa_health', args: { verbose: true } } },
        ] } }],
      },
    });
    const provider = makeClient(mockGenerate);
    const res = await provider.chat({ messages: [USER_MSG], tools: [TOOL] });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].name).toBe('lisa_health');
    expect(res.toolCalls![0].args).toEqual({ verbose: true });
    expect(res.toolCalls![0].id).toMatch(/gemini-call-/);
  });

  it('formats second-turn tool result as functionResponse part', async () => {
    let capturedContents: any;
    jest.doMock('@google/generative-ai', () => ({
      GoogleGenerativeAI: class {
        getGenerativeModel() {
          return {
            generateContent: jest.fn().mockImplementation(({ contents }: any) => {
              capturedContents = contents;
              return Promise.resolve({ response: { candidates: [{ content: { parts: [{ text: 'done' }] } }] } });
            }),
          };
        }
      },
    }), { virtual: true });

    const provider = new GeminiToolCallingProvider({ apiKey: 'test-key' });
    const messages: Message[] = [
      USER_MSG,
      { role: 'assistant', toolCalls: [{ id: 'gemini-call-0', name: 'lisa_health', args: {} }] },
      { role: 'user', toolResults: [{ toolCallId: 'gemini-call-0', content: 'ok' }] },
    ];
    await provider.chat({ messages, tools: [TOOL] });

    const toolResultTurn = capturedContents.find((c: any) =>
      c.parts?.some((p: any) => p.functionResponse),
    );
    expect(toolResultTurn).toBeDefined();
    expect(toolResultTurn.parts[0].functionResponse).toMatchObject({ response: { content: 'ok' } });
  });

  it('handles malformed args gracefully', async () => {
    const mockGenerate = jest.fn().mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [
          { functionCall: { name: 'lisa_health', args: 'bad' } },
        ] } }],
      },
    });
    const provider = makeClient(mockGenerate);
    const res = await provider.chat({ messages: [USER_MSG], tools: [TOOL] });
    expect(res.toolCalls![0].args).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

describe('resolveToolCallingProvider()', () => {
  const ORIG = process.env['LISA_LLM_PROVIDER'];
  afterEach(() => {
    if (ORIG === undefined) delete process.env['LISA_LLM_PROVIDER'];
    else process.env['LISA_LLM_PROVIDER'] = ORIG;
  });

  it('returns undefined when LISA_LLM_PROVIDER is unset', () => {
    delete process.env['LISA_LLM_PROVIDER'];
    expect(resolveToolCallingProvider()).toBeUndefined();
  });

  it('returns AnthropicToolCallingProvider for "anthropic"', () => {
    process.env['LISA_LLM_PROVIDER'] = 'anthropic';
    expect(resolveToolCallingProvider()).toBeInstanceOf(AnthropicToolCallingProvider);
  });

  it('returns AnthropicToolCallingProvider for "claude"', () => {
    process.env['LISA_LLM_PROVIDER'] = 'claude';
    expect(resolveToolCallingProvider()).toBeInstanceOf(AnthropicToolCallingProvider);
  });

  it('returns OpenAIToolCallingProvider for "openai"', () => {
    process.env['LISA_LLM_PROVIDER'] = 'openai';
    expect(resolveToolCallingProvider()).toBeInstanceOf(OpenAIToolCallingProvider);
  });

  it('returns GeminiToolCallingProvider for "gemini"', () => {
    process.env['LISA_LLM_PROVIDER'] = 'gemini';
    expect(resolveToolCallingProvider()).toBeInstanceOf(GeminiToolCallingProvider);
  });

  it('throws for unknown provider', () => {
    process.env['LISA_LLM_PROVIDER'] = 'llama';
    expect(() => resolveToolCallingProvider()).toThrow(/Unknown LISA_LLM_PROVIDER/);
  });
});
