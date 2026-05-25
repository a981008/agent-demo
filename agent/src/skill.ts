import { createLogger } from './logger.js';
import { estimateTokens } from './utils.js';
import { join } from 'path';

export interface SkillContext {
  name: string;
  description: string;
  invoke(params: any): Promise<any>;
  getContent(): string;
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
}

interface RegistryEntry {
  description: string;
  dirName: string;
  skillsDir: string;
}

const log = createLogger('Skill');

export class SkillSystem {
  private skills: Map<string, SkillContext> = new Map();
  private callLog: Array<{ skill: string; params: any; tokens: number }> = [];
  private mcpClients: Map<string, any> = new Map();
  private registry: Map<string, RegistryEntry> = new Map();

  register(skill: SkillContext) {
    this.skills.set(skill.name, skill);
  }

  registerMcpClient(name: string, client: any) {
    this.mcpClients.set(name, client);
  }

  /** Level 1: 从注册表生成技能目录文本，用于 SYSTEM prompt */
  listSkills(): string {
    if (this.registry.size === 0) return '';
    const lines: string[] = ['Available skills:'];
    for (const [name, entry] of this.registry) {
      lines.push(`- ${name}: ${entry.description}`);
    }
    return lines.join('\n');
  }

  /** Level 2: 按名称查找并加载完整技能内容，无路径遍历风险 */
  async loadSkill(name: string): Promise<string> {
    const entry = this.registry.get(name);
    if (!entry) return `Skill "${name}" not found`;

    const skill = this.skills.get(name);
    if (!skill) return `Skill "${name}" not found`;

    const result = await this.invoke(name, {});
    return `=== ${name} ===\n${skill.getContent()}\n\nResult:\n${JSON.stringify(result.data, null, 2)}`;
  }

  getSkill(name: string): SkillContext | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): Map<string, SkillContext> {
    return this.skills;
  }

  async loadSkills(skillsDir?: string): Promise<void> {
    const dir = skillsDir ?? join(process.cwd(), '.agent/skills');
    const { readdir, readFile } = await import('fs/promises');

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const content = await readFile(join(dir, entry.name, 'SKILL.md'), 'utf-8');
          const skill = this.createLazySkill(entry.name, dir, content);
          if (skill) {
            this.skills.set(skill.name, skill);
            this.registry.set(skill.name, {
              description: skill.description,
              dirName: entry.name,
              skillsDir: dir,
            });
          }
        } catch {
          log.debug(`跳过无效 skill: ${entry.name}`);
        }
      }
    } catch {
      log.debug('无 skill 目录或加载失败');
    }
  }

  private createLazySkill(
    dirName: string,
    skillsDir: string,
    content: string,
  ): SkillContext | null {
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (!nameMatch) return null;
    const name = nameMatch[1].trim();
    const descMatch = content.match(/^description:\s*"(.+)"$/m);
    const description = descMatch ? descMatch[1] : '';

    const lazy: LazySkill = { name, description, dirName, content, loaded: false };

    return {
      name,
      description,
      invoke: async (params: any) => {
        await this.doLoadFullContent(lazy, skillsDir);
        return lazy.invokeFn ? lazy.invokeFn(params) : { error: 'No implementation' };
      },
      getContent: () => lazy.content,
      loadFullContent: async () => {
        if (!lazy.loaded) await this.doLoadFullContent(lazy, skillsDir);
      },
    };
  }

  private async doLoadFullContent(lazy: LazySkill, skillsDir: string): Promise<void> {
    const scriptMatch = lazy.content.match(/^script:\s*(.+)$/m);
    const scriptPath = scriptMatch ? scriptMatch[1].trim() : null;

    if (scriptPath) {
      try {
        const { pathToFileURL } = await import('url');
        const modulePath = pathToFileURL(join(skillsDir, lazy.dirName, scriptPath)).href;
        const mod = await import(modulePath);
        lazy.invokeFn = mod.invoke;
      } catch (e) {
        log.debug(`脚本加载失败: ${lazy.name}`, e);
      }
    }

    lazy.loaded = true;
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

    if (typeof skill.loadFullContent === 'function') {
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
    const total = this.callLog.reduce((sum, l) => sum + l.tokens, 0);
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
