/**
 * MCP Tool definitions and execution
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AzureAuthManager } from '../azure/auth.js';
import { ArmClient } from '../azure/arm.js';
import { LogAnalyticsConnector } from '../azure/log-analytics.js';
import { KuduConnector } from '../azure/kudu.js';
import { 
  getAppContext, 
  setAppContext, 
  requireAppContext, 
  updateDiagnosticInfo,
  AppContext 
} from '../context.js';
import {
  formatAppInfo,
  formatDiagnosticInfo,
  formatLogQueryResult,
  formatKuduLogs,
  formatErrorSummary,
  formatDeployments,
} from '../utils/formatter.js';

/**
 * Tool definitions
 */
export const tools: Tool[] = [
  // Context management
  {
    name: 'get_context',
    description: 'Show the currently configured App Service (subscription, resource group, app name). Call this first to see which app is selected.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_context',
    description: 'Set the App Service to query. Required before using other tools if environment variables are not set.',
    inputSchema: {
      type: 'object',
      properties: {
        subscriptionId: {
          type: 'string',
          description: 'Azure subscription ID',
        },
        resourceGroup: {
          type: 'string',
          description: 'Resource group name',
        },
        appName: {
          type: 'string',
          description: 'App Service name',
        },
      },
      required: ['subscriptionId', 'resourceGroup', 'appName'],
    },
  },
  {
    name: 'list_apps',
    description: 'List App Service apps in a subscription or resource group',
    inputSchema: {
      type: 'object',
      properties: {
        subscriptionId: {
          type: 'string',
          description: 'Azure subscription ID. Uses current context if not provided.',
        },
        resourceGroup: {
          type: 'string',
          description: 'Optional: filter by resource group',
        },
      },
    },
  },

  // Discovery
  {
    name: 'get_app_info',
    description: 'Get App Service details: SKU, region, URL, runtime, status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'check_diagnostics',
    description: 'Check if Log Analytics diagnostic settings are enabled. Shows what log types are available.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Log access
  {
    name: 'query_logs',
    description: 'Run a KQL query against Log Analytics. Requires diagnostic settings to be enabled. Use check_diagnostics first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'KQL query to execute. Example: AppServiceHTTPLogs | where ScStatus >= 500',
        },
        timeRangeMinutes: {
          type: 'number',
          description: 'Time range in minutes (default: 60, max: 10080 = 7 days)',
          default: 60,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_recent_logs',
    description: 'Get recent container/application logs from Kudu. Always available (no diagnostic settings required).',
    inputSchema: {
      type: 'object',
      properties: {
        maxLines: {
          type: 'number',
          description: 'Maximum lines to return (default: 100)',
          default: 100,
        },
        filter: {
          type: 'string',
          description: 'Optional text filter',
        },
      },
    },
  },

  // Pre-built queries
  {
    name: 'get_http_errors',
    description: 'Get HTTP 5xx errors grouped by status code and path. Requires Log Analytics.',
    inputSchema: {
      type: 'object',
      properties: {
        minutes: {
          type: 'number',
          description: 'Time range in minutes (default: 60)',
          default: 60,
        },
      },
    },
  },
  {
    name: 'get_slow_requests',
    description: 'Get requests slower than a threshold. Requires Log Analytics.',
    inputSchema: {
      type: 'object',
      properties: {
        minutes: {
          type: 'number',
          description: 'Time range in minutes (default: 60)',
          default: 60,
        },
        thresholdMs: {
          type: 'number',
          description: 'Latency threshold in milliseconds (default: 1000)',
          default: 1000,
        },
      },
    },
  },
  {
    name: 'get_deployments',
    description: 'Get recent deployment history',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum deployments to return (default: 10)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'get_restarts',
    description: 'Get container restart and lifecycle events. Requires Log Analytics for full history, falls back to Kudu.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: {
          type: 'number',
          description: 'Time range in hours (default: 24)',
          default: 24,
        },
      },
    },
  },

  // Analysis
  {
    name: 'summarize_errors',
    description: 'Analyze recent errors: patterns, frequency, affected endpoints. Requires Log Analytics.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: {
          type: 'number',
          description: 'Time range in hours (default: 24)',
          default: 24,
        },
      },
    },
  },
  {
    name: 'correlate_events',
    description: 'Find all events (HTTP logs, platform logs, app logs) around a specific timestamp',
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'string',
          description: 'ISO timestamp to search around (e.g., 2024-01-15T10:30:00Z)',
        },
        windowMinutes: {
          type: 'number',
          description: 'Minutes before and after timestamp to search (default: 5)',
          default: 5,
        },
      },
      required: ['timestamp'],
    },
  },
];

