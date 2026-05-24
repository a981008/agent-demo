import { createLogger } from './logger.js';
import { estimateTokens } from './utils.js';

export interface ToolInputSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
    }
  >;
  required?: string[];
}

export interface SkillTool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

export interface SkillContext {
  name: string;
  description: string;
  invoke(params: any): Promise<any>;
  getToolDefinition(): SkillTool;
  loadFullContent(): Promise<void>;
}

export interface SkillResult {
  success: boolean;
  data?: any;
  error?: string;
  tokensUsed: {
    request: number;
    response: number;
  };
}

interface LazySkill {
  name: string;
  description: string;
  dirName: string;
  content: string;
  loaded: boolean;
  invokeFn?: (params: any) => Promise<any>;
  paramsSchema?: { properties: Record<string, any>; required: string[] };
}

const log = createLogger('Skill');

export class SkillSystem {
  private skills: Map<string, SkillContext> = new Map();
  private callLog: Array<{ skill: string; params: any; tokens: number }> = [];
  private mcpClients: Map<string, any> = new Map();

  register(skill: SkillContext) {
    this.skills.set(skill.name, skill);
  }

  registerMcpClient(name: string, client: any) {
    this.mcpClients.set(name, client);
  }

  getSkill(name: string): SkillContext | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): Map<string, SkillContext> {
    return this.skills;
  }

  /**
   * 从 .agent/skills/ 目录加载所有 skill（仅基本信息）
   */
  async loadSkills(): Promise<void> {
    const { readdir, readFile } = await import('fs/promises');
    const { join } = await import('path');

    const skillsDir = join(process.cwd(), '.agent/skills');

    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = join(skillsDir, entry.name);
          const skillFile = join(skillDir, 'SKILL.md');

          try {
            const content = await readFile(skillFile, 'utf-8');
            const skill = this.createLazySkill(entry.name, content);
            if (skill) {
              this.skills.set(skill.name, skill);
            }
          } catch (err) {
            log.debug(`跳过无效 skill: ${entry.name}`, err);
          }
        }
      }
    } catch {
      log.debug('无 skill 目录或加载失败');
    }
  }

  /**
   * 创建懒加载 Skill（首次只加载 name 和 description）
   */
  private createLazySkill(dirName: string, content: string): SkillContext | null {
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (!nameMatch) return null;
    const name = nameMatch[1].trim();

    const descMatch = content.match(/^description:\s*"(.+)"$/m);
    const description = descMatch ? descMatch[1] : '';

    const lazySkill: LazySkill = {
      name,
      description,
      dirName,
      content,
      loaded: false,
    };

    const self = this;
    return {
      name,
      description,
      invoke: async function (params: any) {
        // 调用时才会加载完整内容
        await self.doLoadFullContent(lazySkill);
        if (lazySkill.invokeFn) {
          return lazySkill.invokeFn(params);
        }
        return { error: 'No implementation' };
      },
      getToolDefinition: () => ({
        name: `skill_${name}`,
        description,
        input_schema: {
          type: 'object',
          properties: lazySkill.paramsSchema?.properties || {},
          required: lazySkill.paramsSchema?.required || [],
        },
      }),
      loadFullContent: async function () {
        if (!lazySkill.loaded) {
          await self.doLoadFullContent(lazySkill);
        }
      },
    };
  }

  /**
   * 加载完整 skill 内容（渐进披露）
   */
  private async doLoadFullContent(lazySkill: LazySkill): Promise<void> {
    const content = lazySkill.content;
    const dirName = lazySkill.dirName;

    // 提取 script 字段
    const scriptMatch = content.match(/^script:\s*(.+)$/m);
    const scriptPath = scriptMatch ? scriptMatch[1].trim() : null;

    // 提取参数定义
    const paramsMatch = content.match(/<params>([\s\S]*?)<\/params>/);
    lazySkill.paramsSchema = paramsMatch
      ? this.parseParamsSchema(paramsMatch[1])
      : { properties: {}, required: [] };

    // 动态加载脚本
    if (scriptPath) {
      try {
        const { join } = await import('path');
        const { pathToFileURL } = await import('url');
        const skillDir = join(process.cwd(), '.agent/skills', dirName);
        const modulePath = pathToFileURL(join(skillDir, scriptPath)).href;
        const mod = await import(modulePath);
        lazySkill.invokeFn = mod.invoke;
      } catch (e) {
        log.debug(`脚本加载失败: ${lazySkill.name}`, e);
      }
    }

    lazySkill.loaded = true;
    log.debug(`完整加载: ${lazySkill.name}`);
  }

  private parseParamsSchema(content: string): {
    properties: Record<string, any>;
    required: string[];
  } {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    const lines = content.split('\n');
    for (const line of lines) {
      const paramMatch = line.match(/^\s*(\w+)\s*:\s*(\w+)/);
      if (paramMatch) {
        const [, paramName, paramType] = paramMatch;
        properties[paramName] = { type: paramType.toLowerCase() };
        required.push(paramName);
      }
    }

    return { properties, required };
  }

  /**
   * 获取所有 skill 的 tool 定义（符合 Claude 规范）
   */
  getTools(): SkillTool[] {
    const tools: SkillTool[] = [];
    for (const skill of this.skills.values()) {
      tools.push(skill.getToolDefinition());
    }
    return tools;
  }

  async invoke(skillName: string, params: any): Promise<SkillResult> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return {
        success: false,
        error: `Skill ${skillName} not found`,
        tokensUsed: { request: 0, response: 0 },
      };
    }

    log.debug(`使用: ${skillName}(${JSON.stringify(params)})`);

    // 调用时才加载完整内容
    if ('loadFullContent' in skill && typeof skill.loadFullContent === 'function') {
      await skill.loadFullContent();
    }

    const startTokens = estimateTokens(skillName + JSON.stringify(params));
    const result = await skill.invoke(params);
    const endTokens = estimateTokens(JSON.stringify(result));

    this.callLog.push({ skill: skillName, params, tokens: endTokens - startTokens });

    return {
      success: true,
      data: result,
      tokensUsed: { request: startTokens, response: endTokens },
    };
  }

  getCallLog() {
    return this.callLog;
  }

  getStats() {
    const total = this.callLog.reduce((sum, log) => sum + log.tokens, 0);
    return { totalCalls: this.callLog.length, totalTokens: total };
  }
}

export const globalSkillSystem = new SkillSystem();
let skillsLoaded: Promise<void> | null = null;

export function getSkillsLoaded(): Promise<void> {
  if (!skillsLoaded) {
    skillsLoaded = globalSkillSystem.loadSkills().then(() => {
      const loaded = Array.from(globalSkillSystem.getAllSkills().keys());
      log.info(`已加载: ${loaded.join(', ')}`);
    });
  }
  return skillsLoaded;
}
