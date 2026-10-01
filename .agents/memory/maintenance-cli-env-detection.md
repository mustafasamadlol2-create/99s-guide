---
name: Maintenance CLI environment detection
description: Environment selection must tolerate blank variables injected by the development shell.
---

Treat empty or whitespace-only maintenance environment variables as unset, then fall back to `development`. Keep production detection independent and strict so an empty development value cannot weaken production safeguards.

**Why:** The development shell can expose `NODE_ENV` as an empty string. Nullish fallback treats that as configured, causing maintenance commands to fail before connecting to the database.

**How to apply:** When adding environment selection to maintenance tooling, prefer the first non-empty trimmed value and test the blank-`NODE_ENV` case. Do not persist a shell workaround in deployment configuration.