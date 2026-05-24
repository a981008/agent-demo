/**
 * 共享工具函数
 */

const CJK_REGEX = /[一-龥]/;

/**
 * 估算文本的 token 数量
 * 中文字符约 2 tokens，英文约 0.25 tokens
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += CJK_REGEX.test(char) ? 2 : 0.25;
  }
  return Math.ceil(tokens);
}

/**
 * 解析环境变量占位符 ${VAR}
 */
export function resolveEnvVar(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
}
