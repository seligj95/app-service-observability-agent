# App Service Observability MCP Server

An MCP (Model Context Protocol) server that exposes Azure App Service observability, log querying, and analysis tools. This is a **proof-of-concept** demonstrating what native App Service MCP support could look like.

## Overview

This MCP server allows AI assistants (VS Code Copilot, Claude, etc.) to:

- **Query logs** from Azure Log Analytics (AppServiceHTTPLogs, ConsoleLogs, PlatformLogs)
- **Fetch container logs** directly from Kudu (always available, no setup required)
- **Analyze errors** — aggregate HTTP 5xx errors, identify patterns
- **Find slow requests** — queries exceeding latency thresholds
- **View deployments** — recent deployment history
- **Correlate events** — find all logs around a specific timestamp
- **Investigate issues** — diagnose why containers stopped, identify root causes

## Prerequisites

1. **Node.js 20+**
2. **Azure CLI** — `az login` for authentication
3. **(Recommended)** App Service with diagnostic settings sending logs to Log Analytics

## Installation

```bash
# Clone and install
git clone https://github.com/seligj95/app-service-observability-agent.git
cd app-service-observability-agent
npm install

# Build
npm run build
```

## Usage

### VS Code (Recommended)

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "appservice-logs": {
      "command": "node",
      "args": ["./dist/index.js"],
      "type": "stdio",
      "env": {
        "AZURE_SUBSCRIPTION_ID": "your-subscription-id",
        "AZURE_RESOURCE_GROUP": "your-resource-group",
        "AZURE_APP_NAME": "your-app-name"
      }
    }
  }
}
```

After creating the file, reload VS Code. You should see "Start | 13 tools" appear in the mcp.json file. Click "Start" to activate the server.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "appservice-logs": {
      "command": "node",
      "args": ["/absolute/path/to/app-service-observability-agent/dist/index.js"],
      "env": {
        "AZURE_SUBSCRIPTION_ID": "your-subscription-id",
        "AZURE_RESOURCE_GROUP": "your-resource-group",
        "AZURE_APP_NAME": "your-app-name"
      }
    }
  }
}
```

### Direct Execution (Development)

```bash
# Set environment variables
export AZURE_SUBSCRIPTION_ID=your-subscription-id
export AZURE_RESOURCE_GROUP=your-resource-group
export AZURE_APP_NAME=your-app-name

# Run in development mode
npm run dev
```

## Available Tools

### Context Management

| Tool | Description |
|------|-------------|
| `get_context` | Show currently configured App Service |
| `set_context` | Set subscription, resource group, and app name |
| `list_apps` | List App Service apps in subscription |

### Discovery

| Tool | Description |
|------|-------------|
| `get_app_info` | Get app metadata (SKU, region, URL, runtime) |
| `check_diagnostics` | Check if Log Analytics is enabled |

### Log Access

| Tool | Description | Requires LA |
|------|-------------|-------------|
| `query_logs` | Run custom KQL query | ✅ |
| `get_recent_logs` | Get container logs from Kudu | ❌ |
| `get_http_errors` | HTTP 5xx errors grouped by path | ✅ |
| `get_slow_requests` | Requests exceeding threshold | ✅ |
| `get_deployments` | Recent deployment history | ❌ |
| `get_restarts` | Container restart events | Partial |

### Analysis

| Tool | Description | Requires LA |
|------|-------------|-------------|
| `summarize_errors` | Aggregate and analyze error patterns | ✅ |
| `correlate_events` | Find all events around a timestamp | ✅ |

## Example Conversations

### Quick Queries

**User:** "When was the last deployment?"

**Assistant:** *calls get_deployments*
> The last deployment to **app-web-abc123** was on **January 28, 2026 at 4:01:22 PM** via a push deployment.

**User:** "Show me the recent log stream"

**Assistant:** *calls get_recent_logs*
> Shows container startup, site initialization, and lifecycle events

---

### Real-World Investigation: "Why did my container stop?"

This example shows how the MCP server enables AI-assisted debugging of App Service issues.

**User:** "Can you show me the recent log stream?"

**Assistant:** *calls get_recent_logs*

```
2026-01-30T19:52:42Z Container start method called.
2026-01-30T19:52:42Z Pulling image: appsvc/node:20-lts
2026-01-30T19:52:43Z Container is running.
2026-01-30T19:52:57Z Site startup probe succeeded after 13.6s
2026-01-30T19:52:57Z Site started.
2026-01-30T19:53:17Z Container is terminating. Grace period: 5 seconds.
2026-01-30T19:53:22Z Container is terminated.
2026-01-30T19:53:22Z Site stopped.
```

> The site started successfully but stopped 20 seconds later. Want me to investigate?

**User:** "Please investigate"

**Assistant:** *calls check_diagnostics, query_logs (platform logs), get_http_errors, query_logs (console logs), get_app_info, query_logs (traffic analysis)*

#### Investigation Results

| Factor | Finding |
|--------|---------|
| **Errors** | ✅ None - no errors in platform or app logs |
| **HTTP Errors** | ✅ None - no 5xx errors in the last 24 hours |
| **App State** | ✅ Currently "Running" |
| **Traffic** | ⚠️ Very low - only 14 HTTP requests in the last 24h |
| **Container Lifecycle** | Normal startup, ran 20 seconds, then graceful termination |

#### Root Cause

