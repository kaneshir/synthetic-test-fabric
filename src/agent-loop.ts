import type { LlmProvider } from './llm-provider';
import type { ToolCallingLlmProvider, ToolDefinition, Message, ToolResult } from './llm-providers/types';
import type { McpClient, McpTool } from './mcp-client';

export class AgentLoopProvider implements LlmProvider {
  readonly id: string;
  private readonly toolProvider: ToolCallingLlmProvider;
  private readonly mcpClientFactory: () => McpClient;
  private readonly maxIterations: number;

  constructor(
    toolProvider: ToolCallingLlmProvider,
    mcpClientFactory: () => McpClient,
    { maxIterations = 10 }: { maxIterations?: number } = {},
  ) {
    this.toolProvider = toolProvider;
    this.mcpClientFactory = mcpClientFactory;
    this.maxIterations = maxIterations;
    this.id = `agent-loop:${toolProvider.id}`;
  }

  async complete(
    prompt: string,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    // Fresh client per call — each complete() owns its own process, buffer, and pending map.
    const client = this.mcpClientFactory();
    try {
      // spawn() is inside try so close() is called even if the initialize handshake fails.
      await client.spawn();

      const mcpTools: McpTool[] = await client.getTools();
      const tools: ToolDefinition[] = mcpTools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      }));

      const messages: Message[] = [{ role: 'user', content: prompt }];
      let lastText = '';

      for (let i = 0; i < this.maxIterations; i++) {
        const response = await this.toolProvider.chat({ messages, tools, options });

        if (!response.toolCalls || response.toolCalls.length === 0) {
          return response.content ?? lastText;
        }

        if (response.content) lastText = response.content;
        messages.push({ role: 'assistant', toolCalls: response.toolCalls });

        const toolResults: ToolResult[] = [];
        for (const tc of response.toolCalls) {
          let content: string;
          try {
            const result = await client.callTool(
              tc.name,
              tc.args as Record<string, unknown>,
            );
            content = result.content
              .filter(c => c.type === 'text')
              .map(c => c.text ?? '')
              .join('\n');
          } catch (err) {
            content = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          toolResults.push({ toolCallId: tc.id, content });
        }

        messages.push({ role: 'user', toolResults });
      }

      return lastText || '[agent-loop: maxIterations reached without text response]';
    } finally {
      client.close();
    }
  }
}
