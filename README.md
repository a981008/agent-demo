# MCP Demo Agent

演示 **Skill 插件系统** 与 **MCP (Model Context Protocol)** 集成能力的 AI Agent 示例项目。

## 核心特性

- **Skill 系统**：懒加载的插件机制，运行时动态加载
- **MCP 集成**：连接 MCP Server 获取 Tools/Prompts/Resources
- **工具调用**：支持 LLM 多轮工具调用循环
- **统一日志**：基于 `createLogger()` 的分级日志模块

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Agent                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│  │  LLMAgent   │  │ MCPClient   │  │  SkillSystem    │   │
│  │             │  │             │  │                 │   │
│  │ - chat()    │  │ - connect() │  │ - loadSkills()  │   │
│  │ - listTools │  │ - callTool()│  │ - invoke()      │   │
│  └─────────────┘  └──────┬──────┘  └────────┬────────┘   │
└───────────────────────────┼─────────────────┼──────────────┘
                            │ STDIO           │
┌───────────────────────────┴─────────────────┴──────────────┐
│                      MCP Server                             │
│  ┌───────────┐  ┌───────────┐  ┌─────────────────┐        │
│  │  Tools    │  │  Prompts  │  │   Resources     │        │
│  └───────────┘  └───────────┘  └─────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Skill 系统

Skill 是一个懒加载的插件系统，支持在运行时动态加载扩展功能。

### 目录结构

```
.agent/skills/<skill-name>/
├── SKILL.md           # Skill 元信息
└── scripts/
    └── index.ts       # Skill 逻辑
```

### SKILL.md 格式

```yaml
---
name: skill-name
description: "Skill 描述"
script: ./scripts/index.ts
---

<objective>
Skill 实现目标
</objective>

<params>
param1: string
param2: number
</params>
```

### Skill 实现示例

`.agent/skills/date/scripts/index.ts`:

```typescript
export async function invoke(params: { format?: string }) {
  const now = new Date();
  return {
    date: now.toLocaleDateString('zh-CN'),
    time: now.toLocaleTimeString('zh-CN'),
    timestamp: now.getTime(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
```

### Skill 调用流程

1. **启动时**：扫描 `.agent/skills/` 目录，仅加载元信息（name、description）
2. **首次调用时**：完整加载脚本内容（渐进披露）
3. **执行时**：调用 `invoke(params)` 并返回结果

### Skill vs MCP Tools

| 特性 | Skill | MCP Tool |
|------|-------|----------|
| 加载时机 | 启动时元信息，首次调用时完整加载 | 启动时全部加载 |
| 位置 | `.agent/skills/` 本地目录 | MCP Server 远程提供 |
| 实现方式 | 动态 import TypeScript 模块 | MCP 协议通信 |
| 适用场景 | 本地轻量扩展 | 远程服务/API |

## MCP 集成

MCP Server 通过 STDIO 通信，提供三类能力：

### Tools

MCP Server 注册的工具，Agent 可直接调用：

```typescript
// 通过 MCP 客户端调用
const weather = await client.callTool('amap_weather', { city: '北京' });
```

### Prompts

预定义的提示模板，带参数生成用户消息：

```typescript
const prompt = await client.callPrompt('weather_analysis', { city: '北京' });
// 返回生成的消息内容
```

### Resources

带 URI 的可读资源，类似静态数据源：

```typescript
const docs = await client.readResource('docs://amap');
```

## 项目结构

```
.
├── agent/src/
│   ├── index.ts         # CLI 入口
│   ├── llm-agent.ts    # Agent 主类
│   ├── mcp-client.ts    # MCP 客户端
│   ├── skill.ts         # Skill 加载与调用
│   ├── config.ts        # 配置加载
│   ├── logger.ts        # 日志模块
│   └── utils.ts         # 工具函数
├── mcp-server/src/
│   ├── index.ts         # MCP Server 入口
│   ├── tools.ts         # Tools 实现
│   ├── prompts.ts       # Prompts 定义
│   └── resources.ts     # Resources 定义
└── .agent/skills/       # Skill 插件目录
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

配置文件位于项目根目录，支持 `${ENV_VAR}` 语法引用环境变量：

**`agent.config.json`** - Agent 配置

```json
{
  "llm": {
    "model": "${GENERATION_MODEL}",
    "apiKey": "${ANTHROPIC_API_KEY}",
    "baseUrl": "${ANTHROPIC_BASE_URL}"
  },
  "mcpServers": [
    {
      "name": "mcp-demo",
      "command": "bun",
      "args": ["run", "server"]
    }
  ],
  "skillEnabled": true,
  "logLevel": "debug"
}
```

**`server.config.json`** - MCP Server 配置

```json
{
  "amap": {
    "key": "${AMAP_KEY}"
  }
}
```

### 3. 运行

```bash
npm run agent
```

## 开发

```bash
npm run check   # 类型检查
npm run lint    # 代码检查
npm run format  # 格式化
npm test        # 测试
```