export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  Message,
  ChatResponse,
  ChatOptions,
  ToolCallingLlmProvider,
} from './types';
export { AnthropicToolCallingProvider } from './anthropic';
export { OpenAIToolCallingProvider } from './openai';
export { GeminiToolCallingProvider } from './gemini';

import type { ToolCallingLlmProvider } from './types';
import { AnthropicToolCallingProvider } from './anthropic';
import { OpenAIToolCallingProvider } from './openai';
import { GeminiToolCallingProvider } from './gemini';

/**
 * Resolve a ToolCallingLlmProvider from LISA_LLM_PROVIDER env var.
 * Returns undefined when LISA_LLM_PROVIDER is unset — caller falls back to
 * the existing LlmProvider / Claude CLI default path.
 */
export function resolveToolCallingProvider(): ToolCallingLlmProvider | undefined {
  const p = process.env['LISA_LLM_PROVIDER'];
  if (!p) return undefined;

  const lower = p.toLowerCase();
  if (lower === 'anthropic' || lower === 'claude') {
    return new AnthropicToolCallingProvider();
  }
  if (lower === 'openai') {
    return new OpenAIToolCallingProvider();
  }
  if (lower === 'gemini') {
    return new GeminiToolCallingProvider();
  }
  throw new Error(
    `Unknown LISA_LLM_PROVIDER: "${p}". Valid values: anthropic, openai, gemini`,
  );
}
