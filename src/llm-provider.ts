import { execFileSync } from 'child_process';
import * as path from 'path';
import { AgentLoopProvider } from './agent-loop';
import { resolveToolCallingProvider } from './llm-providers';
import { McpClient } from './mcp-client';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LlmProvider {
  /** Stable identifier used in logs and artifacts (e.g. 'claude-cli', 'claude-sdk:claude-sonnet-4-6'). */
  readonly id: string;
  complete(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Claude CLI provider
// ---------------------------------------------------------------------------

/**
 * Spawns the claude CLI subprocess. Uses Claude.ai subscription — no API key required.
 * Requires `claude` to be in PATH (install: https://claude.ai/download).
 *
 * Note: temperature and maxTokens passed to complete() are silently ignored.
 * The CLI does not expose those controls. Use ClaudeSdkProvider if you need
 * fine-grained generation parameters.
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly id = 'claude-cli';
  private readonly timeoutMs: number;

  constructor({ timeoutMs = 120_000 }: { timeoutMs?: number } = {}) {
    this.timeoutMs = timeoutMs;
  }

  async complete(prompt: string): Promise<string> {
    let raw: string;
    try {
      raw = execFileSync('claude', ['-p', '--output-format', 'json'], {
        input: prompt,
        encoding: 'utf8',
        timeout: this.timeoutMs,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`ClaudeCliProvider: claude CLI failed — ${msg}`);
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const text = parsed['result'] ?? parsed['content'];
      if (typeof text === 'string') return text;
    } catch {
      // fall through to raw trim
    }
    return raw.trim();
  }
}

export function claudeCliAvailable(): boolean {
  try {
    execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Claude SDK provider
// ---------------------------------------------------------------------------

/**
 * Default model for ClaudeSdkProvider.
 * Verify against https://docs.anthropic.com/en/docs/about-claude/models/overview
 * before each major release.
 */
export const DEFAULT_CLAUDE_SDK_MODEL = 'claude-sonnet-4-6';

/**
 * Calls the Anthropic API via the @anthropic-ai/sdk package.
 * Requires ANTHROPIC_API_KEY or an explicit apiKey constructor option.
 * Peer dependency: npm install @anthropic-ai/sdk
 */
export class ClaudeSdkProvider implements LlmProvider {
  readonly id: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor({ model = DEFAULT_CLAUDE_SDK_MODEL, apiKey }: { model?: string; apiKey?: string } = {}) {
    this.model = model;
    this.id = `claude-sdk:${model}`;
    this.apiKey = apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
  }

  async complete(prompt: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('@anthropic-ai/sdk' as string).catch(() => {
      throw new Error('ClaudeSdkProvider requires @anthropic-ai/sdk. Run: npm install @anthropic-ai/sdk');
    }) as { default: new (opts: { apiKey: string }) => any };
    const client = new mod.default({ apiKey: this.apiKey });
    const response = await client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      messages: [{ role: 'user', content: prompt }],
    }) as { content: Array<{ type: string; text?: string }> };
    return response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
  }
}

// ---------------------------------------------------------------------------
// Gemini provider
// ---------------------------------------------------------------------------

/**
 * Default model for GeminiProvider.
 * Verify against Google's generative AI model list before each major release.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-1.5-pro';

const GEMINI_ALIASES: Record<string, string> = {
  gemini: DEFAULT_GEMINI_MODEL,
};

/**
 * Calls the Google Generative AI API via the @google/generative-ai package.
 * Requires GEMINI_API_KEY.
 * Peer dependency: npm install @google/generative-ai
 */
export class GeminiProvider implements LlmProvider {
  readonly id: string;
  private readonly model: string;

  constructor({ model = DEFAULT_GEMINI_MODEL }: { model?: string } = {}) {
    this.model = GEMINI_ALIASES[model] ?? model;
    this.id = `gemini:${this.model}`;
  }

  async complete(prompt: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('@google/generative-ai' as string).catch(() => {
      throw new Error('GeminiProvider requires @google/generative-ai. Run: npm install @google/generative-ai');
    }) as { GoogleGenerativeAI: new (key: string) => any };
    const client = new mod.GoogleGenerativeAI(process.env['GEMINI_API_KEY'] ?? '');
    const genConfig: Record<string, number> = {};
    if (opts.temperature !== undefined) genConfig['temperature'] = opts.temperature;
    if (opts.maxTokens !== undefined) genConfig['maxOutputTokens'] = opts.maxTokens;
    const genModel = client.getGenerativeModel({
      model: this.model,
      ...(Object.keys(genConfig).length > 0 ? { generationConfig: genConfig } : {}),
    });
    const result = await genModel.generateContent(prompt) as { response: { text: () => string } };
    return result.response.text();
  }
}

// ---------------------------------------------------------------------------
// Ollama provider
// ---------------------------------------------------------------------------

