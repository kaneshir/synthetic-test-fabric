import type { ToolCallingLlmProvider, ToolDefinition, Message, ChatResponse, ChatOptions } from './types';

export class OpenAIToolCallingProvider implements ToolCallingLlmProvider {
  readonly id: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor({ model = 'gpt-4o', apiKey }: { model?: string; apiKey?: string } = {}) {
    this.model = model;
    this.id = `openai-tool:${model}`;
    this.apiKey = apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
  }

  async chat({ messages, tools, options = {} }: {
    messages: Message[];
    tools: ToolDefinition[];
    options?: ChatOptions;
  }): Promise<ChatResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('openai' as string).catch(() => {
      throw new Error('OpenAIToolCallingProvider requires openai');
    }) as { default: new (opts: { apiKey: string }) => any };

    const client = new mod.default({ apiKey: this.apiKey });

    const response = await client.chat.completions.create({
      model: this.model,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      messages: this.formatMessages(messages),
    }) as { choices: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };

    const msg = response.choices[0]?.message;
    if (!msg) return {};

    const toolCalls = (msg.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      args: this.safeParseArgs(tc.function.arguments),
    }));

    return {
      // content may be null on tool-only responses — treat as absent
      ...(msg.content ? { content: msg.content } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  private formatMessages(messages: Message[]): unknown[] {
    const result: unknown[] = [];
    for (const msg of messages) {
      if (msg.role === 'user' && msg.toolResults) {
        // Each tool result is a separate tool message
        for (const r of msg.toolResults) {
          result.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
        }
      } else if (msg.role === 'assistant' && msg.toolCalls) {
        result.push({
          role: 'assistant',
          content: msg.content ?? null,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
      } else {
        result.push({ role: msg.role, content: msg.content ?? '' });
      }
    }
    return result;
  }

  private safeParseArgs(args: string): Record<string, unknown> {
    try { return JSON.parse(args); } catch { return {}; }
  }
}
