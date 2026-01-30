/**
 * Log Analytics connector - query Azure Monitor logs via KQL
 */

import { LogsQueryClient, LogsQueryResultStatus } from '@azure/monitor-query';
import { AzureAuthManager } from './auth.js';
import { AppContext } from '../context.js';

// Query constraints
const MAX_ROWS = 500;
const MAX_TIMERANGE_DAYS = 7;
const QUERY_TIMEOUT_MS = 30000;

export interface LogQueryResult {
  success: boolean;
  rowCount: number;
  truncated: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  queryTimeMs: number;
  error?: string;
}

export interface LogAnalyticsConfig {
  workspaceId: string;
}

export class LogAnalyticsConnector {
  private client: LogsQueryClient;
  
  constructor(private authManager: AzureAuthManager) {
    this.client = authManager.getLogsQueryClient();
  }

  /**
   * Execute a KQL query with guardrails
   */
  async query(
    workspaceId: string,
    kqlQuery: string,
    timeRangeMinutes: number = 60
  ): Promise<LogQueryResult> {
    const startTime = Date.now();
    
    // Validate time range
    const maxMinutes = MAX_TIMERANGE_DAYS * 24 * 60;
    if (timeRangeMinutes > maxMinutes) {
      return {
        success: false,
        rowCount: 0,
        truncated: false,
        columns: [],
        rows: [],
        queryTimeMs: 0,
        error: `Time range exceeds maximum of ${MAX_TIMERANGE_DAYS} days. Use a shorter time range.`,
      };
    }

    // Add row limit if not present
    const limitedQuery = this.addRowLimit(kqlQuery, MAX_ROWS);

    try {
      const endTime = new Date();
      const startTimeDate = new Date(endTime.getTime() - timeRangeMinutes * 60 * 1000);

      const result = await this.client.queryWorkspace(
        workspaceId,
        limitedQuery,
        { startTime: startTimeDate, endTime },
        { serverTimeoutInSeconds: QUERY_TIMEOUT_MS / 1000 }
      );

      const queryTimeMs = Date.now() - startTime;

      if (result.status === LogsQueryResultStatus.Success && result.tables.length > 0) {
        const table = result.tables[0];
        const columnDescriptors = table.columnDescriptors || [];
        const columns = columnDescriptors.map((c) => c.name || '');
        const rows = table.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          columns.forEach((col, idx) => {
            obj[col] = row[idx];
          });
          return obj;
        });

        return {
          success: true,
          rowCount: rows.length,
          truncated: rows.length >= MAX_ROWS,
          columns,
          rows,
          queryTimeMs,
        };
      } else if (result.status === LogsQueryResultStatus.PartialFailure) {
        return {
          success: false,
          rowCount: 0,
          truncated: false,
          columns: [],
          rows: [],
          queryTimeMs,
          error: `Partial query failure: ${result.partialError?.message || 'Unknown error'}`,
        };
      } else {
        return {
          success: true,
          rowCount: 0,
          truncated: false,
          columns: [],
          rows: [],
          queryTimeMs,
        };
      }
    } catch (error) {
      return {
        success: false,
        rowCount: 0,
        truncated: false,
        columns: [],
        rows: [],
        queryTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Query HTTP logs (AppServiceHTTPLogs)
   */
  async queryHttpLogs(
    workspaceId: string,
    timeRangeMinutes: number,
    filter?: { statusCode?: number; path?: string; minDurationMs?: number }
  ): Promise<LogQueryResult> {
    let query = `AppServiceHTTPLogs
| where TimeGenerated > ago(${timeRangeMinutes}m)`;

    if (filter?.statusCode) {
      query += `\n| where ScStatus == ${filter.statusCode}`;
    }
    if (filter?.path) {
      query += `\n| where CsUriStem contains "${filter.path}"`;
    }
    if (filter?.minDurationMs) {
      query += `\n| where TimeTaken >= ${filter.minDurationMs}`;
    }

    query += `\n| project TimeGenerated, CsMethod, CsUriStem, ScStatus, TimeTaken, CsHost, UserAgent
| order by TimeGenerated desc`;

    return this.query(workspaceId, query, timeRangeMinutes);
  }

  /**
   * Query HTTP errors (5xx status codes)
   */
  async queryHttpErrors(
    workspaceId: string,
    timeRangeMinutes: number
  ): Promise<LogQueryResult> {
    const query = `AppServiceHTTPLogs
| where TimeGenerated > ago(${timeRangeMinutes}m)
| where ScStatus >= 500
| summarize Count=count(), AvgDuration=avg(TimeTaken) by ScStatus, CsUriStem
| order by Count desc`;

    return this.query(workspaceId, query, timeRangeMinutes);
  }

  /**
   * Query application logs (stdout/stderr)
   */
  async queryAppLogs(
    workspaceId: string,
    timeRangeMinutes: number,
    filter?: string
  ): Promise<LogQueryResult> {
    let query = `AppServiceConsoleLogs
| where TimeGenerated > ago(${timeRangeMinutes}m)`;

    if (filter) {
      query += `\n| where ResultDescription contains "${filter}"`;
    }

    query += `\n| project TimeGenerated, Level, ResultDescription, Host
| order by TimeGenerated desc`;

    return this.query(workspaceId, query, timeRangeMinutes);
  }

  /**
   * Query platform logs (deployments, restarts, etc.)
   */
  async queryPlatformLogs(
    workspaceId: string,
    timeRangeMinutes: number
  ): Promise<LogQueryResult> {
    const query = `AppServicePlatformLogs
| where TimeGenerated > ago(${timeRangeMinutes}m)
| project TimeGenerated, Level, Message, ContainerName, Host
| order by TimeGenerated desc`;

    return this.query(workspaceId, query, timeRangeMinutes);
  }

  /**
   * Query slow requests
   */
  async querySlowRequests(
    workspaceId: string,
    timeRangeMinutes: number,
    thresholdMs: number = 1000
  ): Promise<LogQueryResult> {
    const query = `AppServiceHTTPLogs
| where TimeGenerated > ago(${timeRangeMinutes}m)
| where TimeTaken >= ${thresholdMs}
| project TimeGenerated, CsMethod, CsUriStem, ScStatus, TimeTaken
| order by TimeTaken desc`;

    return this.query(workspaceId, query, timeRangeMinutes);
  }

  /**
   * Get error summary with patterns
   */
  async getErrorSummary(
    workspaceId: string,
    timeRangeMinutes: number
  ): Promise<LogQueryResult> {
    const query = `AppServiceHTTPLogs
| where TimeGenerated > ago(${timeRangeMinutes}m)
| where ScStatus >= 400
| summarize 
    TotalCount=count(),
    AvgDuration=avg(TimeTaken),
    MaxDuration=max(TimeTaken),
    FirstSeen=min(TimeGenerated),
    LastSeen=max(TimeGenerated)
  by ScStatus, CsUriStem
| order by TotalCount desc`;

    return this.query(workspaceId, query, timeRangeMinutes);
  }

  /**
   * Add row limit to query if not already present
   */
  private addRowLimit(query: string, limit: number): string {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('| limit') || lowerQuery.includes('| take')) {
      return query;
    }
    return `${query}\n| limit ${limit}`;
  }
}

