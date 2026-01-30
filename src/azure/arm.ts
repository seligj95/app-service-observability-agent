/**
 * ARM client - App Service metadata and diagnostic settings
 */

import { WebSiteManagementClient, Site } from '@azure/arm-appservice';
import { MonitorClient, DiagnosticSettingsResource } from '@azure/arm-monitor';
import { AzureAuthManager } from './auth.js';
import { AppContext } from '../context.js';

export interface AppInfo {
  name: string;
  resourceGroup: string;
  location: string;
  state: string;
  defaultHostName: string;
  kind: string;
  sku?: string;
  linuxFxVersion?: string;
  windowsFxVersion?: string;
  httpLoggingEnabled?: boolean;
  detailedErrorLoggingEnabled?: boolean;
}

export interface DiagnosticInfo {
  enabled: boolean;
  logAnalyticsWorkspaceId?: string;
  storageAccountId?: string;
  eventHubId?: string;
  categories: string[];
}

export class ArmClient {
  constructor(private authManager: AzureAuthManager) {}

  /**
   * Get App Service details
   */
  async getAppInfo(context: AppContext): Promise<AppInfo> {
    const client = this.authManager.getWebSiteManagementClient(context.subscriptionId);
    
    try {
      const site = await client.webApps.get(context.resourceGroup, context.appName);
      const config = await client.webApps.getConfiguration(context.resourceGroup, context.appName);
      
      return {
        name: site.name || context.appName,
        resourceGroup: context.resourceGroup,
        location: site.location || 'unknown',
        state: site.state || 'unknown',
        defaultHostName: site.defaultHostName || '',
        kind: site.kind || 'app',
        sku: undefined, // SKU requires separate call to get service plan
        linuxFxVersion: config.linuxFxVersion,
        windowsFxVersion: config.windowsFxVersion,
        httpLoggingEnabled: config.httpLoggingEnabled,
        detailedErrorLoggingEnabled: config.detailedErrorLoggingEnabled,
      };
    } catch (error) {
      throw new Error(
        `Failed to get app info: ${error instanceof Error ? error.message : String(error)}\n` +
        `Make sure you have Reader access to the App Service.`
      );
    }
  }

  /**
   * List apps in a resource group
   */
  async listApps(subscriptionId: string, resourceGroup?: string): Promise<AppInfo[]> {
    const client = this.authManager.getWebSiteManagementClient(subscriptionId);
    const apps: AppInfo[] = [];
    
    try {
      if (resourceGroup) {
        for await (const site of client.webApps.listByResourceGroup(resourceGroup)) {
          apps.push(this.siteToAppInfo(site, resourceGroup));
        }
      } else {
        for await (const site of client.webApps.list()) {
          // Extract resource group from ID
          const rgMatch = site.id?.match(/resourceGroups\/([^/]+)/);
          const rg = rgMatch ? rgMatch[1] : 'unknown';
          apps.push(this.siteToAppInfo(site, rg));
        }
      }
      return apps;
    } catch (error) {
      throw new Error(
        `Failed to list apps: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private siteToAppInfo(site: Site, resourceGroup: string): AppInfo {
    return {
      name: site.name || 'unknown',
      resourceGroup,
      location: site.location || 'unknown',
      state: site.state || 'unknown',
      defaultHostName: site.defaultHostName || '',
      kind: site.kind || 'app',
      sku: undefined, // Would need additional call
    };
  }

  /**
   * Get diagnostic settings for an App Service
   */
  async getDiagnosticSettings(context: AppContext): Promise<DiagnosticInfo> {
    const monitorClient = this.authManager.getMonitorClient(context.subscriptionId);
    
    const resourceId = `/subscriptions/${context.subscriptionId}/resourceGroups/${context.resourceGroup}/providers/Microsoft.Web/sites/${context.appName}`;
    
    try {
      const settingsResponse = await monitorClient.diagnosticSettings.list(resourceId);
      const result: DiagnosticInfo = {
        enabled: false,
        categories: [],
      };

      const settings = settingsResponse.value || [];
      for (const setting of settings) {
        if (setting.workspaceId) {
          result.enabled = true;
          result.logAnalyticsWorkspaceId = setting.workspaceId;
        }
        if (setting.storageAccountId) {
          result.storageAccountId = setting.storageAccountId;
        }
        if (setting.eventHubAuthorizationRuleId) {
          result.eventHubId = setting.eventHubAuthorizationRuleId;
        }
        
        // Collect enabled log categories
        if (setting.logs) {
          for (const log of setting.logs) {
            if (log.enabled && log.category) {
              result.categories.push(log.category);
            }
          }
        }
      }

      return result;
    } catch (error) {
      // Diagnostic settings might not exist
      return {
        enabled: false,
        categories: [],
      };
    }
  }

  /**
   * Get recent deployments
   */
  async getDeployments(context: AppContext, limit: number = 10): Promise<any[]> {
    const client = this.authManager.getWebSiteManagementClient(context.subscriptionId);
    
    try {
      const deployments: any[] = [];
      for await (const deployment of client.webApps.listDeployments(context.resourceGroup, context.appName)) {
        deployments.push({
          id: deployment.id,
          status: deployment.status,
          message: deployment.message,
          author: deployment.author,
          deployer: deployment.deployer,
          startTime: deployment.startTime,
          endTime: deployment.endTime,
        });
        if (deployments.length >= limit) break;
      }
      return deployments;
    } catch (error) {
      return [];
    }
  }

  /**
   * Resolve workspace ID from resource ID to workspace GUID
   */
  async resolveWorkspaceId(workspaceResourceId: string, subscriptionId: string): Promise<string | null> {
    // Extract workspace name from resource ID
    // Format: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{name}
    const match = workspaceResourceId.match(/workspaces\/([^/]+)/);
    if (!match) return null;
    
    // For now, we need to query the workspace to get its customer ID (GUID)
    // This is a simplified version - in production you'd use the OperationalInsights client
    try {
      const credential = this.authManager.getCredential();
      const token = await credential.getToken('https://management.azure.com/.default');
      
      const response = await fetch(
        `https://management.azure.com${workspaceResourceId}?api-version=2021-12-01-preview`,
        {
          headers: {
            Authorization: `Bearer ${token?.token}`,
          },
        }
      );
      
      if (response.ok) {
        const data = (await response.json()) as { properties?: { customerId?: string } };
        return data.properties?.customerId || null;
      }
    } catch {
      // Fall through
    }
    
    return null;
  }
}
