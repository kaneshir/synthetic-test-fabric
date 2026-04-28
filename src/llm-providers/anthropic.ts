import type { ToolCallingLlmProvider, ToolDefinition, Message, ChatResponse, ChatOptions } from './types';

export class AnthropicToolCallingProvider implements ToolCallingLlmProvider {
  readonly id: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor({ model = 'claude-sonnet-4-6', apiKey }: { model?: string; apiKey?: string } = {}) {
    this.model = model;
    this.id = `anthropic-tool:${model}`;
    this.apiKey = apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
  }

  async chat({ messages, tools, options = {} }: {
    messages: Message[];
    tools: ToolDefinition[];
    options?: ChatOptions;
  }): Promise<ChatResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('@anthropic-ai/sdk' as string).catch(() => {
      throw new Error('AnthropicToolCallingProvider requires @anthropic-ai/sdk');
    }) as { default: new (opts: { apiKey: string }) => any };

    const client = new mod.default({ apiKey: this.apiKey });

    const response = await client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 4096,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      messages: this.formatMessages(messages),
    }) as { content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }> };

    const toolCalls = response.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        id: b.id!,
        name: b.name!,
        args: this.safeParseArgs(b.input),
      }));

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('');

    return {
      ...(text ? { content: text } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  private formatMessages(messages: Message[]): unknown[] {
    const result: unknown[] = [];
    for (const msg of messages) {
      if (msg.role === 'user' && msg.toolResults) {
        // Tool results go in a user message as tool_result content blocks
        result.push({
          role: 'user',
          content: msg.toolResults.map(r => ({
            type: 'tool_result',
            tool_use_id: r.toolCallId,
            content: r.content,
          })),
        });
      } else if (msg.role === 'assistant' && msg.toolCalls) {
        result.push({
          role: 'assistant',
          content: msg.toolCalls.map(tc => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.args,
          })),
        });
      } else {
        result.push({ role: msg.role, content: msg.content ?? '' });
      }
    }
    return result;
  }

  private safeParseArgs(input: unknown): Record<string, unknown> {
    if (typeof input === 'object' && input !== null) return input as Record<string, unknown>;
    if (typeof input === 'string') {
      try { return JSON.parse(input); } catch { return {}; }
    }
    return {};
  }
}
