/**
 * Kudu/SCM connector - access filesystem logs and container logs directly
 */

import { AzureAuthManager } from './auth.js';
import { AppContext } from '../context.js';

export interface KuduLogEntry {
  machineName: string;
  lastUpdated: string;
  size: number;
  href: string;
  path: string;
}

export interface ContainerLog {
  timestamp: string;
  content: string;
}

export interface KuduLogsResult {
  success: boolean;
  entries: ContainerLog[];
  error?: string;
}

export class KuduConnector {
  constructor(private authManager: AzureAuthManager) {}

  /**
   * Get the SCM URL for an app
   */
  private getScmUrl(appName: string): string {
    return `https://${appName}.scm.azurewebsites.net`;
  }

  /**
   * Fetch with auth headers
   */
  private async fetchWithAuth(url: string): Promise<Response> {
    const token = await this.authManager.getKuduToken();
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  }

  /**
   * List available container logs (docker logs)
   */
  async listContainerLogs(appName: string): Promise<KuduLogEntry[]> {
    const url = `${this.getScmUrl(appName)}/api/logs/docker`;
    
    try {
      const response = await this.fetchWithAuth(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return (await response.json()) as KuduLogEntry[];
    } catch (error) {
      throw new Error(
        `Failed to list container logs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get recent container logs
   */
  async getContainerLogs(
    appName: string,
    maxLines: number = 100
  ): Promise<KuduLogsResult> {
    try {
      // First list available logs
      const logs = await this.listContainerLogs(appName);
      
      if (logs.length === 0) {
        return {
          success: true,
          entries: [],
        };
      }

      // Sort by lastUpdated, get most recent
      logs.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
      
      // Fetch the most recent log file
      const recentLog = logs[0];
      const response = await this.fetchWithAuth(recentLog.href);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.text();
      const lines = content.split('\n').filter((line) => line.trim());
      
      // Take last N lines
      const recentLines = lines.slice(-maxLines);
      
      const entries: ContainerLog[] = recentLines.map((line) => {
        // Try to parse timestamp from common log formats
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
        return {
          timestamp: timestampMatch ? timestampMatch[1] : new Date().toISOString(),
          content: line,
        };
      });

      return {
        success: true,
        entries,
      };
    } catch (error) {
      return {
        success: false,
        entries: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List files in LogFiles directory
   */
  async listLogFiles(appName: string, path: string = '/LogFiles/'): Promise<KuduLogEntry[]> {
    const url = `${this.getScmUrl(appName)}/api/vfs${path}`;
    
    try {
      const response = await this.fetchWithAuth(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return (await response.json()) as KuduLogEntry[];
    } catch (error) {
      throw new Error(
        `Failed to list log files: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Read a specific log file
   */
  async readLogFile(appName: string, path: string, maxBytes: number = 100000): Promise<string> {
    const url = `${this.getScmUrl(appName)}/api/vfs${path}`;
    
    try {
      const response = await this.fetchWithAuth(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const content = await response.text();
      
      // Truncate if too large
      if (content.length > maxBytes) {
        return content.slice(-maxBytes) + '\n... (truncated)';
      }
      
      return content;
    } catch (error) {
      throw new Error(
        `Failed to read log file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get recent application logs from various sources
   */
  async getRecentLogs(
    appName: string,
    maxLines: number = 100,
    filter?: string
  ): Promise<KuduLogsResult> {
    // Try container logs first (most common for modern apps)
    const containerResult = await this.getContainerLogs(appName, maxLines);
    
    if (containerResult.success && containerResult.entries.length > 0) {
      let entries = containerResult.entries;
      
      // Apply filter if provided
      if (filter) {
        entries = entries.filter((e) => 
          e.content.toLowerCase().includes(filter.toLowerCase())
        );
      }
      
      return {
        success: true,
        entries,
      };
    }

    // Fallback to Application logs if container logs empty
    try {
      const logFiles = await this.listLogFiles(appName, '/LogFiles/Application/');
      
      if (logFiles.length === 0) {
        return {
          success: true,
          entries: [],
        };
      }

      // Get most recent log file
      logFiles.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
      const content = await this.readLogFile(appName, logFiles[0].path, 100000);
      
      let lines = content.split('\n').filter((line) => line.trim());
      
      if (filter) {
        lines = lines.filter((line) => line.toLowerCase().includes(filter.toLowerCase()));
      }
      
      const entries: ContainerLog[] = lines.slice(-maxLines).map((line) => ({
        timestamp: new Date().toISOString(),
        content: line,
      }));

      return {
        success: true,
        entries,
      };
    } catch {
      return containerResult; // Return container result even if Application logs fail
    }
  }

  /**
   * Check if Kudu is accessible for an app
   */
  async checkAccess(appName: string): Promise<{ accessible: boolean; error?: string }> {
    try {
      const url = `${this.getScmUrl(appName)}/api/settings`;
      const response = await this.fetchWithAuth(url);
      return { accessible: response.ok };
    } catch (error) {
      return {
        accessible: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
