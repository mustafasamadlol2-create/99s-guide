---
name: Worker credential forwarding
description: Preserve client credentials across the Worker-to-Durable-Object request boundary.
---

Credentials parsed from client WebSocket subprotocols are not automatically available to the Durable Object after the Worker creates an internal request. Forward each credential through a dedicated internal header and validate it again in the Durable Object.

**Why:** A local reconnect integration test rejected a valid resume token because the Worker parsed it but omitted the internal forwarding step; typechecking could not detect the missing handoff.

**How to apply:** When adding or changing an authentication subprotocol, update parsing, internal header forwarding, Durable Object validation, and an end-to-end Wrangler test together.