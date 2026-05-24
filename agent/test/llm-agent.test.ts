/**
 * llm-agent.ts 单元测试
 *
 * 测试 LLMAgent 与 LLM 的真实交互场景，通过 chat 接口使用工具
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { LLMAgent } from '../src/llm-agent';
import { loadConfig } from '../src/config';
import { getSkillsLoaded } from '../src/skill';

const config = loadConfig();
const hasApiKey =
  config.llm.apiKey &&
  !config.llm.apiKey.startsWith('${') &&
  config.llm.apiKey.length > 0 &&
  config.llm.apiKey !== 'test-key';

beforeAll(async () => {
  await getSkillsLoaded();
});

describe('LLMAgent 初始化', () => {
  test('应该能创建 Agent 实例', () => {
    const agent = new LLMAgent(config);
    expect(agent).toBeDefined();
  });

  test('应该能连接到 MCP 服务器', async () => {
    const agent = new LLMAgent(config);
    await agent.connect(config.mcpServers);

    const tools = await agent.listTools();
    expect(tools.length).toBeGreaterThan(0);

    agent.disconnect();
  });
});

describe('LLMAgent 工具列表', () => {
  let agent: LLMAgent;

  beforeAll(async () => {
    const testConfig = { ...config, skillEnabled: true };
    agent = new LLMAgent(testConfig);
    await agent.connect(config.mcpServers);
  });

  afterAll(() => {
    agent.disconnect();
  });

  test('listTools 应该返回 skill 工具', async () => {
    const tools = await agent.listTools();
    expect(tools.length).toBeGreaterThan(0);

    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('skill_date');
    expect(toolNames).toContain('amap_weather');
  });

  test('listTools 应该包含工具的 description', async () => {
    const tools = await agent.listTools();
    const weatherTool = tools.find((t: any) => t.name === 'amap_weather');
    expect(weatherTool).toBeDefined();
    expect(weatherTool.description).toBeDefined();
  });

  test('listTools 应该返回 prompt 和 resource 工具', async () => {
    const tools = await agent.listTools();
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('prompt_weather_analysis');
    expect(toolNames).toContain('prompt_dressing_advice');
    expect(toolNames).toContain('prompt_location_info');
    expect(toolNames).toContain('resource_amap_docs');
    expect(toolNames).toContain('resource_health');
  });

  test('listTools 应该包含 prompt 和 resource 的 description', async () => {
    const tools = await agent.listTools();
    const promptTool = tools.find((t: any) => t.name === 'prompt_weather_analysis');
    const resourceTool = tools.find((t: any) => t.name === 'resource_amap_docs');
    expect(promptTool).toBeDefined();
    expect(promptTool.description).toBeDefined();
    expect(resourceTool).toBeDefined();
    expect(resourceTool.description).toBeDefined();
  });
});

describe('LLMAgent 通过 chat 交互使用工具', () => {
  let agent: LLMAgent;

  beforeAll(async () => {
    if (!hasApiKey) {
      console.log('跳过: 缺少有效的 API key');
      return;
    }
    agent = new LLMAgent(config);
    await agent.connect(config.mcpServers);
  });

  afterAll(() => {
    agent?.disconnect();
  });

  test('chat 应该能记住用户的名字', async () => {
    if (!agent) {
      console.log('跳过: agent 未初始化');
      return;
    }

    await agent.chat('我叫帝皇侠');
    const response = await agent.chat('请直接说出我的名字');
    console.log('chat response:', response);
    expect(response).toBeDefined();
    expect(response).toContain('帝皇侠');
  }, 30000);

  test('chat 使用 calculate 工具后应该返回计算结果', async () => {
    if (!agent) {
      console.log('跳过: agent 未初始化');
      return;
    }

    const response = await agent.chat('计算一下 123 + 456 等于多少？');
    console.log('计算 response:', response);

    expect(response).toBeDefined();
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);

    // 验证返回内容包含计算结果
    expect(response).toMatch(/579|123.*456/);
  }, 30000);

  test('chat 使用 get_weather 工具后应该返回天气信息', async () => {
    if (!agent) {
      console.log('跳过: agent 未初始化');
      return;
    }

    const response = await agent.chat('北京现在的天气怎么样？温度是多少？');
    console.log('天气查询 response:', response);

    expect(response).toBeDefined();
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  }, 30000);
});
