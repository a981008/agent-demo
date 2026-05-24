import { readFileSync } from 'fs';
import { resolveEnvVar } from './utils.js';

export interface LLMSConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
}

export interface AgentConfig {
  llm: LLMSConfig;
  mcpServers?: MCPServerConfig[];
  skillEnabled?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(path: string = 'agent.config.json'): AgentConfig {
  const content = readFileSync(path, 'utf-8');
  const config: AgentConfig = JSON.parse(content);

  // 解析环境变量占位符
  if (config.llm?.baseUrl) {
    config.llm.baseUrl = resolveEnvVar(config.llm.baseUrl);
  }
  if (config.llm?.apiKey) {
    config.llm.apiKey = resolveEnvVar(config.llm.apiKey);
  }
  if (config.llm?.model) {
    config.llm.model = resolveEnvVar(config.llm.model);
  }

  return config;
}
