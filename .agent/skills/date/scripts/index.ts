/**
 * date skill 实现
 */

export function invoke(params: any): any {
  const format = params.format || '';
  const now = new Date();
  const timestamp = Math.floor(now.getTime() / 1000);

  if (format === 'unix') {
    return { timestamp, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
  if (format === 'date') {
    return {
      date: now.toLocaleDateString('zh-CN'),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  return {
    datetime: now.toISOString(),
    timestamp,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
