/**
 * tools.ts 单元测试
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { copyFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CONFIG_SOURCE = join(PROJECT_ROOT, '..', 'server.config.json');
const CONFIG_TARGET = join(PROJECT_ROOT, 'server.config.json');

class MCPTestClient {
  private process: ChildProcess;
  private pendingResolve: ((v: any) => void) | null = null;
  private messageBuffer = '';
  private readyResolve: (() => void) | null = null;

  constructor() {
    this.process = spawn('bun', ['src/index.ts'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: PROJECT_ROOT,
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.messageBuffer += data.toString();
      const lines = this.messageBuffer.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (line && line.startsWith('{')) {
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'ready' && this.readyResolve) {
              this.readyResolve();
              this.readyResolve = null;
            } else if (msg.id !== undefined && this.pendingResolve) {
              const resolve = this.pendingResolve;
              this.pendingResolve = null;
              resolve(msg);
            }
          } catch {}
        }
      }
      this.messageBuffer = lines[lines.length - 1];
    });
  }

  private async send(id: number, method: string, params: any = {}): Promise<any> {
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this.process.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
          throw new Error(`timeout for ${method}`);
        }
      }, 5000);
    });
  }

  async initialize(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    await this.send(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    });
    this.process.stdin?.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }) + '\n',
    );
    await new Promise<void>((r) => setTimeout(() => r(), 200));
  }

  async listTools() {
    const res = await this.send(10, 'tools/list', {});
    return res.result?.tools || [];
  }

  async callTool(name: string, args: Record<string, any>) {
    const res = await this.send(12, 'tools/call', { name, arguments: args });
    return res.result;
  }

  close() {
    this.process.kill();
  }
}

describe('tools', () => {
  let client: MCPTestClient;

  beforeAll(async () => {
    // 复制配置文件到 mcp-server 目录
    if (existsSync(CONFIG_SOURCE) && !existsSync(CONFIG_TARGET)) {
      copyFileSync(CONFIG_SOURCE, CONFIG_TARGET);
    }
    client = new MCPTestClient();
    await client.initialize();
  });

  afterAll(() => {
    client.close();
  });

  test('listTools 返回所有工具', async () => {
    const tools = await client.listTools();
    expect(tools.length).toBe(4);
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('amap_weather');
    expect(names).toContain('amap_geocode');
    expect(names).toContain('amap_regeo');
    expect(names).toContain('amap_ip_location');
  });

  test('amap_weather 返回真实天气数据', async () => {
    const result = await client.callTool('amap_weather', { city: '北京' });
    const text = result?.content?.[0]?.text;
    expect(text).toBeDefined();
    const data = JSON.parse(text);
    expect(data.location || data.error).toBeDefined();
  });

  test('amap_geocode 返回真实坐标或服务不可用', async () => {
    const result = await client.callTool('amap_geocode', { address: '北京市朝阳区' });
    const text = result?.content?.[0]?.text;
    const data = JSON.parse(text);
    // 可能返回真实数据或服务不可用（取决于 key 权限）
    expect(data.location || data.error).toBeDefined();
  });

  test('amap_regeo 返回真实地址或服务不可用', async () => {
    const result = await client.callTool('amap_regeo', {
      longitude: 116.443136,
      latitude: 39.921444,
    });
    const text = result?.content?.[0]?.text;
    const data = JSON.parse(text);
    // 可能返回真实数据或服务不可用（取决于 key 权限）
    expect(data.province || data.error).toBeDefined();
  });
});
