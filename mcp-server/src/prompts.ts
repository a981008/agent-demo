import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer) {
  // 天气分析提示
  server.registerPrompt(
    'weather_analysis',
    {
      title: '天气分析',
      description: '分析指定城市的天气数据，提供详细的生活建议',
      argsSchema: {
        city: z.string().describe('城市名称'),
      },
    },
    ({ city }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `请分析 ${city} 的天气数据，提供：
1. 整体天气感受
2. 具体温度和体感温度
3. 出行建议
4. 穿衣建议
5. 健康提示`,
          },
        },
      ],
    }),
  );

  // 穿衣建议提示
  server.registerPrompt(
    'dressing_advice',
    {
      title: '穿衣建议',
      description: '根据天气情况给出穿衣建议',
      argsSchema: {
        city: z.string().describe('城市名称'),
      },
    },
    ({ city }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `请根据 ${city} 的天气情况，给出详细的穿衣建议：
1. 今日整体气温范围
2. 适合穿什么类型的外套
3. 建议的衣物厚度
4. 早晚温差需要注意的事项`,
          },
        },
      ],
    }),
  );

  // 地理位置查询提示
  server.registerPrompt(
    'location_info',
    {
      title: '位置信息',
      description: '查询地址或坐标的详细信息',
      argsSchema: {
        type: z.enum(['address', 'coordinates']).describe('查询类型'),
      },
    },
    ({ type }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              type === 'address'
                ? '请将以下地址转换为经纬度坐标，并提供详细的省市区信息：'
                : '请将以下经纬度坐标转换为实际地址，并提供详细的地区信息：',
          },
        },
      ],
    }),
  );
}
