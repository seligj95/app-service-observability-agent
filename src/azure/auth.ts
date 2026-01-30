/**
 * Azure authentication management using DefaultAzureCredential
 */

import { DefaultAzureCredential, TokenCredential } from '@azure/identity';
import { WebSiteManagementClient } from '@azure/arm-appservice';
import { MonitorClient } from '@azure/arm-monitor';
import { LogsQueryClient } from '@azure/monitor-query';

export class AzureAuthManager {
  private credential: TokenCredential | null = null;
  private webClientCache: Map<string, WebSiteManagementClient> = new Map();
  private monitorClientCache: Map<string, MonitorClient> = new Map();
  private logsQueryClient: LogsQueryClient | null = null;

  /**
   * Get or create the Azure credential
   * Uses DefaultAzureCredential which supports:
   * - Azure CLI (az login)
   * - Environment variables
   * - Managed Identity
   * - VS Code Azure extension
   */
  getCredential(): TokenCredential {
    if (!this.credential) {
      try {
        this.credential = new DefaultAzureCredential();
      } catch (error) {
        throw new Error(
          'Failed to initialize Azure credentials. Make sure you are logged in:\n' +
          '  - Run `az login` to authenticate with Azure CLI\n' +
          '  - Or set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID environment variables'
        );
      }
    }
    return this.credential;
  }

  /**
   * Get ARM client for App Service management operations
   */
  getWebSiteManagementClient(subscriptionId: string): WebSiteManagementClient {
    const cached = this.webClientCache.get(subscriptionId);
    if (cached) {
      return cached;
    }

    const credential = this.getCredential();
    const client = new WebSiteManagementClient(credential, subscriptionId);
    this.webClientCache.set(subscriptionId, client);
    return client;
  }

  /**
   * Get ARM client for Monitor operations (diagnostic settings)
   */
  getMonitorClient(subscriptionId: string): MonitorClient {
    const cached = this.monitorClientCache.get(subscriptionId);
    if (cached) {
      return cached;
    }

    const credential = this.getCredential();
    const client = new MonitorClient(credential, subscriptionId);
    this.monitorClientCache.set(subscriptionId, client);
    return client;
  }

  /**
   * Get Log Analytics query client
   */
  getLogsQueryClient(): LogsQueryClient {
    if (!this.logsQueryClient) {
      const credential = this.getCredential();
      this.logsQueryClient = new LogsQueryClient(credential);
    }
    return this.logsQueryClient;
  }

  /**
   * Get an access token for Kudu/SCM site access
   */
  async getKuduToken(): Promise<string> {
    const credential = this.getCredential();
    const tokenResponse = await credential.getToken('https://management.azure.com/.default');
    if (!tokenResponse) {
      throw new Error('Failed to acquire token for Kudu access');
    }
    return tokenResponse.token;
  }

  /**
   * Verify credentials work by attempting to get a token
   */
  async verifyCredentials(): Promise<boolean> {
    try {
      const credential = this.getCredential();
      const token = await credential.getToken('https://management.azure.com/.default');
      return !!token;
    } catch {
      return false;
    }
  }
}
