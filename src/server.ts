/**
 * MCP Server setup and tool registration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { AzureAuthManager } from './azure/auth.js';
import { getAppContext } from './context.js';
import { tools, executeTool } from './tools/index.js';

export async function runServer(): Promise<void> {
  const server = new Server(
    {
      name: 'appservice-logs-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Initialize Azure auth
  const authManager = new AzureAuthManager();

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Execute tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    console.error(`[appservice-logs-mcp] Tool called: ${name}`);
    if (args && Object.keys(args).length > 0) {
      console.error(`[appservice-logs-mcp] Arguments: ${JSON.stringify(args)}`);
    }
    
    try {
      const result = await executeTool(name, args || {}, authManager);
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // List resources (app context)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const context = getAppContext();
    if (!context) {
      return { resources: [] };
    }
    
    return {
      resources: [
        {
          uri: `appservice://${context.subscriptionId}/${context.resourceGroup}/${context.appName}`,
          name: `App Service: ${context.appName}`,
          description: `Current app context: ${context.appName} in ${context.resourceGroup}`,
          mimeType: 'application/json',
        },
      ],
    };
  });

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const context = getAppContext();
    if (!context) {
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'No app context configured' }),
          },
        ],
      };
    }

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(context, null, 2),
        },
      ],
    };
  });

  // Create transport and run
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
