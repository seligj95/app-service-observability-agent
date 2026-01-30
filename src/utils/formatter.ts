/**
 * Response formatting utilities for LLM-friendly output
 */

import { LogQueryResult } from '../azure/log-analytics.js';
import { KuduLogsResult } from '../azure/kudu.js';
import { AppInfo, DiagnosticInfo } from '../azure/arm.js';

export interface FormattedResponse {
  summary: string;
  details?: string;
  data?: Record<string, unknown>;
}

/**
 * Format app info for display
 */
export function formatAppInfo(info: AppInfo): FormattedResponse {
  const lines = [
    `**${info.name}**`,
    `- Location: ${info.location}`,
    `- State: ${info.state}`,
    `- URL: https://${info.defaultHostName}`,
    `- Kind: ${info.kind}`,
  ];

  if (info.sku) {
    lines.push(`- SKU: ${info.sku}`);
  }
  if (info.linuxFxVersion) {
    lines.push(`- Runtime: ${info.linuxFxVersion}`);
  }
  if (info.windowsFxVersion) {
    lines.push(`- Runtime: ${info.windowsFxVersion}`);
  }

  return {
    summary: lines.join('\n'),
    data: info as unknown as Record<string, unknown>,
  };
}

/**
 * Format diagnostic settings info
 */
export function formatDiagnosticInfo(info: DiagnosticInfo): FormattedResponse {
  if (!info.enabled) {
    return {
      summary: `⚠️ **Diagnostic settings not configured**

Log Analytics is not enabled for this app. Only Kudu container logs are available.

To enable full log querying:
1. Go to Azure Portal → App Service → Diagnostic settings
2. Add a diagnostic setting
3. Enable log categories: AppServiceHTTPLogs, AppServiceConsoleLogs, AppServicePlatformLogs
4. Select a Log Analytics workspace as destination`,
      data: info as unknown as Record<string, unknown>,
    };
  }

  const lines = [
    `✅ **Diagnostic settings enabled**`,
    `- Log Analytics: ${info.logAnalyticsWorkspaceId ? 'Yes' : 'No'}`,
  ];

  if (info.storageAccountId) {
    lines.push(`- Storage Account: Yes`);
  }
  if (info.eventHubId) {
    lines.push(`- Event Hub: Yes`);
  }
  if (info.categories.length > 0) {
    lines.push(`- Enabled categories: ${info.categories.join(', ')}`);
  }

  return {
    summary: lines.join('\n'),
    data: info as unknown as Record<string, unknown>,
  };
}

/**
 * Format Log Analytics query results
 */
export function formatLogQueryResult(result: LogQueryResult, context?: string): FormattedResponse {
  if (!result.success) {
    return {
      summary: `❌ **Query failed**\n${result.error}`,
    };
  }

  if (result.rowCount === 0) {
    return {
      summary: context 
        ? `No ${context} found in the specified time range.`
        : 'No results found.',
    };
  }

  // Build summary
  let summary = context ? `**${context}** (${result.rowCount} entries)` : `**Results** (${result.rowCount} entries)`;
  
  if (result.truncated) {
    summary += ` ⚠️ Results truncated - use filters to narrow down`;
  }

  // Format as table if reasonable size
  if (result.rows.length <= 20 && result.columns.length <= 6) {
    summary += '\n\n' + formatAsMarkdownTable(result.columns, result.rows);
  } else {
    // Show first few rows as list
    summary += '\n\n**Sample entries:**\n';
    for (const row of result.rows.slice(0, 10)) {
      summary += formatRowAsList(row) + '\n';
    }
    if (result.rows.length > 10) {
      summary += `\n... and ${result.rows.length - 10} more entries`;
    }
  }

  summary += `\n\n_Query time: ${result.queryTimeMs}ms_`;

  return {
    summary,
    data: {
      rowCount: result.rowCount,
      truncated: result.truncated,
      columns: result.columns,
      rows: result.rows,
    },
  };
}

