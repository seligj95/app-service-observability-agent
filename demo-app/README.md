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

### Scenario 2: Deployment Correlation (Bug Demo)

This is the "wow factor" demo - correlating errors with a bad deployment.

#### Step 1: Deploy the working app
```bash
cd demo-app
azd up
```
Verify it's working: "Tell me about my app", "Show me recent logs"

#### Step 2: Introduce a bug (typo in filename)

Edit `src/index.js` line 7 - change:
```javascript
const config = require('./config.json');
```
to:
```javascript
const config = require('./config-v2.json');  // This file doesn't exist!
```

#### Step 3: Deploy the broken version
```bash
azd deploy
```

#### Step 4: Demo the correlation
Wait 2-3 minutes for logs to flow, then:
- "My app is having issues"
- "When did the errors start?"
- "Correlate errors with deployments"

The agent will show that errors started right after the deployment!

#### Step 5: Fix and redeploy
Revert the change in `src/index.js` back to `config.json` and run:
```bash
azd deploy
```

## Bug Explanation

The app loads configuration at startup:
```javascript
const config = require('./config.json');  // Works - file exists
const config = require('./config-v2.json');  // Crashes - file doesn't exist!
```

This simulates a common deployment issue: a typo or refactoring mistake that references a missing file.

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
