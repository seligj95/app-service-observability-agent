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

  // Deployment diagnosis
  {
    name: 'diagnose_deployment',
    description: 'Diagnose issues with a recent deployment. Correlates deployment time with platform logs, startup probes, container lifecycle, and first HTTP requests. Use this when an app fails after deployment.',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentIndex: {
          type: 'number',
          description: 'Which deployment to diagnose (0 = most recent, 1 = second most recent, etc.). Default: 0',
          default: 0,
        },
        windowMinutes: {
          type: 'number',
          description: 'Minutes after deployment to analyze (default: 10)',
          default: 10,
        },
      },
    },
  },

  // Logging setup check
  {
    name: 'check_logging_setup',
    description: 'Check if logging is properly configured for this app\'s runtime. Detects the runtime (Node.js, Python, .NET, Java) and provides specific recommendations for improving log output.',
    inputSchema: {
      type: 'object',
      properties: {},
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

    case 'diagnose_deployment': {
      const context = requireAppContext();
      const deploymentIndex = (args.deploymentIndex as number) || 0;
      const windowMinutes = (args.windowMinutes as number) || 10;
      
      // Get deployment info
      const deployments = await armClient.getDeployments(context, deploymentIndex + 1);
      if (deployments.length <= deploymentIndex) {
        return `Error: No deployment found at index ${deploymentIndex}. Only ${deployments.length} deployments available.`;
      }
      
      const deployment = deployments[deploymentIndex];
      const deployTime = new Date(deployment.startTime || deployment.endTime);
      const endTime = new Date(deployTime.getTime() + windowMinutes * 60 * 1000);
      
      let result = `## Deployment Diagnosis\n\n`;
      result += `**Deployment:** ${deployTime.toISOString()}\n`;
      result += `**Status:** ${deployment.status || 'Unknown'}\n`;
      result += `**Deployer:** ${deployment.deployer || 'N/A'}\n`;
      result += `**Message:** ${deployment.message || 'N/A'}\n\n`;
      
      // Check if Log Analytics is available
      const workspaceId = await getWorkspaceId(context, armClient);
      
      if (workspaceId) {
        // Query platform logs for startup issues
        const platformQuery = `AppServicePlatformLogs
| where TimeGenerated between (datetime('${deployTime.toISOString()}') .. datetime('${endTime.toISOString()}'))
| project TimeGenerated, Message
| order by TimeGenerated asc`;
        
        const platformLogs = await logAnalytics.query(workspaceId, platformQuery, windowMinutes);
        
        // Query console logs for app errors
        const consoleQuery = `AppServiceConsoleLogs
| where TimeGenerated between (datetime('${deployTime.toISOString()}') .. datetime('${endTime.toISOString()}'))
| project TimeGenerated, ResultDescription
| order by TimeGenerated asc`;
        
        const consoleLogs = await logAnalytics.query(workspaceId, consoleQuery, windowMinutes);
        
        // Query HTTP logs for first requests
        const httpQuery = `AppServiceHTTPLogs
| where TimeGenerated between (datetime('${deployTime.toISOString()}') .. datetime('${endTime.toISOString()}'))
| project TimeGenerated, CsMethod, CsUriStem, ScStatus, TimeTaken
| order by TimeGenerated asc
| take 20`;
        
        const httpLogs = await logAnalytics.query(workspaceId, httpQuery, windowMinutes);
        
        // Analyze platform logs
        result += `### Platform Events (${platformLogs.rows?.length || 0} events)\n\n`;
        if (platformLogs.rows && platformLogs.rows.length > 0) {
          const startupEvents = platformLogs.rows.filter((r: any) => 
            r.Message?.includes('start') || r.Message?.includes('probe') || r.Message?.includes('running')
          );
          const errorEvents = platformLogs.rows.filter((r: any) => 
            r.Message?.toLowerCase().includes('error') || 
            r.Message?.toLowerCase().includes('fail') ||
            r.Message?.toLowerCase().includes('crash') ||
            r.Message?.toLowerCase().includes('oom') ||
            r.Message?.toLowerCase().includes('memory')
          );
          const terminateEvents = platformLogs.rows.filter((r: any) => 
            r.Message?.includes('terminat') || r.Message?.includes('stop')
          );
          
          if (errorEvents.length > 0) {
            result += `⚠️ **Errors detected:**\n`;
            for (const evt of errorEvents.slice(0, 5)) {
              result += `- \`${evt.Message}\`\n`;
            }
            result += `\n`;
          }
          
          if (startupEvents.length > 0) {
            result += `**Startup sequence:**\n`;
            for (const evt of startupEvents.slice(0, 5)) {
              result += `- ${new Date(evt.TimeGenerated as string).toISOString()}: ${evt.Message}\n`;
            }
            result += `\n`;
          }
          
          if (terminateEvents.length > 0) {
            result += `**Container terminations:**\n`;
            for (const evt of terminateEvents.slice(0, 3)) {
              result += `- ${new Date(evt.TimeGenerated as string).toISOString()}: ${evt.Message}\n`;
            }
            result += `\n`;
          }
        } else {
          result += `_No platform events found in this window._\n\n`;
        }
        
        // Analyze console logs
        result += `### Application Logs (${consoleLogs.rows?.length || 0} entries)\n\n`;
        if (consoleLogs.rows && consoleLogs.rows.length > 0) {
          const errorLogs = consoleLogs.rows.filter((r: any) => 
            r.ResultDescription?.toLowerCase().includes('error') ||
            r.ResultDescription?.toLowerCase().includes('exception') ||
            r.ResultDescription?.toLowerCase().includes('fail')
          );
          
          if (errorLogs.length > 0) {
            result += `⚠️ **Application errors:**\n\`\`\`\n`;
            for (const log of errorLogs.slice(0, 5)) {
              result += `${log.ResultDescription}\n`;
            }
            result += `\`\`\`\n\n`;
          } else {
            result += `✅ No application errors detected.\n\n`;
          }
        } else {
          result += `_No console output in this window._\n\n`;
        }
        
        // Analyze HTTP logs
        result += `### First HTTP Requests (${httpLogs.rows?.length || 0} requests)\n\n`;
        if (httpLogs.rows && httpLogs.rows.length > 0) {
          const errors = httpLogs.rows.filter((r: any) => r.ScStatus >= 500);
          const successful = httpLogs.rows.filter((r: any) => r.ScStatus < 400);
          
          if (errors.length > 0) {
            result += `⚠️ **HTTP 5xx errors:** ${errors.length}\n`;
            for (const req of errors.slice(0, 5)) {
              result += `- ${req.ScStatus} ${req.CsMethod} ${req.CsUriStem} (${req.TimeTaken}ms)\n`;
            }
            result += `\n`;
          }
          
          if (successful.length > 0) {
            result += `✅ **Successful requests:** ${successful.length}\n`;
            const firstSuccess = successful[0];
            result += `- First success: ${firstSuccess.CsMethod} ${firstSuccess.CsUriStem} at ${new Date(firstSuccess.TimeGenerated as string).toISOString()}\n\n`;
          }
        } else {
          result += `_No HTTP requests in this window (app may not have received traffic yet)._\n\n`;
        }
        
      } else {
        result += `⚠️ Log Analytics not configured. Limited diagnosis available.\n\n`;
        
        // Fall back to Kudu logs
        const kuduLogs = await kudu.getRecentLogs(context.appName, 100);
        result += `### Recent Container Logs\n\n`;
        if (kuduLogs.entries && kuduLogs.entries.length > 0) {
          result += `\`\`\`\n${kuduLogs.entries.slice(0, 30).map(e => e.content).join('\n')}\n\`\`\`\n\n`;
        }
      }
      
      // Summary
      result += `### Diagnosis Summary\n\n`;
      result += `Analyzed ${windowMinutes} minutes after deployment at ${deployTime.toISOString()}.\n`;
      result += `Use \`correlate_events\` with specific timestamps for deeper investigation.`;
      
      return result;
    }

    case 'check_logging_setup': {
      const context = requireAppContext();
      const appInfo = await armClient.getAppInfo(context);
      const diagnostics = await armClient.getDiagnosticSettings(context);
      
      let result = `## Logging Setup Check\n\n`;
      result += `**App:** ${appInfo.name}\n`;
      
      // Detect runtime
      const runtime = appInfo.linuxFxVersion || appInfo.windowsFxVersion || appInfo.kind || 'unknown';
      result += `**Runtime:** ${runtime}\n\n`;
      
      // Diagnostic settings status
      result += `### Diagnostic Settings\n\n`;
      if (diagnostics.enabled) {
        result += `✅ Log Analytics: Enabled\n`;
        result += `**Enabled categories:** ${diagnostics.categories.join(', ') || 'None'}\n\n`;
        
        const recommended = ['AppServiceHTTPLogs', 'AppServiceConsoleLogs', 'AppServicePlatformLogs', 'AppServiceAppLogs'];
        const missing = recommended.filter(c => !diagnostics.categories.includes(c));
        if (missing.length > 0) {
          result += `⚠️ **Missing recommended categories:** ${missing.join(', ')}\n\n`;
        }
      } else {
        result += `❌ Log Analytics: Not configured\n\n`;
        result += `**Recommendation:** Enable diagnostic settings to send logs to Log Analytics for full debugging capability.\n\n`;
        result += `\`\`\`bash\n`;
        result += `az monitor diagnostic-settings create \\\n`;
        result += `  --name "logs-to-la" \\\n`;
        result += `  --resource "/subscriptions/{sub}/resourceGroups/${context.resourceGroup}/providers/Microsoft.Web/sites/${context.appName}" \\\n`;
        result += `  --workspace "{workspace-id}" \\\n`;
        result += `  --logs '[{"category":"AppServiceHTTPLogs","enabled":true},{"category":"AppServiceConsoleLogs","enabled":true},{"category":"AppServicePlatformLogs","enabled":true},{"category":"AppServiceAppLogs","enabled":true}]'\n`;
        result += `\`\`\`\n\n`;
      }
      
      // Runtime-specific recommendations
      result += `### Runtime-Specific Recommendations\n\n`;
      
      const runtimeLower = runtime.toLowerCase();
      
      if (runtimeLower.includes('node')) {
        result += `**Node.js detected**\n\n`;
        result += `For best logging visibility:\n\n`;
        result += `1. **Use console.log/console.error** — These write to stdout/stderr and are captured by App Service\n`;
        result += `2. **Structured logging** — Consider using a library like \`pino\` or \`winston\` with JSON output:\n`;
        result += `   \`\`\`javascript\n`;
        result += `   const pino = require('pino');\n`;
        result += `   const logger = pino({ level: process.env.LOG_LEVEL || 'info' });\n`;
        result += `   logger.info({ userId: 123 }, 'User logged in');\n`;
        result += `   \`\`\`\n`;
        result += `3. **Set LOG_LEVEL** environment variable to control verbosity\n`;
        result += `4. **Avoid** writing to files — use stdout/stderr instead\n\n`;
        
      } else if (runtimeLower.includes('python')) {
        result += `**Python detected**\n\n`;
        result += `Python logging requires explicit configuration to work well with App Service:\n\n`;
        result += `1. **Configure the logging module** to output to stdout:\n`;
        result += `   \`\`\`python\n`;
        result += `   import logging\n`;
        result += `   import sys\n`;
        result += `   \n`;
        result += `   logging.basicConfig(\n`;
        result += `       level=logging.INFO,\n`;
        result += `       format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',\n`;
        result += `       handlers=[logging.StreamHandler(sys.stdout)]\n`;
        result += `   )\n`;
        result += `   \`\`\`\n`;
        result += `2. **Gunicorn users**: Add \`--access-logfile -\` and \`--error-logfile -\` to log to stdout\n`;
        result += `3. **Flask/Django**: Ensure app loggers also use StreamHandler\n`;
        result += `4. **Set PYTHONUNBUFFERED=1** in app settings to prevent output buffering\n\n`;
        result += `⚠️ **Common issue:** Python's default logging doesn't output anywhere visible. You must configure handlers.\n\n`;
        
      } else if (runtimeLower.includes('dotnet') || runtimeLower.includes('.net')) {
        result += `**.NET detected**\n\n`;
        result += `.NET has good default logging integration with App Service:\n\n`;
        result += `1. **Use ILogger<T>** — Built-in and captured automatically:\n`;
        result += `   \`\`\`csharp\n`;
        result += `   public class MyService\n`;
        result += `   {\n`;
        result += `       private readonly ILogger<MyService> _logger;\n`;
        result += `       public MyService(ILogger<MyService> logger) => _logger = logger;\n`;
        result += `       public void DoWork() => _logger.LogInformation("Processing...");\n`;
        result += `   }\n`;
        result += `   \`\`\`\n`;
        result += `2. **Configure log levels** in appsettings.json or via LOGGING__LOGLEVEL__DEFAULT\n`;
        result += `3. **Enable Application Insights** for richer telemetry (add Microsoft.ApplicationInsights.AspNetCore)\n`;
        result += `4. **For Console apps**, ensure you configure logging in Program.cs\n\n`;
        
      } else if (runtimeLower.includes('java')) {
        result += `**Java detected**\n\n`;
        result += `Java logging depends on your framework:\n\n`;
        result += `1. **Spring Boot**: Configure in application.properties:\n`;
        result += `   \`\`\`properties\n`;
        result += `   logging.level.root=INFO\n`;
        result += `   logging.pattern.console=%d{yyyy-MM-dd HH:mm:ss} - %msg%n\n`;
        result += `   \`\`\`\n`;
        result += `2. **Use SLF4J/Logback** and ensure logs go to stdout\n`;
        result += `3. **Avoid file appenders** — use ConsoleAppender instead\n`;
        result += `4. **Set JAVA_OPTS** for additional JVM logging if needed\n\n`;
        
      } else {
        result += `**Runtime:** ${runtime}\n\n`;
        result += `General recommendations:\n`;
        result += `- Ensure your app writes logs to stdout/stderr\n`;
        result += `- Avoid writing to local files\n`;
        result += `- Use structured logging (JSON) when possible for better querying\n`;
        result += `- Set appropriate log levels via environment variables\n\n`;
      }
      
      // App settings check
      result += `### Suggested App Settings\n\n`;
      result += `| Setting | Purpose |\n`;
      result += `|---------|--------|\n`;
      if (runtimeLower.includes('python')) {
        result += `| \`PYTHONUNBUFFERED=1\` | Disable output buffering |\n`;
      }
      if (runtimeLower.includes('node')) {
        result += `| \`LOG_LEVEL=info\` | Control logging verbosity |\n`;
      }
      result += `| \`WEBSITE_HTTPLOGGING_RETENTION_DAYS=7\` | Retain HTTP logs |\n`;
      result += `| \`DIAGNOSTICS_AZUREBLOBRETENTIONINDAYS=7\` | Retain blob diagnostics |\n`;
      
      return result;
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
