---
name: Preview API probes
description: How to verify app routes when shell requests to the development domain return a platform placeholder.
---

When a shell request to `REPLIT_DEV_DOMAIN` returns HTTP 500 with `Not yet implemented`, it may be the external preview proxy response rather than the application. Confirm the route through the running app preview and inspect workflow logs before treating it as an app failure.

**Why:** In this workspace, the shell request returned the placeholder while the same health route through the app-preview path returned application JSON.

**How to apply:** For a disputed local API response, use an app-preview path such as `/api/health` and compare with workflow logs. Do not alter app routing or expose credentials just to work around the proxy.