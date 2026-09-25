---
name: Local Worker runtime tests
description: Durable Object local test harness choice and Miniflare API compatibility caveat.
---

For end-to-end local Durable Object tests, run the configured Worker through Wrangler's local mode with an isolated temporary persistence directory rather than constructing Miniflare directly.

**Why:** The installed Miniflare v5 alpha uses a different Worker configuration shape than older top-level constructor options. Direct harness attempts failed, while Wrangler used the project's binding and migration configuration with the local workerd runtime.

**How to apply:** Keep Worker integration tests offline, use only test-scoped signing material and local persistence, and avoid remote namespaces or deployment.