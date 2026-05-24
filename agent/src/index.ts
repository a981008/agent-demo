/**
 * LLMAgent 交互式 CLI 入口
 */

import { loadConfig } from './config';
import { LLMAgent } from './llm-agent';
import { getSkillsLoaded } from './skill';
import { createLogger, setLogLevel } from './logger';

const config = loadConfig();
if (config.logLevel) {
  setLogLevel(config.logLevel);
}

const log = createLogger('CLI');

async function main() {
  const agent = new LLMAgent(config);

  try {
    await agent.connect(config.mcpServers);
    if (config.skillEnabled !== false) {
      await getSkillsLoaded();
    }
    console.log('\n========================================');
    console.log('  LLMAgent 交互式 CLI');
    console.log('========================================');
    console.log('输入你的问题后按回车，exit 退出\n');

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let isWaiting = false;

    const ask = () => {
      if (isWaiting) {
        return;
      }
      rl.question('YOU: ', async (input) => {
        const message = input.trim();
        if (!message || message === 'exit' || message === 'quit' || message === 'q') {
          rl.close();
          return;
        }

        isWaiting = true;
        try {
          const start = Date.now();
          const response = await agent.chat(message);
          const elapsed = Date.now() - start;
          console.log(`\nAgent: ${response}`);
          log.info('耗时: {}ms', elapsed);
        } catch (e) {
          process.stdout.write('\x1b[0m');
          console.log('\n错误:', e);
        }
        isWaiting = false;
        ask();
      });
    };

    ask();
  } catch (e) {
    log.error('连接失败', e);
    process.exit(1);
  }
}

main();
