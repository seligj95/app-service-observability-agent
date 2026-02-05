# Demo Todo App

A simple Node.js todo app designed to demonstrate App Service observability with the MCP server.

## Demo Setup

### 1. Deploy the app

```bash
cd demo-app
azd init  # if not already initialized
azd up
```

### 2. Configure MCP server

After deployment, update your `.vscode/mcp.json` with the outputs:

```json
{
  "servers": {
    "appservice-logs": {
      "command": "node",
      "args": ["./dist/index.js"],
      "type": "stdio",
      "env": {
        "AZURE_SUBSCRIPTION_ID": "<from azd output>",
        "AZURE_RESOURCE_GROUP": "<from azd output>",
        "AZURE_APP_NAME": "<from azd output>"
      }
    }
  }
}
```

## Demo Scenarios

### Scenario 1: Healthy App
Show normal operation with AlwaysOn health checks.

**Sample prompts:**
- "Tell me about my app"
- "Show me recent logs"
- "Any issues with my app?"

### Scenario 2: Deployment Correlation (Bug Mode)

1. **Enable the bug** - Set `ENABLE_BUG=true` in App Service configuration:
   ```bash
   az webapp config appsettings set \
     --resource-group <rg-name> \
     --name <app-name> \
     --settings ENABLE_BUG=true
   ```

2. **Wait for errors** - The app will crash on startup trying to load a missing `config-v2.json` file.

3. **Demo the correlation:**
   - "My app is having issues"
   - "When did the errors start?"
   - "What deployments happened recently?"
   - "Correlate errors with deployments"

4. **Fix the bug:**
   ```bash
   az webapp config appsettings set \
     --resource-group <rg-name> \
     --name <app-name> \
     --settings ENABLE_BUG=false
   ```

## Bug Explanation

When `ENABLE_BUG=true`, the app attempts to:
```javascript
const config = require('./config-v2.json');
```

This file doesn't exist, causing the app to crash immediately on startup with:
```
Error: Cannot find module './config-v2.json'
```

This simulates a common deployment issue where code references a missing file or module.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | / | App info |
| GET | /health | Health check |
| GET | /todos | List all todos |
| POST | /todos | Create a todo |
| GET | /todos/:id | Get a todo |
| PUT | /todos/:id | Update a todo |
| DELETE | /todos/:id | Delete a todo |
