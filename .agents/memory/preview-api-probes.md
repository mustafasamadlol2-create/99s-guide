---
name: Preview API probes
description: How to verify app routes when shell requests to the development domain return a platform placeholder.
---

When `REPLIT_DEV_DOMAIN` returns HTTP 500 with `Not yet implemented`, compare it with the local app preview and inspect `.replit` port mappings. The public root must route external port 80 to the web server on local port 5000; mapping port 80 to another local service makes OAuth callbacks miss the application even when the local preview works.

**Why:** This workspace mapped external port 80 to local port 9229, which served a browser/debug endpoint rather than the app. The OAuth callback therefore returned the placeholder while the app itself worked on local port 5000.

**How to apply:** Check the workflow's listening port and `.replit` mappings first. Route external port 80 to the web app, then verify the public root and callback path; only blame the proxy if that mapping is correct.