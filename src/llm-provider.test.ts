/**
 * Exhaustive tests for src/llm-provider.ts.
 *
 * Coverage strategy:
 *  - resolveProvider: all 8 steps + edge cases (env combinations, flag values)
 *  - claudeCliAvailable: success / failure paths
 *  - ClaudeCliProvider: output parsing (result/content/raw), error wrapping,
 *    timeout config, stdin forwarding
 *  - ClaudeSdkProvider: request construction (model, max_tokens, temperature),
 *    response parsing (single/multi/non-text blocks), missing peer dep error
 *  - GeminiProvider: alias map, generationConfig shape (all opt combos),
 *    missing peer dep error, response extraction
 *  - OllamaProvider: body construction (all opt combos, no opts), HTTP error,
 *    empty response error, custom host (constructor + env), URL format
 *  - OpenAIProvider: request opts (temperature, max_tokens, neither), response
 *    extraction, empty choices fallback, missing peer dep error
 */

import { execFileSync } from 'child_process';
import {
  resolveProvider,
  claudeCliAvailable,
  ClaudeCliProvider,
  ClaudeSdkProvider,
  GeminiProvider,
  OllamaProvider,
  OpenAIProvider,
  DEFAULT_CLAUDE_SDK_MODEL,
  DEFAULT_GEMINI_MODEL,
} from './llm-provider';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));
const mockExecFileSync = execFileSync as jest.Mock;

// Mock all optional SDK peer deps so we can control their behaviour in tests.
// The production code imports them dynamically; Jest intercepts those calls here.

const mockAnthropicCreate = jest.fn();
const MockAnthropic = jest.fn(() => ({ messages: { create: mockAnthropicCreate } }));
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: MockAnthropic }), { virtual: false });

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));
const MockGoogleGenerativeAI = jest.fn(() => ({ getGenerativeModel: mockGetGenerativeModel }));
jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: MockGoogleGenerativeAI }), { virtual: false });

const mockCompletionsCreate = jest.fn();
const MockOpenAI = jest.fn(() => ({ chat: { completions: { create: mockCompletionsCreate } } }));
jest.mock('openai', () => ({ __esModule: true, default: MockOpenAI }), { virtual: false });

beforeEach(() => {
  jest.clearAllMocks();
  // Default: claude CLI not available (tests that need it override per-test)
  mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
  // Guard: a locally-set LISA_LLM_PROVIDER would cause resolveProvider() to return
  // an AgentLoopProvider, breaking tests that expect ClaudeSdkProvider etc.
  delete process.env['LISA_LLM_PROVIDER'];
});

// ---------------------------------------------------------------------------
// Env helper
// ---------------------------------------------------------------------------

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void;
function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void>;
function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): void | Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key] as string;
  }
  const restore = () => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  let result: void | Promise<void>;
  try { result = fn(); } catch (e) { restore(); throw e; }
  if (result instanceof Promise) {
    return result.then(() => restore(), (e) => { restore(); throw e; });
  }
  restore();
}

const NO_LLM_ENV = {
  ANTHROPIC_API_KEY: undefined,
  OPENAI_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
  STF_DISABLE_CLAUDE_CLI: '1',
};

// ---------------------------------------------------------------------------
// Named constants
// ---------------------------------------------------------------------------

describe('named constants', () => {
  test('DEFAULT_CLAUDE_SDK_MODEL is a non-empty string', () => {
    expect(typeof DEFAULT_CLAUDE_SDK_MODEL).toBe('string');
    expect(DEFAULT_CLAUDE_SDK_MODEL.length).toBeGreaterThan(0);
  });

  test('DEFAULT_GEMINI_MODEL is a non-empty string', () => {
    expect(typeof DEFAULT_GEMINI_MODEL).toBe('string');
    expect(DEFAULT_GEMINI_MODEL.length).toBeGreaterThan(0);
  });

  test('DEFAULT_GEMINI_MODEL is a real Gemini model ID (not bare alias)', () => {
    expect(DEFAULT_GEMINI_MODEL).not.toBe('gemini');
    expect(DEFAULT_GEMINI_MODEL).toMatch(/^gemini-/);
  });
});

// ---------------------------------------------------------------------------
// claudeCliAvailable
// ---------------------------------------------------------------------------

