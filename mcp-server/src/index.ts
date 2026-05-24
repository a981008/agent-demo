import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';

const server = new McpServer(
  { name: 'mcp-demo-server', version: '1.0.0' },
  { capabilities: { tools: {}, prompts: {}, resources: {} } },
);

registerTools(server);
registerPrompts(server);
registerResources(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.log(JSON.stringify({ type: 'ready' }));
