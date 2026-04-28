import type { ToolCallingLlmProvider, ToolDefinition, Message, ChatResponse, ChatOptions } from './types';

export class GeminiToolCallingProvider implements ToolCallingLlmProvider {
  readonly id: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor({ model = 'gemini-1.5-pro', apiKey }: { model?: string; apiKey?: string } = {}) {
    this.model = model;
    this.id = `gemini-tool:${model}`;
    this.apiKey = apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
  }

  async chat({ messages, tools, options = {} }: {
    messages: Message[];
    tools: ToolDefinition[];
    options?: ChatOptions;
  }): Promise<ChatResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('@google/generative-ai' as string).catch(() => {
      throw new Error('GeminiToolCallingProvider requires @google/generative-ai');
    }) as { GoogleGenerativeAI: new (key: string) => any };

    const client = new mod.GoogleGenerativeAI(this.apiKey);
    const genConfig: Record<string, number> = {};
    if (options.temperature !== undefined) genConfig['temperature'] = options.temperature;
    if (options.maxTokens !== undefined) genConfig['maxOutputTokens'] = options.maxTokens;

    const genModel = client.getGenerativeModel({
      model: this.model,
      ...(Object.keys(genConfig).length > 0 ? { generationConfig: genConfig } : {}),
      tools: [{
        // SDK uses camelCase functionDeclarations
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }],
    });

    const contents = this.formatMessages(messages);
    const result = await genModel.generateContent({ contents }) as {
      response: {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              functionCall?: { name: string; args: unknown };
            }>;
          };
        }>;
        text(): string;
      };
    };

    const parts = result.response.candidates?.[0]?.content?.parts ?? [];

    const toolCalls = parts
      .filter(p => p.functionCall)
      .map((p, i) => ({
        id: `gemini-call-${i}`,  // Gemini doesn't provide call IDs — generate positional ones
        name: p.functionCall!.name,
        args: this.safeParseArgs(p.functionCall!.args),
      }));

    const text = parts
      .filter(p => p.text)
      .map(p => p.text!)
      .join('');

    return {
      ...(text ? { content: text } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  private formatMessages(messages: Message[]): unknown[] {
    const result: unknown[] = [];
    // Gemini's functionResponse.name must match the declared function name, not the
    // synthetic ID (gemini-call-N). Populate this map when we see an assistant turn so
    // the next user/tool-result turn can look up the real name.
    const toolNameById = new Map<string, string>();

    for (const msg of messages) {
      if (msg.role === 'user' && msg.toolResults) {
        result.push({
          role: 'user',
          parts: msg.toolResults.map(r => ({
            functionResponse: {
              name: toolNameById.get(r.toolCallId) ?? r.toolCallId,
              response: { content: r.content },
            },
          })),
        });
      } else if (msg.role === 'assistant' && msg.toolCalls) {
        toolNameById.clear();
        for (const tc of msg.toolCalls) {
          toolNameById.set(tc.id, tc.name);
        }
        result.push({
          role: 'model',
          parts: msg.toolCalls.map(tc => ({
            functionCall: { name: tc.name, args: tc.args },
          })),
        });
      } else {
        result.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content ?? '' }],
        });
      }
    }
    return result;
  }

  private safeParseArgs(args: unknown): Record<string, unknown> {
    if (typeof args === 'object' && args !== null) return args as Record<string, unknown>;
    if (typeof args === 'string') {
      try { return JSON.parse(args); } catch { return {}; }
    }
    return {};
  }
}
