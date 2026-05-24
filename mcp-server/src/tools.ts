import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'fs';

interface AmapConfig {
  key: string;
  weatherUrl?: string;
  geocodeUrl?: string;
  regeoUrl?: string;
  ipUrl?: string;
}

interface ServerConfig {
  amap: AmapConfig;
}

function resolveEnvVar(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
}

function loadConfig(path: string = 'server.config.json'): ServerConfig {
  const content = readFileSync(path, 'utf-8');
  const config: ServerConfig = JSON.parse(content);

  // 解析环境变量占位符
  if (config.amap?.key) {
    config.amap.key = resolveEnvVar(config.amap.key);
  }
  return config;
}

let _amapConfig: AmapConfig | null = null;

function getAmapConfig(): AmapConfig {
  if (!_amapConfig) {
    const config = loadConfig();
    _amapConfig = config.amap;
  }
  return _amapConfig;
}

async function amapRequest(
  url: string,
  params: Record<string, string> = {},
  key: string,
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const queryParams = new URLSearchParams({ ...params, key });
    const response = await fetch(`${url}?${queryParams}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function registerTools(server: McpServer): void {
  const amap = getAmapConfig();
  const AMAP_KEY = amap.key;
  const AMAP_WEATHER_URL = amap.weatherUrl || 'https://restapi.amap.com/v3/weather/weatherInfo';
  const AMAP_GEO_URL = amap.geocodeUrl || 'https://restapi.amap.com/v3/geocode/geo';
  const AMAP_REGEO_URL = amap.regeoUrl || 'https://restapi.amap.com/v3/geocode/regeo';
  const AMAP_IP_URL = amap.ipUrl || 'https://restapi.amap.com/v3/ip';

  function checkKey(): { error: boolean; content?: unknown } {
    if (!AMAP_KEY) {
      return {
        error: true,
        content: {
          error: '请配置 server.config.json 中的 amap.key 或设置 AMAP_KEY 环境变量',
        },
      };
    }
    return { error: false };
  }

  // 高德天气查询
  server.registerTool(
    'amap_weather',
    {
      title: '高德天气',
      description: '通过高德地图 API 查询真实天气数据，支持全国城市',
      inputSchema: { city: z.string().describe('城市名称或城市编码') },
    },
    async ({ city }) => {
      const check = checkKey();
      if (check.error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(check.content, null, 2),
            },
          ],
        };
      }

      try {
        const data = await amapRequest(AMAP_WEATHER_URL, { city, extensions: 'base' }, AMAP_KEY);
        if (data.status === '0') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: data.info }, null, 2),
              },
            ],
          };
        }
        const live = data.lives?.[0];
        if (!live) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: '无天气数据', city }, null, 2),
              },
            ],
          };
        }
        const result = {
          location: live.city,
          temp: parseInt(live.temperature, 10),
          condition: live.weather,
          humidity: `${live.humidity}%`,
          wind: `${live.windpower}级${live.winddirection}`,
          feelsLike: parseInt(live.temperature, 10),
          aqi: live.reporttime.split(' ')[0],
          updateTime: live.reporttime,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: String(e) }, null, 2),
            },
          ],
        };
      }
    },
  );

  // 高德地理编码（地址转坐标）
  server.registerTool(
    'amap_geocode',
    {
      title: '地理编码',
      description: '通过高德地图 API 将地址转换为经纬度坐标',
      inputSchema: {
        address: z.string().describe("详细地址，如 '北京市朝阳区阜通东大街'"),
      },
    },
    async ({ address }) => {
      const check = checkKey();
      if (check.error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(check.content, null, 2),
            },
          ],
        };
      }

      try {
        const data = await amapRequest(AMAP_GEO_URL, { address, batch: 'false' }, AMAP_KEY);
        if (data.status === '0') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: data.info }, null, 2),
              },
            ],
          };
        }
        const location = data.geocodes?.[0];
        if (!location) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: '未找到该地址' }, null, 2),
              },
            ],
          };
        }
        const result = {
          address: location.formatted_address,
          province: location.province,
          city: location.city,
          district: location.district,
          location: location.location,
          level: location.level,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: String(e) }, null, 2),
            },
          ],
        };
      }
    },
  );

  // 高德逆地理编码（坐标转地址）
  server.registerTool(
    'amap_regeo',
    {
      title: '逆地理编码',
      description: '通过高德地图 API 将经纬度坐标转换为地址',
      inputSchema: {
        longitude: z.number().describe('经度，如 116.463'),
        latitude: z.number().describe('纬度，如 39.923'),
      },
    },
    async ({ longitude, latitude }) => {
      const check = checkKey();
      if (check.error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(check.content, null, 2),
            },
          ],
        };
      }

      try {
        const data = await amapRequest(
          AMAP_REGEO_URL,
          { location: `${longitude},${latitude}` },
          AMAP_KEY,
        );
        if (data.status === '0') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: data.info }, null, 2),
              },
            ],
          };
        }
        const regeo = data.regeocode;
        if (!regeo) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: '未找到该坐标' }, null, 2),
              },
            ],
          };
        }
        const result = {
          address: regeo.formatted_address,
          province: regeo.addressComponent.province,
          city: regeo.addressComponent.city,
          district: regeo.addressComponent.district,
          township: regeo.addressComponent.township,
          street: regeo.addressComponent.streetNumber?.street || '',
          building: regeo.addressComponent.building?.name || '',
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: String(e) }, null, 2),
            },
          ],
        };
      }
    },
  );

  // IP 定位（获取当前 IP 所在位置）
  server.registerTool(
    'amap_ip_location',
    {
      title: 'IP 定位',
      description: '通过高德地图 API 根据 IP 获取当前位置信息',
      inputSchema: {
        ip: z.string().optional().describe('IP 地址，默认使用当前 IP'),
      },
    },
    async ({ ip }) => {
      const check = checkKey();
      if (check.error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(check.content, null, 2),
            },
          ],
        };
      }

      try {
        const params: Record<string, string> = {};
        if (ip) params.ip = ip;
        const data = await amapRequest(AMAP_IP_URL, params, AMAP_KEY);
        if (data.status === '0') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: data.info }, null, 2),
              },
            ],
          };
        }
        const result = {
          country: data.country || '中国',
          province: data.province,
          city: data.city,
          adcode: data.adcode,
          rectangle: data.rectangle,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: String(e) }, null, 2),
            },
          ],
        };
      }
    },
  );
}
