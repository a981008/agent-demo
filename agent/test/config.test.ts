/**
 * config.ts 单元测试
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadConfig } from '../src/config';

const TEST_DIR = '/tmp/agent-config-test';

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

describe('loadConfig', () => {
  test('能解析环境变量占位符', () => {
    const config = {
      llm: {
        baseUrl: '${TEST_BASE_URL}',
        model: '${TEST_MODEL}',
        apiKey: '${TEST_API_KEY}',
      },
      mcpServers: [],
    };
    const configPath = resolve(TEST_DIR, 'config-env.json');
    writeFileSync(configPath, JSON.stringify(config));
    process.env.TEST_BASE_URL = 'https://env.test.com';
    process.env.TEST_API_KEY = 'env-key-123';
    process.env.TEST_MODEL = 'test-model';

    const result = loadConfig(configPath);

    expect(result.llm.baseUrl).toBe('https://env.test.com');
    expect(result.llm.apiKey).toBe('env-key-123');
    expect(result.llm.model).toBe('test-model');

    delete process.env.TEST_BASE_URL;
    delete process.env.TEST_API_KEY;
  });
});
