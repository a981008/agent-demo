/**
 * mcp-client.ts 单元测试
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { MCPClient } from '../src/mcp-client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

describe('MCPClient', () => {
  let client: MCPClient;

  beforeAll(async () => {
    client = new MCPClient();
    await client.connect('bun', ['mcp-server/src/index.ts'], { cwd: ROOT });
  });

  afterAll(() => {
    client.disconnect();
  });

  test('connect 应该成功连接服务器', async () => {
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  test('listTools 应该返回可用工具列表', async () => {
    const tools = await client.listTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('amap_weather');
    expect(toolNames).toContain('amap_geocode');
    expect(toolNames).toContain('amap_regeo');
    expect(toolNames).toContain('amap_ip_location');
  });

  test('listPrompts 应该返回 prompts 列表', async () => {
    const prompts = await client.listPrompts();
    expect(Array.isArray(prompts)).toBe(true);
    expect(prompts.length).toBe(3);
    const names = prompts.map((p: any) => p.name);
    expect(names).toContain('weather_analysis');
    expect(names).toContain('dressing_advice');
    expect(names).toContain('location_info');
  });

  test('listResources 应该返回 resources 列表', async () => {
    const resources = await client.listResources();
    expect(Array.isArray(resources)).toBe(true);
    expect(resources.length).toBe(2);
    const uris = resources.map((r: any) => r.uri);
    expect(uris).toContain('docs://amap');
    expect(uris).toContain('health://status');
  });

  test('callTool 应该能调用 amap_weather 工具（无 key 时返回错误）', async () => {
    const result = await client.callTool('amap_weather', { city: '北京' });
    expect(result).toBeDefined();

    const text = result?.content?.[0]?.text;
    const data = JSON.parse(text);
    // 无 API key 时应该返回错误或内置数据
    expect(data.location || data.error).toBeDefined();
  });

  test('callTool 应该能调用 amap_geocode 工具（无 key 时返回错误）', async () => {
    const result = await client.callTool('amap_geocode', { address: '北京市朝阳区' });
    expect(result).toBeDefined();

    const text = result?.content?.[0]?.text;
    const data = JSON.parse(text);
    expect(data.error || data.address).toBeDefined();
  });

  test('readResource 应该能读取健康状态资源', async () => {
    const content = await client.readResource('health://status');
    expect(content).toBeDefined();
    expect(typeof content).toBe('string');
    const data = JSON.parse(content);
    expect(data.timestamp).toBeDefined();
  });

  test('disconnect 应该能断开连接', () => {
    client.disconnect();
    expect(() => client.listTools()).toThrow();
  });
});