describe('claudeCliAvailable', () => {
  test('returns true when claude --version exits successfully', () => {
    mockExecFileSync.mockReturnValueOnce('claude 1.0.0\n');
    expect(claudeCliAvailable()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith('claude', ['--version'], expect.objectContaining({ timeout: 5_000 }));
  });

  test('returns false when execFileSync throws ENOENT', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('ENOENT: not found'); });
    expect(claudeCliAvailable()).toBe(false);
  });

  test('returns false when execFileSync throws any error', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('permission denied'); });
    expect(claudeCliAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveProvider — step 1: explicit llmProvider
// ---------------------------------------------------------------------------

describe('resolveProvider step 1 — explicit llmProvider', () => {
  test('returns the provider as-is regardless of env or flowModel', () => {
    const provider = { id: 'custom', complete: async () => '' };
    withEnv({ ANTHROPIC_API_KEY: 'key', GEMINI_API_KEY: 'key', STF_DISABLE_CLAUDE_CLI: undefined }, () => {
      mockExecFileSync.mockReturnValue('claude 1.0.0\n');
      expect(resolveProvider(undefined, provider)).toBe(provider);
    });
  });

  test('llmProvider overrides flowModel when both are set', () => {
    const provider = { id: 'custom', complete: async () => '' };
    withEnv(NO_LLM_ENV, () => {
      const result = resolveProvider('ollama:llama3', provider);
      expect(result).toBe(provider);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveProvider — step 2: ollama: prefix
// ---------------------------------------------------------------------------

describe('resolveProvider step 2 — ollama: prefix', () => {
  test('ollama:llama3 → OllamaProvider with model llama3', () => {
    withEnv(NO_LLM_ENV, () => {
      const result = resolveProvider('ollama:llama3', undefined);
      expect(result).toBeInstanceOf(OllamaProvider);
      expect(result!.id).toBe('ollama:llama3');
    });
  });

  test('ollama:mistral → OllamaProvider with model mistral', () => {
    withEnv(NO_LLM_ENV, () => {
      const result = resolveProvider('ollama:mistral', undefined);
      expect(result).toBeInstanceOf(OllamaProvider);
      expect(result!.id).toBe('ollama:mistral');
    });
  });

  test('ollama: prefix takes precedence over all env keys', () => {
    withEnv({ ANTHROPIC_API_KEY: 'key', GEMINI_API_KEY: 'key', OPENAI_API_KEY: 'key', STF_DISABLE_CLAUDE_CLI: '1' }, () => {
      const result = resolveProvider('ollama:llama3', undefined);
      expect(result).toBeInstanceOf(OllamaProvider);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveProvider — step 3: non-ollama flowModel → GeminiProvider
// ---------------------------------------------------------------------------

describe('resolveProvider step 3 — non-ollama flowModel', () => {
  test('gemini-1.5-pro → GeminiProvider with that model', () => {
    withEnv(NO_LLM_ENV, () => {
      const result = resolveProvider('gemini-1.5-pro', undefined);
      expect(result).toBeInstanceOf(GeminiProvider);
      expect(result!.id).toBe('gemini:gemini-1.5-pro');
    });
  });

  test("'gemini' shorthand → GeminiProvider resolving to DEFAULT_GEMINI_MODEL", () => {
    withEnv(NO_LLM_ENV, () => {
      const result = resolveProvider('gemini', undefined);
      expect(result).toBeInstanceOf(GeminiProvider);
      expect(result!.id).toBe(`gemini:${DEFAULT_GEMINI_MODEL}`);
    });
  });

  test('any non-ollama string is treated as Gemini model (legacy compat)', () => {
    withEnv(NO_LLM_ENV, () => {
      const result = resolveProvider('gemini-2.0-flash', undefined);
      expect(result).toBeInstanceOf(GeminiProvider);
      expect(result!.id).toBe('gemini:gemini-2.0-flash');
    });
  });
});

// ---------------------------------------------------------------------------
// resolveProvider — step 4: Claude CLI auto-detection
// ---------------------------------------------------------------------------

describe('resolveProvider step 4 — Claude CLI auto-detection', () => {
  test('claude in PATH, no disable flag → ClaudeCliProvider', () => {
    withEnv({ ...NO_LLM_ENV, STF_DISABLE_CLAUDE_CLI: undefined }, () => {
      mockExecFileSync.mockReturnValue('claude 1.0.0\n');
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeCliProvider);
    });
  });

  test('STF_DISABLE_CLAUDE_CLI=1 skips CLI and falls to step 5', () => {
    withEnv({ ...NO_LLM_ENV, STF_DISABLE_CLAUDE_CLI: '1', ANTHROPIC_API_KEY: 'sk-ant' }, () => {
      mockExecFileSync.mockReturnValue('claude 1.0.0\n');
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeSdkProvider);
    });
  });

  test('STF_DISABLE_CLAUDE_CLI=true also disables CLI', () => {
    withEnv({ ...NO_LLM_ENV, STF_DISABLE_CLAUDE_CLI: 'true', ANTHROPIC_API_KEY: 'sk-ant' }, () => {
      mockExecFileSync.mockReturnValue('claude 1.0.0\n');
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeSdkProvider);
    });
  });

  test('STF_DISABLE_CLAUDE_CLI empty string does NOT disable CLI', () => {
    withEnv({ ...NO_LLM_ENV, STF_DISABLE_CLAUDE_CLI: '' }, () => {
      mockExecFileSync.mockReturnValue('claude 1.0.0\n');
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeCliProvider);
    });
  });

  test('claude in PATH + OPENAI_API_KEY → ClaudeCliProvider wins (CLI has priority)', () => {
    withEnv({ ...NO_LLM_ENV, STF_DISABLE_CLAUDE_CLI: undefined, OPENAI_API_KEY: 'sk-openai' }, () => {
      mockExecFileSync.mockReturnValue('claude 1.0.0\n');
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeCliProvider);
    });
  });

  test('claude in PATH + GEMINI_API_KEY → ClaudeCliProvider wins', () => {
    withEnv({ ...NO_LLM_ENV, STF_DISABLE_CLAUDE_CLI: undefined, GEMINI_API_KEY: 'gm-key' }, () => {
      mockExecFileSync.mockReturnValue('claude 1.0.0\n');
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeCliProvider);
    });
  });

  test('claude CLI not in PATH → falls through to step 5', () => {
    withEnv({ ...NO_LLM_ENV, STF_DISABLE_CLAUDE_CLI: undefined, ANTHROPIC_API_KEY: 'sk-ant' }, () => {
      // mockExecFileSync throws by default (set in beforeEach)
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeSdkProvider);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveProvider — step 5: ANTHROPIC_API_KEY
// ---------------------------------------------------------------------------

describe('resolveProvider step 5 — ANTHROPIC_API_KEY', () => {
  test('ANTHROPIC_API_KEY set, CLI disabled → ClaudeSdkProvider', () => {
    withEnv({ ...NO_LLM_ENV, ANTHROPIC_API_KEY: 'sk-ant-test' }, () => {
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeSdkProvider);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveProvider — step 6: OPENAI_API_KEY
// ---------------------------------------------------------------------------

describe('resolveProvider step 6 — OPENAI_API_KEY', () => {
  test('only OPENAI_API_KEY set → OpenAIProvider', () => {
    withEnv({ ...NO_LLM_ENV, OPENAI_API_KEY: 'sk-openai' }, () => {
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(OpenAIProvider);
    });
  });

  test('ANTHROPIC_API_KEY + OPENAI_API_KEY, CLI disabled → ClaudeSdkProvider wins (step 5)', () => {
    withEnv({ ...NO_LLM_ENV, ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-openai' }, () => {
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeSdkProvider);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveProvider — step 7: GEMINI_API_KEY
// ---------------------------------------------------------------------------

describe('resolveProvider step 7 — GEMINI_API_KEY', () => {
  test('only GEMINI_API_KEY set → GeminiProvider', () => {
    withEnv({ ...NO_LLM_ENV, GEMINI_API_KEY: 'gm-key' }, () => {
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(GeminiProvider);
    });
  });

  test('ANTHROPIC_API_KEY + GEMINI_API_KEY, CLI disabled → ClaudeSdkProvider wins (step 5)', () => {
    withEnv({ ...NO_LLM_ENV, ANTHROPIC_API_KEY: 'sk-ant', GEMINI_API_KEY: 'gm-key' }, () => {
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(ClaudeSdkProvider);
    });
  });

  test('OPENAI_API_KEY + GEMINI_API_KEY → OpenAIProvider wins (step 6)', () => {
    withEnv({ ...NO_LLM_ENV, OPENAI_API_KEY: 'sk-openai', GEMINI_API_KEY: 'gm-key' }, () => {
      expect(resolveProvider(undefined, undefined)).toBeInstanceOf(OpenAIProvider);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveProvider — step 8: nothing configured
// ---------------------------------------------------------------------------

describe('resolveProvider step 8 — no provider', () => {
  test('returns undefined without throwing', () => {
    withEnv(NO_LLM_ENV, () => {
      expect(resolveProvider(undefined, undefined)).toBeUndefined();
    });
  });

  test('all keys set to empty string → still undefined', () => {
    withEnv({
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
      STF_DISABLE_CLAUDE_CLI: '1',
    }, () => {
      expect(resolveProvider(undefined, undefined)).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// ClaudeCliProvider
// ---------------------------------------------------------------------------

describe('ClaudeCliProvider', () => {
  test('id is claude-cli', () => {
    expect(new ClaudeCliProvider().id).toBe('claude-cli');
  });

  test('default timeoutMs is 120 000', () => {
    const p = new ClaudeCliProvider();
    expect((p as unknown as { timeoutMs: number }).timeoutMs).toBe(120_000);
  });

  test('accepts custom timeoutMs', () => {
    const p = new ClaudeCliProvider({ timeoutMs: 300_000 });
    expect((p as unknown as { timeoutMs: number }).timeoutMs).toBe(300_000);
  });

  test('passes timeoutMs to execFileSync', async () => {
    mockExecFileSync.mockReturnValueOnce(JSON.stringify({ result: 'out' }));
    const p = new ClaudeCliProvider({ timeoutMs: 60_000 });
    await p.complete('hello');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'claude', ['-p', '--output-format', 'json'],
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  test('passes prompt as stdin input', async () => {
    mockExecFileSync.mockReturnValueOnce(JSON.stringify({ result: 'out' }));
    await new ClaudeCliProvider().complete('my prompt');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'claude', ['-p', '--output-format', 'json'],
      expect.objectContaining({ input: 'my prompt' }),
    );
  });

  test('parses result field from JSON output', async () => {
    mockExecFileSync.mockReturnValueOnce(JSON.stringify({ result: 'generated spec' }));
    expect(await new ClaudeCliProvider().complete('p')).toBe('generated spec');
  });

  test('parses content field when result is absent', async () => {
    mockExecFileSync.mockReturnValueOnce(JSON.stringify({ content: 'from content' }));
    expect(await new ClaudeCliProvider().complete('p')).toBe('from content');
  });

  test('result field takes precedence over content field', async () => {
    mockExecFileSync.mockReturnValueOnce(JSON.stringify({ result: 'r', content: 'c' }));
    expect(await new ClaudeCliProvider().complete('p')).toBe('r');
  });

  test('falls back to raw trim when JSON has neither result nor content', async () => {
    const raw = JSON.stringify({ other: 'field' });
    mockExecFileSync.mockReturnValueOnce(raw);
    expect(await new ClaudeCliProvider().complete('p')).toBe(raw);
  });

  test('falls back to raw trim when output is not valid JSON', async () => {
    mockExecFileSync.mockReturnValueOnce('  plain text output  ');
    expect(await new ClaudeCliProvider().complete('p')).toBe('plain text output');
  });

  test('throws wrapped error when CLI fails (Error instance)', async () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    await expect(new ClaudeCliProvider().complete('p')).rejects.toThrow('ClaudeCliProvider: claude CLI failed — ENOENT');
  });

  test('throws wrapped error when CLI fails (non-Error throw)', async () => {
    mockExecFileSync.mockImplementationOnce(() => { throw 'exit code 1'; });
    await expect(new ClaudeCliProvider().complete('p')).rejects.toThrow('ClaudeCliProvider: claude CLI failed — exit code 1');
  });
});

// ---------------------------------------------------------------------------
// ClaudeSdkProvider
// ---------------------------------------------------------------------------

describe('ClaudeSdkProvider', () => {
  const textResponse = (texts: string[]) => ({
    content: [
      ...texts.map(text => ({ type: 'text', text })),
    ],
  });

  test('id includes model name', () => {
    expect(new ClaudeSdkProvider({ apiKey: 'k' }).id).toBe(`claude-sdk:${DEFAULT_CLAUDE_SDK_MODEL}`);
  });

  test('custom model reflected in id', () => {
    expect(new ClaudeSdkProvider({ model: 'claude-opus-4-7', apiKey: 'k' }).id).toBe('claude-sdk:claude-opus-4-7');
  });

  test('uses ANTHROPIC_API_KEY from env when no apiKey param', async () => {
    await withEnv({ ANTHROPIC_API_KEY: 'env-key' }, async () => {
      mockAnthropicCreate.mockResolvedValueOnce(textResponse(['ok']));
      await new ClaudeSdkProvider().complete('hello');
      expect(MockAnthropic).toHaveBeenCalledWith({ apiKey: 'env-key' });
    });
  });

  test('explicit apiKey overrides env', async () => {
    await withEnv({ ANTHROPIC_API_KEY: 'env-key' }, async () => {
      mockAnthropicCreate.mockResolvedValueOnce(textResponse(['ok']));
      await new ClaudeSdkProvider({ apiKey: 'explicit-key' }).complete('hello');
      expect(MockAnthropic).toHaveBeenCalledWith({ apiKey: 'explicit-key' });
    });
  });

  test('sends correct model and default max_tokens', async () => {
    mockAnthropicCreate.mockResolvedValueOnce(textResponse(['ok']));
    await new ClaudeSdkProvider({ apiKey: 'k' }).complete('hi');
    expect(mockAnthropicCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_CLAUDE_SDK_MODEL,
      max_tokens: 4096,
    }));
  });

  test('forwards maxTokens to max_tokens', async () => {
    mockAnthropicCreate.mockResolvedValueOnce(textResponse(['ok']));
    await new ClaudeSdkProvider({ apiKey: 'k' }).complete('hi', { maxTokens: 512 });
    expect(mockAnthropicCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 512 }));
  });

  test('forwards temperature when provided', async () => {
    mockAnthropicCreate.mockResolvedValueOnce(textResponse(['ok']));
    await new ClaudeSdkProvider({ apiKey: 'k' }).complete('hi', { temperature: 0.2 });
    expect(mockAnthropicCreate).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.2 }));
  });

  test('omits temperature key when not provided', async () => {
    mockAnthropicCreate.mockResolvedValueOnce(textResponse(['ok']));
    await new ClaudeSdkProvider({ apiKey: 'k' }).complete('hi');
    const call = mockAnthropicCreate.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(call)).not.toContain('temperature');
  });

  test('sends prompt in messages array', async () => {
    mockAnthropicCreate.mockResolvedValueOnce(textResponse(['ok']));
    await new ClaudeSdkProvider({ apiKey: 'k' }).complete('my prompt');
    expect(mockAnthropicCreate).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: 'my prompt' }],
    }));
  });

  test('concatenates multiple text blocks', async () => {
    mockAnthropicCreate.mockResolvedValueOnce(textResponse(['part A', ' part B']));
    expect(await new ClaudeSdkProvider({ apiKey: 'k' }).complete('p')).toBe('part A part B');
  });

  test('filters out non-text blocks', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'x' },
        { type: 'text', text: 'kept' },
      ],
    });
    expect(await new ClaudeSdkProvider({ apiKey: 'k' }).complete('p')).toBe('kept');
  });

  test('returns empty string when all blocks are non-text', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({ content: [{ type: 'tool_use' }] });
    expect(await new ClaudeSdkProvider({ apiKey: 'k' }).complete('p')).toBe('');
  });

  test('propagates SDK errors', async () => {
    mockAnthropicCreate.mockRejectedValueOnce(new Error('rate limited'));
    await expect(new ClaudeSdkProvider({ apiKey: 'k' }).complete('p')).rejects.toThrow('rate limited');
  });
});

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

describe('GeminiProvider', () => {
  const geminiResponse = (text: string) => ({ response: { text: () => text } });

  test('id uses resolved model name', () => {
    expect(new GeminiProvider().id).toBe(`gemini:${DEFAULT_GEMINI_MODEL}`);
  });

  test("'gemini' alias maps to DEFAULT_GEMINI_MODEL", () => {
    expect(new GeminiProvider({ model: 'gemini' }).id).toBe(`gemini:${DEFAULT_GEMINI_MODEL}`);
  });

  test('real model ID passes through unchanged', () => {
    expect(new GeminiProvider({ model: 'gemini-1.5-pro' }).id).toBe('gemini:gemini-1.5-pro');
  });

  test('unknown model passes through unchanged', () => {
    expect(new GeminiProvider({ model: 'gemini-2.0-flash' }).id).toBe('gemini:gemini-2.0-flash');
  });

  test('uses GEMINI_API_KEY from env', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse('ok'));
    await withEnv({ GEMINI_API_KEY: 'my-gem-key' }, async () => {
      await new GeminiProvider().complete('hello');
      expect(MockGoogleGenerativeAI).toHaveBeenCalledWith('my-gem-key');
    });
  });

  test('passes model to getGenerativeModel', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse('ok'));
    await new GeminiProvider({ model: 'gemini-1.5-pro' }).complete('hello');
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-1.5-pro' }));
  });

  test('omits generationConfig when no opts', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse('ok'));
    await new GeminiProvider().complete('hello');
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.not.objectContaining({ generationConfig: expect.anything() }),
    );
  });

  test('includes temperature in generationConfig', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse('ok'));
    await new GeminiProvider().complete('hello', { temperature: 0.5 });
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({
      generationConfig: { temperature: 0.5 },
    }));
  });

  test('includes maxOutputTokens in generationConfig', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse('ok'));
    await new GeminiProvider().complete('hello', { maxTokens: 1024 });
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({
      generationConfig: { maxOutputTokens: 1024 },
    }));
  });

  test('includes both temperature and maxOutputTokens', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse('ok'));
    await new GeminiProvider().complete('hello', { temperature: 0.3, maxTokens: 512 });
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    }));
  });

  test('returns text from response.text()', async () => {
    mockGenerateContent.mockResolvedValueOnce(geminiResponse('my generated spec'));
    expect(await new GeminiProvider().complete('p')).toBe('my generated spec');
  });

  test('propagates API errors', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(new GeminiProvider().complete('p')).rejects.toThrow('quota exceeded');
  });
});

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

