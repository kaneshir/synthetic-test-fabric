import type { LlmProvider } from './llm-provider';
import type { ToolCallingLlmProvider, ToolDefinition, Message, ToolResult } from './llm-providers/types';
import type { McpClient, McpTool } from './mcp-client';

export class AgentLoopProvider implements LlmProvider {
  readonly id: string;
  private readonly toolProvider: ToolCallingLlmProvider;
  private readonly mcpClient: McpClient;
  private readonly maxIterations: number;

  constructor(
    toolProvider: ToolCallingLlmProvider,
    mcpClient: McpClient,
    { maxIterations = 10 }: { maxIterations?: number } = {},
  ) {
    this.toolProvider = toolProvider;
    this.mcpClient = mcpClient;
    this.maxIterations = maxIterations;
    this.id = `agent-loop:${toolProvider.id}`;
  }

  async complete(prompt: string): Promise<string> {
    await this.mcpClient.spawn();

    try {
      const mcpTools: McpTool[] = await this.mcpClient.getTools();
      const tools: ToolDefinition[] = mcpTools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      }));

      const messages: Message[] = [{ role: 'user', content: prompt }];
      let lastText = '';

      for (let i = 0; i < this.maxIterations; i++) {
        const response = await this.toolProvider.chat({ messages, tools });

        if (!response.toolCalls || response.toolCalls.length === 0) {
          return response.content ?? lastText;
        }

        if (response.content) lastText = response.content;
        messages.push({ role: 'assistant', toolCalls: response.toolCalls });

        const toolResults: ToolResult[] = [];
        for (const tc of response.toolCalls) {
          let content: string;
          try {
            const result = await this.mcpClient.callTool(
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
      this.mcpClient.close();
    }
  }
}
