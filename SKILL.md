---
name: app-service-logs-expertise
description: Domain expertise for debugging Azure App Service issues. Use when analyzing App Service logs, investigating errors, diagnosing performance problems, or troubleshooting container restarts. Activate this skill when using app-service-logs MCP tools.
---

# App Service Logs Debugging Expertise

This skill provides domain knowledge for effectively debugging Azure App Service applications using the app-service-logs MCP tools.

## Debugging Workflow

Follow this systematic approach when investigating App Service issues:

### Step 1: Understand the Environment
- Call `get_app_info` first to understand:
  - Runtime (Node.js, Python, .NET, Java)
  - App Service Plan SKU (Free, Basic, Standard, Premium)
  - Region and current state
- SKU matters: Free/Shared tiers have CPU quotas, no Always On, limited features

### Step 2: Check Log Availability
- Call `check_diagnostics` to see if Log Analytics is enabled
- If NOT enabled:
  - Only `get_recent_logs` (Kudu) and `get_deployments` work
  - Recommend enabling diagnostic settings for full debugging capability
  - Provide the CLI command or portal instructions from the README

### Step 3: Gather Context
- Call `get_deployments` — many issues correlate with recent deployments
- Call `get_recent_logs` for immediate container output
- If Log Analytics available, call `get_http_errors` for error overview

### Step 4: Deep Dive
- Use `query_logs` with targeted KQL for specific investigation
- Use `correlate_events` to see all activity around a problem timestamp

## Common Error Patterns and Root Causes

### Container Restarts / Crashes

**Symptoms:** Container starts then stops, repeated restarts, "Container exited"

**Investigation:**
1. Check platform logs for termination reason
2. Look for patterns:
   - **OOM (Out of Memory):** "Container killed due to memory pressure"
     - Solution: Increase App Service Plan tier or optimize app memory usage
   - **Crash loop:** Repeated start/stop within seconds
     - Solution: Check application startup code, look for unhandled exceptions
   - **Health probe failure:** "Container didn't respond to health check"
     - Solution: Increase `WEBSITES_CONTAINER_START_TIME_LIMIT`, check startup time

**KQL for OOM:**
```
AppServicePlatformLogs
| where Message contains "memory" or Message contains "OOM"
| project TimeGenerated, Message
```

### Container Stops After Short Time (No Errors)

**Symptoms:** Container runs briefly, stops gracefully, "Site stopped"

**Root Cause:** Almost always **"Always On" is disabled**
- Free and Shared tiers don't support Always On
- App scales to zero when no traffic

**Solution:**
```bash
az webapp config set --name {app} --resource-group {rg} --always-on true
```
Note: Requires Basic tier or higher.

### HTTP 500 Errors

**Symptoms:** Users see 500 errors, `get_http_errors` shows failures

**Investigation:**
1. Group errors by endpoint — is it one path or all paths?
2. Check timing — did it start after a deployment?
3. Look at console logs for exceptions

**Single endpoint failing:** Usually code bug in that route
**All endpoints failing:** Infrastructure issue (database, external service)
**Started after deploy:** Likely code regression

**KQL for exception details:**
```
AppServiceConsoleLogs
| where ResultDescription contains "error" or ResultDescription contains "exception"
| project TimeGenerated, ResultDescription
```

### HTTP 503 Service Unavailable

**Symptoms:** 503 errors, app seems down

**Common causes:**
1. **App not responding to health checks** — increase startup timeout
2. **App crashed** — check platform logs for container status
3. **Deployment in progress** — check `get_deployments` timing
4. **Quota exceeded** — Free/Shared tier CPU quota hit

**KQL for 503s:**
```
AppServiceHTTPLogs
| where ScStatus == 503
| summarize count() by bin(TimeGenerated, 5m)
```

### Slow Requests / High Latency

**Symptoms:** Requests taking longer than expected

**Investigation:**
1. Call `get_slow_requests` with appropriate threshold
2. Check if slow requests correlate with:
   - **Cold starts** — first request after idle period (Always On disabled)
   - **Specific endpoints** — code/database issue in that path
   - **All requests** — infrastructure issue

**Cold start indicators:**
- Slow request followed by fast requests to same endpoint
- Slow requests correlate with container start events
- Low traffic volume

**KQL for latency analysis:**
```
AppServiceHTTPLogs
| summarize avg(TimeTaken), max(TimeTaken), count() by CsUriStem
| order by avg_TimeTaken desc
```

### Deployment Failures

**Symptoms:** Deployment shows failed, app not updated

**Investigation:**
1. Call `get_deployments` to see status
2. Check platform logs around deployment time
3. Common causes:
   - Build failure (check deployment logs)
   - Startup failure after deploy (new code crashes)
   - Slot swap failure (staging slot unhealthy)

## App Service Plan SKU Reference

| SKU | Always On | Custom Domains | SSL | Slots | Auto-scale |
|-----|-----------|----------------|-----|-------|------------|
| Free | ❌ | ❌ | ❌ | ❌ | ❌ |
| Shared | ❌ | ✅ | ❌ | ❌ | ❌ |
| Basic | ✅ | ✅ | ✅ | ❌ | ❌ |
| Standard | ✅ | ✅ | ✅ | 5 | ✅ |
| Premium | ✅ | ✅ | ✅ | 20 | ✅ |
| Isolated | ✅ | ✅ | ✅ | 20 | ✅ |

When recommending solutions, consider the user's SKU limitations.

## Log Analytics Tables Reference

| Table | Contains | Use For |
|-------|----------|---------|
| `AppServiceHTTPLogs` | HTTP requests/responses | Error rates, latency, traffic patterns |
| `AppServiceConsoleLogs` | stdout/stderr | Application errors, exceptions, debug output |
| `AppServicePlatformLogs` | Platform events | Container lifecycle, deployments, restarts |
| `AppServiceAppLogs` | Application logging | Custom app logs via logging framework |

## Response Best Practices

When presenting findings to users:

1. **Lead with the answer** — State the root cause first, then evidence
2. **Show relevant logs** — Include actual log entries that support your conclusion
3. **Provide actionable recommendations** — Include CLI commands or portal steps
4. **Note limitations** — If Log Analytics isn't enabled, mention what you couldn't check
5. **Suggest next steps** — What the user should do or investigate further

## Example Investigation Response

> **Root Cause:** Your container is stopping due to "Always On" being disabled. With no incoming traffic, App Service terminates idle containers to save resources.
>
> **Evidence:**
> - Container ran successfully for 20 seconds
> - Terminated gracefully (no crash, no errors)
> - Very low traffic: only 14 requests in 24 hours
> - No errors in platform or application logs
>
> **Recommendation:**
> ```bash
> az webapp config set --name your-app --resource-group your-rg --always-on true
> ```
> Note: This requires at least a Basic tier App Service Plan.
