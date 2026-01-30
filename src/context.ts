/**
 * App context management - tracks which App Service we're querying
 */

export interface AppContext {
  subscriptionId: string;
  resourceGroup: string;
  appName: string;
  // Cached diagnostic info
  logAnalyticsWorkspaceId?: string;
  diagnosticsEnabled?: boolean;
}

let currentContext: AppContext | null = null;

/**
 * Get the current app context from environment or previous set_context call
 */
export function getAppContext(): AppContext | null {
  if (currentContext) {
    return currentContext;
  }

  // Try to load from environment
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP;
  const appName = process.env.AZURE_APP_NAME;

  if (subscriptionId && resourceGroup && appName) {
    currentContext = { subscriptionId, resourceGroup, appName };
    return currentContext;
  }

  return null;
}

/**
 * Set the app context for subsequent tool calls
 */
export function setAppContext(context: AppContext): void {
  currentContext = context;
}

/**
 * Update cached diagnostic info
 */
export function updateDiagnosticInfo(workspaceId?: string, enabled?: boolean): void {
  if (currentContext) {
    currentContext.logAnalyticsWorkspaceId = workspaceId;
    currentContext.diagnosticsEnabled = enabled;
  }
}

/**
 * Clear the app context
 */
export function clearAppContext(): void {
  currentContext = null;
}

/**
 * Require app context - throws if not set
 */
export function requireAppContext(): AppContext {
  const context = getAppContext();
  if (!context) {
    throw new Error(
      'No App Service configured. Use set_context tool or set environment variables:\n' +
      '  AZURE_SUBSCRIPTION_ID\n' +
      '  AZURE_RESOURCE_GROUP\n' +
      '  AZURE_APP_NAME'
    );
  }
  return context;
}
