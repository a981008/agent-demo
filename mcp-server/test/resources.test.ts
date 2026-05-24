/**
 * resources.ts 单元测试
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

  async listResources() {
    const res = await this.send(20, 'resources/list', {});
    return res.result?.resources || [];
  }

  async readResource(uri: string) {
    const res = await this.send(21, 'resources/read', { uri });
    return res.result;
  }

  close() {
    this.process.kill();
  }
}

describe('resources', () => {
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

  test('listResources 返回所有注册的 resources', async () => {
    const resources = await client.listResources();
    expect(resources.length).toBe(2);
    const uris = resources.map((r: any) => r.uri);
    expect(uris).toContain('docs://amap');
    expect(uris).toContain('health://status');
  });

  test('readResource 返回高德 API 文档', async () => {
    const result = await client.readResource('docs://amap');
    const text = result?.contents?.[0]?.text;
    expect(text).toBeDefined();
    expect(text).toContain('amap_weather');
    expect(text).toContain('amap_geocode');
  });

  test('readResource 返回健康状态', async () => {
    const result = await client.readResource('health://status');
    const text = result?.contents?.[0]?.text;
    expect(text).toBeDefined();
    const data = JSON.parse(text);
    expect(data.timestamp).toBeDefined();
    expect(data.uptime).toBeDefined();
  });
});