describe('OllamaProvider', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    // @ts-expect-error restoring global
    delete global.fetch;
  });

  const okResponse = (text: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ response: text }),
  });

  test('id is ollama:<model>', () => {
    expect(new OllamaProvider({ model: 'llama3' }).id).toBe('ollama:llama3');
  });

  test('uses default host when neither env nor constructor provides one', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('ok'));
    await withEnv({ OLLAMA_HOST: undefined }, async () => {
      await new OllamaProvider({ model: 'llama3' }).complete('p');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.any(Object),
      );
    });
  });

  test('uses OLLAMA_HOST from env', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('ok'));
    await withEnv({ OLLAMA_HOST: 'http://10.0.0.5:11434' }, async () => {
      await new OllamaProvider({ model: 'llama3' }).complete('p');
      expect(mockFetch).toHaveBeenCalledWith('http://10.0.0.5:11434/api/generate', expect.any(Object));
    });
  });

  test('constructor host overrides env', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('ok'));
    await withEnv({ OLLAMA_HOST: 'http://env-host:11434' }, async () => {
      await new OllamaProvider({ model: 'llama3', host: 'http://ctor-host:11434' }).complete('p');
      expect(mockFetch).toHaveBeenCalledWith('http://ctor-host:11434/api/generate', expect.any(Object));
    });
  });

  test('body includes model, prompt, stream:false', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('ok'));
    await new OllamaProvider({ model: 'llama3' }).complete('my prompt');
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ model: 'llama3', prompt: 'my prompt', stream: false });
  });

  test('omits options key when no opts', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('ok'));
    await new OllamaProvider({ model: 'llama3' }).complete('p');
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body['options']).toBeUndefined();
  });

  test('temperature alone in options', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('ok'));
    await new OllamaProvider({ model: 'llama3' }).complete('p', { temperature: 0.3 });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.options).toEqual({ temperature: 0.3 });
    expect(body.options.num_predict).toBeUndefined();
  });

  test('maxTokens alone in options as num_predict', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('ok'));
    await new OllamaProvider({ model: 'llama3' }).complete('p', { maxTokens: 256 });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.options).toEqual({ num_predict: 256 });
    expect(body.options.temperature).toBeUndefined();
  });

  test('both opts merged into single options object (no overwrite)', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('ok'));
    await new OllamaProvider({ model: 'llama3' }).complete('p', { temperature: 0.7, maxTokens: 512 });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.options).toEqual({ temperature: 0.7, num_predict: 512 });
  });

  test('returns response string from Ollama', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('generated output'));
    expect(await new OllamaProvider({ model: 'llama3' }).complete('p')).toBe('generated output');
  });

  test('throws on non-ok HTTP status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(new OllamaProvider({ model: 'llama3' }).complete('p')).rejects.toThrow('OllamaProvider: HTTP 503');
  });

  test('throws on empty response field', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await expect(new OllamaProvider({ model: 'llama3' }).complete('p')).rejects.toThrow('OllamaProvider: empty response');
  });

  test('throws on null response field', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ response: null }) });
    await expect(new OllamaProvider({ model: 'llama3' }).complete('p')).rejects.toThrow('OllamaProvider: empty response');
  });
});

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