This is **normal behavior for an App Service without "Always On" enabled**. When there's no traffic, App Service terminates idle containers to save resources. The container terminated gracefully (no crash), indicating an intentional scale-down.

#### Recommendation

To keep the app running continuously without cold starts, enable "Always On":

```bash
az webapp config set --name your-app-name \
  --resource-group your-resource-group \
  --always-on true
```

**Note:** "Always On" requires at least a Basic tier App Service Plan.

---

### Other Example Queries

**User:** "What errors happened in my app today?"

**Assistant:** *calls check_diagnostics, then get_http_errors*
> ✅ No errors found in the specified time range.

**User:** "Show me container logs with 'error' in them"

**Assistant:** *calls get_recent_logs with filter*
> Filters and displays matching log entries

**User:** "What happened around 10:30 AM?"

**Assistant:** *calls correlate_events*
> Shows all events (HTTP, platform, app logs) around that timestamp

## Constraints & Limitations

1. **Log Analytics delay**: Logs are ingested with 2-5 minute delay
2. **No true streaming**: MCP is request/response; use `get_recent_logs` repeatedly for near-real-time logs
3. **Query limits**: Max 500 rows, 7 day time range, 30 second timeout
4. **Authentication**: Requires `az login` or service principal with Reader access
5. **Kudu access**: Container logs require the app to be a Linux App Service

## Enabling Log Analytics

For full functionality (KQL queries, error analysis, event correlation), enable diagnostic settings.

### Step 1: Create a Log Analytics Workspace (if needed)

If you don't already have a Log Analytics workspace:

```bash
# Create a Log Analytics workspace
az monitor log-analytics workspace create \
  --resource-group your-resource-group \
  --workspace-name your-workspace-name \
  --location eastus
```

Or in the Azure Portal: **Create a resource** → Search "Log Analytics workspace" → **Create**

### Step 2: Enable Diagnostic Settings

#### Via Azure CLI

```bash
# First, get your workspace ID
WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group your-resource-group \
  --workspace-name your-workspace-name \
  --query id -o tsv)

# Create diagnostic setting to send App Service logs to Log Analytics
az monitor diagnostic-settings create \
  --name "logs-to-la" \
  --resource "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Web/sites/{app}" \
  --workspace "$WORKSPACE_ID" \
  --logs '[
    {"category":"AppServiceHTTPLogs","enabled":true},
    {"category":"AppServiceConsoleLogs","enabled":true},
    {"category":"AppServicePlatformLogs","enabled":true},
    {"category":"AppServiceAppLogs","enabled":true}
  ]'
```

Replace `{sub}`, `{rg}`, and `{app}` with your subscription ID, resource group, and app name.

#### Via Azure Portal

1. Azure Portal → Your App Service → **Diagnostic settings** (under Monitoring)
2. Click **+ Add diagnostic setting**
3. Name it (e.g., "logs-to-la")
4. Under **Logs**, check:
   - ✅ `AppServiceHTTPLogs` — HTTP request/response logs
   - ✅ `AppServiceConsoleLogs` — stdout/stderr from your app
   - ✅ `AppServicePlatformLogs` — Platform events (deploys, restarts)
   - ✅ `AppServiceAppLogs` — Application-level logs
5. Under **Destination details**, select **Send to Log Analytics workspace**
6. Choose your workspace
7. Click **Save**

### Verification

After enabling, wait 2-5 minutes for logs to appear, then verify with:

```bash
az monitor log-analytics query \
  --workspace your-workspace-name \
  --analytics-query "AppServiceHTTPLogs | take 5"
```

Without diagnostic settings, only `get_recent_logs` (Kudu) and `get_deployments` (ARM) work.

## Native Platform Vision

This PoC demonstrates what a native App Service MCP endpoint could look like:

```
# Future native endpoint (not yet implemented)
https://my-app.scm.azurewebsites.net/mcp
```

The tool surface and response formats in this PoC are designed to match what a platform implementation would expose, making it a reference implementation for the App Service team.

## Agent Skill

This project includes [SKILL.md](SKILL.md) — an [Agent Skill](https://agentskills.io/home) file that provides domain expertise for debugging App Service issues. When VS Code Copilot has access to this file, it gains:

- **Debugging workflows** — Step-by-step approaches for investigating issues
- **Common error patterns** — OOM crashes, Always On issues, HTTP 500/503 errors, slow requests
- **KQL query templates** — Ready-to-use queries for each scenario
- **Best practices** — How to present findings and recommendations

The MCP tools (executable calls) + Agent Skill (knowledge/prompts) work together:
- **MCP tools** fetch real data from your Azure resources
- **Agent Skill** helps interpret results and guide investigations

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         MCP Client (VS Code Copilot)                     │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │ MCP Protocol (stdio)
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           MCP Server (Node.js)                           │
│  Tools: get_app_info, check_diagnostics, query_logs, get_recent_logs,   │
│         get_http_errors, get_slow_requests, get_deployments, etc.       │
└──────────────────────────────────────┬───────────────────────────────────┘
                                       │ Azure SDKs
          ┌────────────────────────────┼────────────────────────────────┐
          ▼                            ▼                                ▼
   ┌─────────────────┐      ┌───────────────────┐           ┌───────────────┐
   │  Log Analytics  │      │   Kudu REST API   │           │    ARM API    │
   │  (KQL queries)  │      │ (container logs)  │           │ (app metadata)│
   └─────────────────┘      └───────────────────┘           └───────────────┘
```

## License

MIT
