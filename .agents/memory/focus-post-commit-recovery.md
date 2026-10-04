---
name: Focus post-commit recovery
description: Keep Focus UI accurate when a server mutation commits but client response handling fails.
---

Do not claim a Focus mutation left server state unchanged when the client request or response handling fails; the server may have committed before the client rejects the response. For terminal actions, fetch the canonical current-session state and leave the old session route when that session is no longer current.

**Why:** Workflow audit logs showed successful abandonment alongside a client error. The client had rejected the valid `USER_ABANDONED` completion reason as if it were a timestamp, demonstrating that post-commit response failures can leave the UI stale.

**How to apply:** In terminal mutation error paths, reconcile with the canonical current-session endpoint before displaying a failure or inviting a retry. Keep the user on the session only when the canonical response still identifies it as current.