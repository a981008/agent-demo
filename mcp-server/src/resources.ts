import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerResources(server: McpServer) {
  // 高德地图 API 文档资源
  server.registerResource(
    'amap_docs',
    'docs://amap',
    {
      mimeType: 'text/markdown',
      description: '高德地图 API 使用文档',
    },
    async () => {
      const docs = `# 高德地图 API 工具

## 环境变量配置

需要设置 \`AMAP_KEY\` 环境变量获取真实数据。

## 工具 (Tools)

### amap_weather
查询真实天气数据
- 参数: \`city\` (string) - 城市名称或编码

### amap_geocode
地址转坐标（地理编码）
- 参数: \`address\` (string) - 详细地址

### amap_regeo
坐标转地址（逆地理编码）
- 参数: \`longitude\`, \`latitude\` (number) - 经纬度

## 其他工具

- \`get_date\` - 获取日期时间
`;
      return {
        contents: [
          {
            uri: 'docs://amap',
            mimeType: 'text/markdown',
            text: docs,
          },
        ],
      };
    },
  );

  // 服务器健康状态资源
  server.registerResource(
    'health',
    'health://status',
    {
      mimeType: 'application/json',
      description: '服务器健康状态',
    },
    async () => {
      const memUsage = process.memoryUsage();
      const health = {
        timestamp: Date.now(),
        uptime: process.uptime(),
        memory: {
          total: memUsage.heapTotal,
          used: memUsage.heapUsed,
          free: memUsage.heapTotal - memUsage.heapUsed,
        },
      };
      return {
        contents: [
          {
            uri: 'health://status',
            mimeType: 'application/json',
            text: JSON.stringify(health, null, 2),
          },
        ],
      };
    },
  );
}