/**
 * Calls a local Ollama instance via its HTTP API.
 * No API key required. Reads OLLAMA_HOST (default: http://localhost:11434).
 */
export class OllamaProvider implements LlmProvider {
  readonly id: string;
  private readonly model: string;
  private readonly host: string;

  constructor({ model, host }: { model: string; host?: string }) {
    this.model = model;
    this.host = host ?? process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';
    this.id = `ollama:${model}`;
  }

  async complete(prompt: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const res = await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        ...(() => {
          const o: Record<string, number> = {};
          if (opts.temperature !== undefined) o['temperature'] = opts.temperature;
          if (opts.maxTokens !== undefined) o['num_predict'] = opts.maxTokens;
          return Object.keys(o).length > 0 ? { options: o } : {};
        })(),
      }),
    });
    if (!res.ok) throw new Error(`OllamaProvider: HTTP ${res.status} from ${this.host}`);
    const data = await res.json() as { response?: string };
    if (!data.response) throw new Error('OllamaProvider: empty response from Ollama');
    return data.response;
  }
}

// ---------------------------------------------------------------------------
// OpenAI provider
// ---------------------------------------------------------------------------

/**
 * Calls the OpenAI API via the openai package (covers GPT-4o, Codex, o3, etc.).
 * Requires OPENAI_API_KEY or an explicit apiKey constructor option.
 * Peer dependency: npm install openai
 */
export class OpenAIProvider implements LlmProvider {
  readonly id: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor({ model = 'gpt-4o', apiKey }: { model?: string; apiKey?: string } = {}) {
    this.model = model;
    this.id = `openai:${model}`;
    this.apiKey = apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
  }

  async complete(prompt: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('openai' as string).catch(() => {
      throw new Error('OpenAIProvider requires openai. Run: npm install openai');
    }) as { default: new (opts: { apiKey: string }) => any };
    const client = new mod.default({ apiKey: this.apiKey });
    const response = await client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    }) as { choices: Array<{ message?: { content?: string } }> };
    return response.choices[0]?.message?.content ?? '';
  }
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Resolves which LlmProvider to use for GENERATE_FLOWS based on options and env vars.
 *
 * Resolution order:
 *  1. llmProvider option set → use directly
 *  2. LISA_LLM_PROVIDER env var → AgentLoopProvider (wraps ToolCallingLlmProvider + McpClient)
 *  3. flowModel starts with 'ollama:' → OllamaProvider
 *  4. flowModel set (any other string) → GeminiProvider (legacy compat)
 *  5. claude CLI in PATH and STF_DISABLE_CLAUDE_CLI unset → ClaudeCliProvider (new default)
 *  6. ANTHROPIC_API_KEY set → ClaudeSdkProvider
 *  7. OPENAI_API_KEY set → OpenAIProvider
 *  8. GEMINI_API_KEY set → GeminiProvider
 *  9. None → undefined (caller should skip generation)
 *
 * Pass iterRoot to get a correctly scoped LISA_MEMORY_DIR for the agentic loop.
 * Set STF_DISABLE_CLAUDE_CLI=1 to skip step 5 in CI environments where the
 * claude CLI is installed but you want API-key-based providers instead.
 */
export function resolveProvider(
  flowModel: string | undefined,
  llmProvider: LlmProvider | undefined,
  { iterRoot }: { iterRoot?: string } = {},
): LlmProvider | undefined {
  // 1. Explicit provider wins
  if (llmProvider) return llmProvider;

  // 2. LISA_LLM_PROVIDER → AgentLoopProvider (tool-calling agentic loop via lisa-mcp)
  const toolProvider = resolveToolCallingProvider();
  if (toolProvider) {
    const memoryDir = iterRoot
      ? path.join(iterRoot, '.lisa_memory')
      : path.join(process.cwd(), '.stf', '.lisa_memory');
    return new AgentLoopProvider(toolProvider, new McpClient({ memoryDir }));
  }

  // 3. ollama: prefix
  if (flowModel?.startsWith('ollama:')) {
    return new OllamaProvider({ model: flowModel.slice(7) });
  }

  // 4. Any other flowModel string → Gemini (legacy)
  if (flowModel) {
    return new GeminiProvider({ model: flowModel });
  }

  // 5. Claude CLI auto-detection
  if (!process.env['STF_DISABLE_CLAUDE_CLI'] && claudeCliAvailable()) {
    return new ClaudeCliProvider();
  }

  // 6. Anthropic SDK
  if (process.env['ANTHROPIC_API_KEY']) {
    return new ClaudeSdkProvider();
  }

  // 7. OpenAI
  if (process.env['OPENAI_API_KEY']) {
    return new OpenAIProvider();
  }

  // 8. Gemini
  if (process.env['GEMINI_API_KEY']) {
    return new GeminiProvider();
  }

  // 9. Nothing configured
  return undefined;
}