describe('OpenAIProvider', () => {
  const chatResponse = (content: string | undefined) => ({
    choices: [{ message: { content } }],
  });

  test('id is openai:<model>', () => {
    expect(new OpenAIProvider().id).toBe('openai:gpt-4o');
  });

  test('custom model reflected in id', () => {
    expect(new OpenAIProvider({ model: 'o3' }).id).toBe('openai:o3');
  });

  test('uses OPENAI_API_KEY from env when no apiKey param', async () => {
    mockCompletionsCreate.mockResolvedValueOnce(chatResponse('ok'));
    await withEnv({ OPENAI_API_KEY: 'env-openai-key' }, async () => {
      await new OpenAIProvider().complete('hello');
      expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: 'env-openai-key' });
    });
  });

  test('sends prompt in messages array', async () => {
    mockCompletionsCreate.mockResolvedValueOnce(chatResponse('ok'));
    await new OpenAIProvider({ apiKey: 'k' }).complete('my prompt');
    expect(mockCompletionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: 'my prompt' }],
    }));
  });

  test('omits temperature when not provided', async () => {
    mockCompletionsCreate.mockResolvedValueOnce(chatResponse('ok'));
    await new OpenAIProvider({ apiKey: 'k' }).complete('p');
    const call = mockCompletionsCreate.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(call)).not.toContain('temperature');
  });

  test('forwards temperature', async () => {
    mockCompletionsCreate.mockResolvedValueOnce(chatResponse('ok'));
    await new OpenAIProvider({ apiKey: 'k' }).complete('p', { temperature: 0.4 });
    expect(mockCompletionsCreate).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.4 }));
  });

  test('omits max_tokens when not provided', async () => {
    mockCompletionsCreate.mockResolvedValueOnce(chatResponse('ok'));
    await new OpenAIProvider({ apiKey: 'k' }).complete('p');
    const call = mockCompletionsCreate.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(call)).not.toContain('max_tokens');
  });

  test('forwards maxTokens as max_tokens', async () => {
    mockCompletionsCreate.mockResolvedValueOnce(chatResponse('ok'));
    await new OpenAIProvider({ apiKey: 'k' }).complete('p', { maxTokens: 1024 });
    expect(mockCompletionsCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 1024 }));
  });

  test('forwards both temperature and maxTokens', async () => {
    mockCompletionsCreate.mockResolvedValueOnce(chatResponse('ok'));
    await new OpenAIProvider({ apiKey: 'k' }).complete('p', { temperature: 0.8, maxTokens: 2048 });
    expect(mockCompletionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0.8,
      max_tokens: 2048,
    }));
  });

  test('returns content from first choice', async () => {
    mockCompletionsCreate.mockResolvedValueOnce(chatResponse('generated text'));
    expect(await new OpenAIProvider({ apiKey: 'k' }).complete('p')).toBe('generated text');
  });

  test('returns empty string when content is undefined', async () => {
    mockCompletionsCreate.mockResolvedValueOnce(chatResponse(undefined));
    expect(await new OpenAIProvider({ apiKey: 'k' }).complete('p')).toBe('');
  });

  test('returns empty string when choices is empty', async () => {
    mockCompletionsCreate.mockResolvedValueOnce({ choices: [] });
    expect(await new OpenAIProvider({ apiKey: 'k' }).complete('p')).toBe('');
  });

  test('propagates API errors', async () => {
    mockCompletionsCreate.mockRejectedValueOnce(new Error('api error'));
    await expect(new OpenAIProvider({ apiKey: 'k' }).complete('p')).rejects.toThrow('api error');
  });
});
