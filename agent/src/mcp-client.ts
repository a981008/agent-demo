import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: any;
  error?: any;
  method?: string;
  params?: any;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export class MCPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private pendingRequests: Map<number | string, PendingRequest> = new Map();
  private requestId = 0;
  private requestTimeout: number = 30000;

  setRequestTimeout(timeout: number): void {
    this.requestTimeout = timeout;
  }

  async connect(command: string, args: string[] = [], options?: { cwd?: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: options?.cwd,
      });

      let buffer = '';

      this.process.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line) as MCPResponse;
            this.handleMessage(response);
          } catch {
            // 忽略非 JSON 行
          }
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes('启动成功')) {
          this.emit('ready');
        }
      });

      this.process.on('error', reject);
      this.process.on('exit', (code) => {
        this.emit('close', code);
      });

      // 初始化 MCP 协议
      this.sendRequest({
        jsonrpc: '2.0',
        id: this.nextId(),
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-demo-agent', version: '1.0.0' },
        },
      })
        .then(() => {
          // 发送 initialized 通知
          this.sendRaw({
            jsonrpc: '2.0',
            method: 'initialized',
            params: {},
          });
          resolve();
        })
        .catch(reject);
    });
  }

  private handleMessage(message: MCPResponse) {
    // 处理响应
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          const errMsg =
            typeof message.error === 'object'
              ? message.error.message || JSON.stringify(message.error)
              : String(message.error);
          pending.reject(new Error(errMsg));
        } else {
          pending.resolve(message.result);
        }
      }
    }
    // 处理通知
    if (message.method && message.id === undefined) {
      this.emit('notification', message);
    }
  }

  private nextId(): number {
    return ++this.requestId;
  }

  sendRequest(request: MCPRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Process not connected'));
        return;
      }

      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error('Request timeout'));
        }
      }, this.requestTimeout);

      const cleanup = () => clearTimeout(timeoutId);

      this.pendingRequests.set(request.id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private sendRaw(obj: any) {
    if (!this.process?.stdin) return;
    this.process.stdin.write(JSON.stringify(obj) + '\n');
  }

  async callTool(name: string, arguments_: Record<string, any>): Promise<any> {
    const result = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/call',
      params: { name, arguments: arguments_ },
    });
    return result;
  }

  async listTools(): Promise<any[]> {
    const result = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'tools/list',
    });
    return result.tools || [];
  }

  async listPrompts(): Promise<any[]> {
    const result = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'prompts/list',
    });
    return result.prompts || [];
  }

  async listResources(): Promise<any[]> {
    const result = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'resources/list',
    });
    return result.resources || [];
  }

  async callPrompt(name: string, args?: Record<string, any>): Promise<any> {
    return await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'prompts/get',
      params: { name, arguments: args || {} },
    });
  }

  async readResource(uri: string): Promise<string> {
    const result = await this.sendRequest({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'resources/read',
      params: { uri },
    });
    return result.contents?.[0]?.text || '';
  }

  disconnect() {
    // 清理所有待处理的请求
    for (const { reject } of this.pendingRequests.values()) {
      reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
