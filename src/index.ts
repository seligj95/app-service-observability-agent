#!/usr/bin/env node
/**
 * App Service Logs MCP Server
 * 
 * An MCP server that exposes Azure App Service log querying and analysis tools.
 * Demonstrates what native App Service MCP support could look like.
 */

import { runServer } from './server.js';

async function main() {
  if (process.env.HTTP_MODE === 'true') {
    const port = parseInt(process.env.PORT || '3000', 10);
    console.error(`[appservice-logs-mcp] Starting HTTP server on port ${port}`);
  } else {
    console.error('[appservice-logs-mcp] Starting in stdio mode');
  }
  
  await runServer();
}

main().catch((error) => {
  console.error('[appservice-logs-mcp] Fatal error:', error);
  process.exit(1);
});