/**
 * Execute a tool call
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  authManager: AzureAuthManager
): Promise<string> {
  const armClient = new ArmClient(authManager);
  const logAnalytics = new LogAnalyticsConnector(authManager);
  const kudu = new KuduConnector(authManager);

  switch (name) {
    // Context management
    case 'get_context': {
      const context = getAppContext();
      if (!context) {
        return 'No App Service configured.\n\nUse `set_context` or set environment variables:\n- AZURE_SUBSCRIPTION_ID\n- AZURE_RESOURCE_GROUP\n- AZURE_APP_NAME';
      }
      return `**Current App Service**\n- Subscription: ${context.subscriptionId}\n- Resource Group: ${context.resourceGroup}\n- App: ${context.appName}`;
    }

    case 'set_context': {
      const ctx: AppContext = {
        subscriptionId: args.subscriptionId as string,
        resourceGroup: args.resourceGroup as string,
        appName: args.appName as string,
      };
      setAppContext(ctx);
      return `✅ Context set to **${ctx.appName}** in ${ctx.resourceGroup}`;
    }

    case 'list_apps': {
      const context = getAppContext();
      const subId = (args.subscriptionId as string) || context?.subscriptionId;
      if (!subId) {
        return 'Error: No subscription ID provided and no context set.';
      }
      const apps = await armClient.listApps(subId, args.resourceGroup as string);
      if (apps.length === 0) {
        return 'No App Service apps found.';
      }
      let result = `**App Service Apps** (${apps.length})\n\n`;
      for (const app of apps) {
        result += `- **${app.name}** (${app.resourceGroup}) - ${app.state}\n`;
      }
      return result;
    }

    // Discovery
    case 'get_app_info': {
      const context = requireAppContext();
      const info = await armClient.getAppInfo(context);
      return formatAppInfo(info).summary;
    }

    case 'check_diagnostics': {
      const context = requireAppContext();
      const diag = await armClient.getDiagnosticSettings(context);
      
      // Cache workspace ID for later use
      if (diag.logAnalyticsWorkspaceId) {
        const workspaceGuid = await armClient.resolveWorkspaceId(
          diag.logAnalyticsWorkspaceId,
          context.subscriptionId
        );
        updateDiagnosticInfo(workspaceGuid || undefined, diag.enabled);
      } else {
        updateDiagnosticInfo(undefined, false);
      }
      
      return formatDiagnosticInfo(diag).summary;
    }

    // Log access
    case 'query_logs': {
      const context = requireAppContext();
      const workspaceId = await getWorkspaceId(context, armClient);
      if (!workspaceId) {
        return 'Error: Log Analytics not configured. Use check_diagnostics to see status.\n\nFallback: Use get_recent_logs for Kudu container logs.';
      }
      const result = await logAnalytics.query(
        workspaceId,
        args.query as string,
        (args.timeRangeMinutes as number) || 60
      );
      return formatLogQueryResult(result, 'Query Results').summary;
    }

    case 'get_recent_logs': {
      const context = requireAppContext();
      const result = await kudu.getRecentLogs(
        context.appName,
        (args.maxLines as number) || 100,
        args.filter as string
      );
      return formatKuduLogs(result).summary;
    }

    // Pre-built queries
    case 'get_http_errors': {
      const context = requireAppContext();
      const workspaceId = await getWorkspaceId(context, armClient);
      if (!workspaceId) {
        return 'Error: Log Analytics not configured. HTTP error analysis requires diagnostic settings.';
      }
      const result = await logAnalytics.queryHttpErrors(
        workspaceId,
        (args.minutes as number) || 60
      );
      return formatErrorSummary(result).summary;
    }

    case 'get_slow_requests': {
      const context = requireAppContext();
      const workspaceId = await getWorkspaceId(context, armClient);
      if (!workspaceId) {
        return 'Error: Log Analytics not configured.';
      }
      const result = await logAnalytics.querySlowRequests(
        workspaceId,
        (args.minutes as number) || 60,
        (args.thresholdMs as number) || 1000
      );
      return formatLogQueryResult(result, `Slow Requests (>${args.thresholdMs || 1000}ms)`).summary;
    }

    case 'get_deployments': {
      const context = requireAppContext();
      const deployments = await armClient.getDeployments(context, (args.limit as number) || 10);
      return formatDeployments(deployments).summary;
    }

    case 'get_restarts': {
      const context = requireAppContext();
      const workspaceId = await getWorkspaceId(context, armClient);
      
      if (workspaceId) {
        const result = await logAnalytics.queryPlatformLogs(
          workspaceId,
          (args.hours as number) * 60 || 24 * 60
        );
        return formatLogQueryResult(result, 'Platform Events (restarts, deployments)').summary;
      }
      
      // Fallback to Kudu
      const kuduResult = await kudu.getRecentLogs(context.appName, 200);
      return formatKuduLogs(kuduResult).summary + '\n\n_Note: Full restart history requires Log Analytics._';
    }

    // Analysis
    case 'summarize_errors': {
      const context = requireAppContext();
      const workspaceId = await getWorkspaceId(context, armClient);
      if (!workspaceId) {
        return 'Error: Log Analytics not configured. Error analysis requires diagnostic settings.';
      }
      const result = await logAnalytics.getErrorSummary(
        workspaceId,
        (args.hours as number) * 60 || 24 * 60
      );
      return formatErrorSummary(result).summary;
    }

    case 'correlate_events': {
      const context = requireAppContext();
      const workspaceId = await getWorkspaceId(context, armClient);
      if (!workspaceId) {
        return 'Error: Log Analytics not configured.';
      }
      
      const timestamp = new Date(args.timestamp as string);
      const windowMs = ((args.windowMinutes as number) || 5) * 60 * 1000;
      const startTime = new Date(timestamp.getTime() - windowMs);
      const endTime = new Date(timestamp.getTime() + windowMs);
      
      const query = `union AppServiceHTTPLogs, AppServiceConsoleLogs, AppServicePlatformLogs
| where TimeGenerated between (datetime('${startTime.toISOString()}') .. datetime('${endTime.toISOString()}'))
| project TimeGenerated, Type=\$table, Message=coalesce(ResultDescription, Message, strcat(CsMethod, ' ', CsUriStem, ' ', ScStatus))
| order by TimeGenerated asc`;

      const result = await logAnalytics.query(workspaceId, query, 60);
      return formatLogQueryResult(result, `Events around ${args.timestamp}`).summary;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

/**
 * Helper to get workspace ID from context or fetch it
 */
async function getWorkspaceId(context: AppContext, armClient: ArmClient): Promise<string | null> {
  // Check cached
  if (context.logAnalyticsWorkspaceId) {
    return context.logAnalyticsWorkspaceId;
  }

  // Fetch diagnostic settings
  const diag = await armClient.getDiagnosticSettings(context);
  if (!diag.enabled || !diag.logAnalyticsWorkspaceId) {
    return null;
  }

  // Resolve workspace resource ID to GUID
  const workspaceGuid = await armClient.resolveWorkspaceId(
    diag.logAnalyticsWorkspaceId,
    context.subscriptionId
  );
  
  if (workspaceGuid) {
    updateDiagnosticInfo(workspaceGuid, true);
  }
  
  return workspaceGuid;
}