/**
 * Common KQL query templates
 */
export const KQL_TEMPLATES = {
  httpErrors: (minutes: number) => `
AppServiceHTTPLogs
| where TimeGenerated > ago(${minutes}m)
| where ScStatus >= 500
| summarize Count=count() by ScStatus, CsUriStem
| order by Count desc`,

  slowRequests: (minutes: number, thresholdMs: number) => `
AppServiceHTTPLogs
| where TimeGenerated > ago(${minutes}m)
| where TimeTaken >= ${thresholdMs}
| project TimeGenerated, CsMethod, CsUriStem, ScStatus, TimeTaken
| order by TimeTaken desc`,

  recentDeployments: (hours: number) => `
AppServicePlatformLogs
| where TimeGenerated > ago(${hours}h)
| where Message contains "deployment" or Message contains "restart"
| project TimeGenerated, Level, Message
| order by TimeGenerated desc`,

  containerRestarts: (hours: number) => `
AppServicePlatformLogs
| where TimeGenerated > ago(${hours}h)
| where Message contains "Container" and (Message contains "start" or Message contains "stop" or Message contains "exit")
| project TimeGenerated, Level, Message, ContainerName
| order by TimeGenerated desc`,

  errorTimeline: (minutes: number) => `
AppServiceHTTPLogs
| where TimeGenerated > ago(${minutes}m)
| where ScStatus >= 500
| summarize ErrorCount=count() by bin(TimeGenerated, 5m), ScStatus
| order by TimeGenerated asc`,
};
