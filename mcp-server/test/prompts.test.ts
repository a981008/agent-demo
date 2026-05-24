/**
 * prompts.ts 单元测试
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
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

  async listPrompts() {
    const res = await this.send(11, 'prompts/list', {});
    return res.result?.prompts || [];
  }

  async getPrompt(name: string, args: Record<string, any> = {}) {
    const res = await this.send(12, 'prompts/get', { name, arguments: args });
    return res.result;
  }

  close() {
    this.process.kill();
  }
}

describe('prompts', () => {
  let client: MCPTestClient;

  beforeAll(async () => {
    if (existsSync(CONFIG_SOURCE) && !existsSync(CONFIG_TARGET)) {
      copyFileSync(CONFIG_SOURCE, CONFIG_TARGET);
    }
    client = new MCPTestClient();
    await client.initialize();
  });

  afterAll(() => {
    client.close();
  });

  test('listPrompts 返回所有注册的 prompts', async () => {
    const prompts = await client.listPrompts();
    expect(prompts.length).toBe(3);
    const names = prompts.map((p: any) => p.name);
    expect(names).toContain('weather_analysis');
    expect(names).toContain('dressing_advice');
    expect(names).toContain('location_info');
  });

  test('getPrompt 返回 weather_analysis', async () => {
    const result = await client.getPrompt('weather_analysis', { city: '北京' });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0].content.text).toContain('北京');
  });

  test('getPrompt 返回 dressing_advice', async () => {
    const result = await client.getPrompt('dressing_advice', { city: '上海' });
    expect(result.messages).toBeDefined();
    expect(result.messages[0].content.text).toContain('上海');
  });

  test('getPrompt 返回 location_info', async () => {
    const result = await client.getPrompt('location_info', { type: 'address' });
    expect(result.messages).toBeDefined();
    expect(result.messages[0].content.text).toContain('经纬度');
  });
});
