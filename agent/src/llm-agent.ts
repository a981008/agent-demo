import Anthropic from '@anthropic-ai/sdk';
import { MCPClient } from './mcp-client.js';
import { globalSkillSystem } from './skill.js';
import { AgentConfig } from './config.js';
import { createLogger } from './logger.js';
import { estimateTokens } from './utils.js';

const log = createLogger('LLM');
const errorLogger = createLogger('Error');

interface MessageContent {
  role: 'user' | 'assistant';
  content: Anthropic.MessageParam['content'];
}

export class LLMAgent {
  private mcpClients: Map<string, MCPClient> = new Map();
  private anthropic: Anthropic;
  private model: string;
  private conversationHistory: MessageContent[] = [];
  private skillEnabled: boolean = true;
  private resourceUriMap: Map<string, string> = new Map();
  private toolsCache: any[] | null = null;

  constructor(config: AgentConfig) {
    this.anthropic = new Anthropic({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
    });
    this.model = config.llm.model;
    this.skillEnabled = config.skillEnabled !== false;
  }

  async connect(mcpServers?: { name: string; command: string; args: string[] }[]): Promise<void> {
    if (mcpServers) {
      // 连接 MCP 服务器
      for (const server of mcpServers) {
        const client = new MCPClient();
        await client.connect(server.command, server.args);
        this.mcpClients.set(server.name, client);
        globalSkillSystem.registerMcpClient(server.name, client);
        log.info(`已连接: ${server.name}`);
      }
      // 清除工具缓存，强制重新加载
      this.toolsCache = null;
    }
  }

  async chat(message: string): Promise<string> {
    const tools = this.toolsCache ?? (await this.listTools());

    this.conversationHistory.push({
      role: 'user',
      content: [{ type: 'text', text: message }],
    });

    log.debug('提示词\n{}', JSON.stringify({ messages: this.conversationHistory, tools }));

    let response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1024,
      tools,
      messages: this.conversationHistory,
    });

    while (this.hasToolCalls(response)) {
      const toolCalls = this.extractToolCalls(response);
      const results = await this.executeToolCalls(toolCalls);

      this.conversationHistory.push({
        role: 'assistant',
        content: response.content,
      });

      for (const { toolCall, result } of results) {
        this.conversationHistory.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: this.formatToolResult(result),
            },
          ],
        });
      }

      response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 1024,
        tools,
        messages: this.conversationHistory,
      });
    }

    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    const contextTokens = this.estimateContextTokens();
    log.debug(`Token 当前上下文: ${contextTokens}`);
    return this.getTextResponse(response);
  }

  private estimateContextTokens(): number {
    const text = JSON.stringify(this.conversationHistory);
    return estimateTokens(text);
  }

  private hasToolCalls(response: any): boolean {
    return response.content.some((c: any) => c.type === 'tool_use');
  }

  private extractToolCalls(response: any): any[] {
    return response.content.filter((c: any) => c.type === 'tool_use');
  }

  private async executeToolCalls(toolCalls: any[]): Promise<any[]> {
    log.debug(
      '工具调用',
      toolCalls.map((tc) => tc.name),
    );
    const results = await Promise.all(
      toolCalls.map(async (toolCall) => {
        log.debug(`调用 -> ${toolCall.name}(${JSON.stringify(toolCall.input)})`);
        const result = await this.callTool(toolCall.name, toolCall.input);
        log.debug(`结果 <- ${JSON.stringify(result).slice(0, 100)}`);
        return { toolCall, result };
      }),
    );
    return results;
  }

  private async callTool(name: string, args: any): Promise<any> {
    // 使用 Skill（name 前缀为 skill_）
    if (this.skillEnabled && name.startsWith('skill_')) {
      const skillName = name.replace(/^skill_/, '');
      const skill = globalSkillSystem.getSkill(skillName);
      if (skill) {
        const skillResult = (await globalSkillSystem.invoke(skillName, args)).data;
        return skillResult;
      }
    }

    // 使用 MCP 工具
    for (const [, client] of this.mcpClients) {
      try {
        // Prompt 调用
        if (name.startsWith('prompt_')) {
          const promptName = name.replace(/^prompt_/, '');
          log.debug(`调用 Prompt -> ${promptName}(${JSON.stringify(args)})`);
          try {
            const result = await client.callPrompt(promptName, args);
            log.debug(`Prompt 结果 <- ${JSON.stringify(result).slice(0, 100)}`);
            return result;
          } catch (e) {
            log.debug(`Prompt 错误: ${e}`);
            throw e;
          }
        }
        // Resource 调用
        if (name.startsWith('resource_')) {
          const resourceName = name.replace(/^resource_/, '');
          const resourceUri = args?.uri || this.resourceUriMap.get(resourceName) || resourceName;
          log.debug(`读取 Resource -> ${resourceUri}`);
          try {
            const result = {
              content: [{ text: await client.readResource(resourceUri) }],
            };
            log.debug(`Resource 结果 <- ${JSON.stringify(result).slice(0, 100)}`);
            return result;
          } catch (e) {
            log.debug(`Resource 错误: ${e}`);
            throw e;
          }
        }
        return await client.callTool(name, args);
      } catch (e) {
        const msg = String(e);
        if (msg.includes('not found') || msg.includes('Method not found')) {
          continue;
        }
        throw e;
      }
    }

    throw new Error('Unknown tool');
  }

  async listTools(): Promise<any[]> {
    const tools: any[] = [];

    // 只在 skill 开启时添加 skill 工具
    if (this.skillEnabled) {
      for (const tool of globalSkillSystem.getTools()) {
        tools.push(tool);
      }
    }

    for (const [, client] of this.mcpClients) {
      try {
        const [mcpTools, prompts, resources] = await Promise.all([
          client.listTools(),
          client.listPrompts(),
          client.listResources(),
        ]);
        for (const tool of mcpTools) {
          tools.push({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          });
        }
        for (const prompt of prompts) {
          const properties: Record<string, any> = {};
          const required: string[] = [];
          const args = prompt.arguments || [];
          for (const arg of args) {
            properties[arg.name] = {
              type: 'string',
              description: arg.description || '',
            };
            if (arg.required) {
              required.push(arg.name);
            }
          }
          tools.push({
            name: `prompt_${prompt.name}`,
            description: prompt.description || `Prompt: ${prompt.name}`,
            input_schema: { type: 'object', properties, required },
          });
        }
        for (const resource of resources) {
          this.resourceUriMap.set(resource.name, resource.uri);
          tools.push({
            name: `resource_${resource.name}`,
            description: resource.description || `Resource: ${resource.name}`,
            input_schema: { type: 'object', properties: {}, required: [] },
          });
        }
      } catch (e) {
        errorLogger.debug(`加载 prompt/resource 失败: ${e}`);
      }
    }

    this.toolsCache = tools;
    return tools;
  }

  private formatToolResult(result: any): string {
    try {
      const text = result?.content?.[0]?.text || result?.text || JSON.stringify(result);
      return typeof text === 'string' ? text : JSON.stringify(text);
    } catch {
      return JSON.stringify(result);
    }
  }

  private getTextResponse(response: any): string {
    const text = response.content.find((c: any) => c.type === 'text');
    return text?.text || '';
  }

  disconnect(): void {
    for (const client of this.mcpClients.values()) {
      client.disconnect();
    }
  }
}
