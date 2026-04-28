// ---------------------------------------------------------------------------
// Tool-calling types — separate from the existing LlmProvider.complete() path
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export interface ToolCall {
  id: string; // required — must be preserved into ToolResult for second-turn correlation
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content?: string;
  toolCalls?: ToolCall[];   // populated on assistant messages when model requests tools
  toolResults?: ToolResult[]; // populated on user messages returning tool results
}

export interface ChatResponse {
  content?: string;
  toolCalls?: ToolCall[];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Tool-calling LLM provider interface.
 * Separate from LlmProvider.complete() — for models that support structured tool calls.
 */
export interface ToolCallingLlmProvider {
  readonly id: string;
  chat(params: {
    messages: Message[];
    tools: ToolDefinition[];
    options?: ChatOptions;
  }): Promise<ChatResponse>;
}
