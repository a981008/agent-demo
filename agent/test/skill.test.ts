/**
 * agent/skill.ts 单元测试
 *
 * 测试 SkillSystem 的注册、调用、统计等功能
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SkillSystem, SkillContext, SkillTool, globalSkillSystem } from '../src/skill';

/**
 * 创建一个测试用的 Skill
 */
function createTestSkill(name: string, description: string): SkillContext {
  return {
    name,
    description,
    invoke: async (params) => ({ result: `processed ${params.input}` }),
    getToolDefinition: () => ({
      name: `skill_${name}`,
      description,
      input_schema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: '输入值' },
        },
        required: ['input'],
      },
    }),
    loadFullContent: async () => {},
  };
}

describe('SkillSystem', () => {
  let system: SkillSystem;

  beforeEach(() => {
    system = new SkillSystem();
  });

  // --------------------------------------------------------
  // 注册相关测试
  // --------------------------------------------------------
  describe('注册功能', () => {
    test('应该能注册一个 skill', () => {
      const skill = createTestSkill('test', '测试技能');
      system.register(skill);
      expect(system.getSkill('test')).toBeDefined();
    });

    test('注册后应该能通过 getSkill 获取', () => {
      const skill = createTestSkill('getter', '获取测试');
      system.register(skill);
      const retrieved = system.getSkill('getter');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('getter');
    });

    test('应该能获取所有注册的 skills', () => {
      system.register(createTestSkill('skill1', '技能1'));
      system.register(createTestSkill('skill2', '技能2'));
      const all = system.getAllSkills();
      expect(all.size).toBe(2);
    });

    test('可以注册同名 skill，后注册的会覆盖', () => {
      system.register(createTestSkill('duplicate', '第一个'));
      system.register(createTestSkill('duplicate', '第二个'));
      const skill = system.getSkill('duplicate');
      expect(skill?.description).toBe('第二个');
    });
  });

  // --------------------------------------------------------
  // 调用相关测试
  // --------------------------------------------------------
  describe('invoke 功能', () => {
    test('应该能调用已注册的 skill', async () => {
      const skill = createTestSkill('invoke', '调用测试');
      system.register(skill);
      const result = await system.invoke('invoke', { input: 'hello' });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    test('调用不存在的 skill 应返回错误', async () => {
      const result = await system.invoke('not_exist', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('调用成功时应包含 tokensUsed 信息', async () => {
      const skill = createTestSkill('tokens', 'token测试');
      system.register(skill);
      const result = await system.invoke('tokens', { input: 'data' });
      expect(result.tokensUsed).toBeDefined();
      expect(result.tokensUsed.request).toBeGreaterThan(0);
    });

    test('调用失败时 tokensUsed 应为 0', async () => {
      const result = await system.invoke('missing', {});
      expect(result.tokensUsed.request).toBe(0);
      expect(result.tokensUsed.response).toBe(0);
    });
  });

  // --------------------------------------------------------
  // getTools 相关测试
  // --------------------------------------------------------
  describe('getTools 功能', () => {
    test('应该返回所有 skill 的工具定义', () => {
      system.register(createTestSkill('tool1', '工具1'));
      system.register(createTestSkill('tool2', '工具2'));
      const tools = system.getTools();
      expect(tools).toHaveLength(2);
    });

    test('返回的工具定义应符合 Claude 规范', () => {
      system.register(createTestSkill('claude', '符合规范'));
      const tools = system.getTools();
      const tool = tools[0];
      expect(tool.name).toBe('skill_claude');
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
    });

    test('空系统应返回空数组', () => {
      const tools = system.getTools();
      expect(tools).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // 统计相关测试
  // --------------------------------------------------------
  describe('统计功能', () => {
    test('应该记录调用次数', async () => {
      system.register(createTestSkill('count', '计数测试'));
      await system.invoke('count', { input: '1' });
      await system.invoke('count', { input: '2' });
      const stats = system.getStats();
      expect(stats.totalCalls).toBe(2);
    });

    test('应该累加 token 消耗', async () => {
      system.register(createTestSkill('token', 'token统计'));
      await system.invoke('token', { input: 'test' });
      const stats = system.getStats();
      expect(stats.totalTokens).toBeGreaterThan(0);
    });

    test('getCallLog 应返回调用记录', async () => {
      system.register(createTestSkill('log', '日志测试'));
      await system.invoke('log', { input: 'x' });
      const log = system.getCallLog();
      expect(log).toHaveLength(1);
      expect(log[0].skill).toBe('log');
    });

    test('多次调用应累加统计', async () => {
      system.register(createTestSkill('multi', '多次调用'));
      const initialStats = system.getStats();
      await system.invoke('multi', { input: 'a' });
      await system.invoke('multi', { input: 'b' });
      await system.invoke('multi', { input: 'c' });
      const finalStats = system.getStats();
      expect(finalStats.totalCalls).toBeGreaterThan(initialStats.totalCalls);
    });
  });

  // --------------------------------------------------------
  // token 估算测试
  // --------------------------------------------------------
  describe('token 估算', () => {
    test('应该正确估算中文字符', async () => {
      system.register(createTestSkill('chinese', '中文测试'));
      const result = await system.invoke('chinese', { input: '你好世界' });
      // 中文字符每个约 2 tokens
      expect(result.tokensUsed.request).toBeGreaterThan(10);
    });

    test('应该正确估算英文字符', async () => {
      system.register(createTestSkill('english', '英文测试'));
      const result = await system.invoke('english', { input: 'hello' });
      // 英文字符每个约 0.25 tokens
      expect(result.tokensUsed.request).toBeLessThan(10);
    });

    test('不同输入长度应产生不同 token 消耗', async () => {
      system.register(createTestSkill('length', '长度测试'));
      const r1 = await system.invoke('length', { input: 'a' });
      const r2 = await system.invoke('length', { input: 'abcdefghij' });
      expect(r2.tokensUsed.request).toBeGreaterThan(r1.tokensUsed.request);
    });
  });

  // --------------------------------------------------------
  // 类型定义测试
  // --------------------------------------------------------
  describe('类型定义', () => {
    test('SkillTool 应包含必要字段', () => {
      const tool: SkillTool = {
        name: 'test_tool',
        description: '测试工具',
        input_schema: {
          type: 'object',
          properties: {
            param1: { type: 'string', description: '参数1' },
          },
          required: ['param1'],
        },
      };
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
    });

    test('SkillContext 应包含必要方法', () => {
      const skill: SkillContext = {
        name: 'context_test',
        description: '上下文测试',
        invoke: async () => ({}),
        getToolDefinition: () => ({
          name: 'context_test',
          description: '测试',
          input_schema: { type: 'object', properties: {}, required: [] },
        }),
        loadFullContent: async () => {},
      };
      expect(typeof skill.invoke).toBe('function');
      expect(typeof skill.getToolDefinition).toBe('function');
    });
  });
});

describe('globalSkillSystem', () => {
  test('应该是一个已创建的 SkillSystem 实例', () => {
    expect(globalSkillSystem.getAllSkills).toBeDefined();
    expect(globalSkillSystem.invoke).toBeDefined();
    expect(globalSkillSystem.register).toBeDefined();
  });
});

// --------------------------------------------------------
// 渐进式披露测试
// --------------------------------------------------------
describe('渐进式披露', () => {
  test('首次加载只包含 name 和 description', async () => {
    const system = new SkillSystem();
    await system.loadSkills();

    const skill = system.getSkill('date');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('date');
    expect(skill?.description).toContain('date');
  });

  test('getToolDefinition 初始不包含参数定义', async () => {
    const system = new SkillSystem();
    await system.loadSkills();

    const tools = system.getTools();
    const dateTool = tools.find((t: any) => t.name === 'skill_date');
    expect(dateTool).toBeDefined();
    expect(dateTool?.input_schema.properties).toEqual({});
  });

  test('invoke 时才完整加载 skill', async () => {
    const system = new SkillSystem();
    await system.loadSkills();

    const skill = system.getSkill('date');
    expect(skill).toBeDefined();

    // 确认有 loadFullContent 方法
    expect(typeof (skill as any).loadFullContent).toBe('function');

    // 首次调用
    const result = await system.invoke('date', {});
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  test('完整加载后可以获取工具定义', async () => {
    const system = new SkillSystem();
    await system.loadSkills();

    const skill = system.getSkill('date');
    expect(skill).toBeDefined();

    // 先调用使完整加载
    await system.invoke('date', {});

    // 调用后应能正常执行
    const result = await system.invoke('date', { format: 'unix' });
    expect(result.success).toBe(true);
    expect(result.data.timestamp).toBeDefined();
  });
});