/**
 * Format Kudu logs result
 */
export function formatKuduLogs(result: KuduLogsResult, maxDisplay: number = 50): FormattedResponse {
  if (!result.success) {
    return {
      summary: `❌ **Failed to fetch logs**\n${result.error}`,
    };
  }

  if (result.entries.length === 0) {
    return {
      summary: 'No recent log entries found.',
    };
  }

  let summary = `**Recent container logs** (${result.entries.length} lines)\n\n`;
  summary += '```\n';
  
  const displayEntries = result.entries.slice(-maxDisplay);
  for (const entry of displayEntries) {
    summary += `${entry.content}\n`;
  }
  
  summary += '```';

  if (result.entries.length > maxDisplay) {
    summary += `\n\n_Showing last ${maxDisplay} of ${result.entries.length} lines_`;
  }

  return {
    summary,
    data: {
      entryCount: result.entries.length,
      entries: result.entries,
    },
  };
}

/**
 * Format error summary
 */
export function formatErrorSummary(result: LogQueryResult): FormattedResponse {
  if (!result.success) {
    return {
      summary: `❌ **Query failed**\n${result.error}`,
    };
  }

  if (result.rowCount === 0) {
    return {
      summary: '✅ **No errors found** in the specified time range.',
    };
  }

  let summary = `⚠️ **Error Summary** (${result.rowCount} error patterns)\n\n`;
  
  // Group by status code
  const byStatus: Record<number, any[]> = {};
  for (const row of result.rows) {
    const status = row.ScStatus as number;
    if (!byStatus[status]) byStatus[status] = [];
    byStatus[status].push(row);
  }

  for (const [status, errors] of Object.entries(byStatus)) {
    const totalCount = errors.reduce((sum, e) => sum + (e.TotalCount || e.Count || 1), 0);
    summary += `### HTTP ${status} (${totalCount} occurrences)\n`;
    
    for (const error of errors.slice(0, 5)) {
      const path = error.CsUriStem || 'unknown';
      const count = error.TotalCount || error.Count || 1;
      summary += `- \`${path}\`: ${count} times\n`;
    }
    if (errors.length > 5) {
      summary += `- ... and ${errors.length - 5} more paths\n`;
    }
    summary += '\n';
  }

  return {
    summary,
    data: {
      rowCount: result.rowCount,
      rows: result.rows,
    },
  };
}

/**
 * Format deployments list
 */
export function formatDeployments(deployments: any[]): FormattedResponse {
  if (deployments.length === 0) {
    return {
      summary: 'No recent deployments found.',
    };
  }

  let summary = `**Recent Deployments** (${deployments.length})\n\n`;
  
  for (const dep of deployments) {
    const status = dep.status === 4 ? '✅' : dep.status === 3 ? '❌' : '⏳';
    const time = dep.endTime ? new Date(dep.endTime).toLocaleString() : 'In progress';
    summary += `${status} **${time}**\n`;
    if (dep.message) summary += `   ${dep.message}\n`;
    if (dep.author) summary += `   by ${dep.author}\n`;
    summary += '\n';
  }

  return {
    summary,
    data: { deployments },
  };
}

/**
 * Format rows as markdown table
 */
function formatAsMarkdownTable(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) return '';

  // Build header
  let table = '| ' + columns.join(' | ') + ' |\n';
  table += '| ' + columns.map(() => '---').join(' | ') + ' |\n';

  // Build rows
  for (const row of rows) {
    const cells = columns.map((col) => {
      const value = row[col];
      if (value === null || value === undefined) return '';
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value).substring(0, 50); // Truncate long values
    });
    table += '| ' + cells.join(' | ') + ' |\n';
  }

  return table;
}

/**
 * Format a single row as a list
 */
function formatRowAsList(row: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined) {
      parts.push(`${key}: ${value}`);
    }
  }
  return '- ' + parts.join(', ');
}
