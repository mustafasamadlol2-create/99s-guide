---
name: Capacitor sync version pin
description: Capacitor iOS sync can rewrite the generated Swift package pin during unrelated web feature work.
---

After a web-only change, `npx cap sync ios` may update the exact Capacitor Swift package version in the generated iOS package manifest even when no plugin changed. Review the native diff and revert that unrelated pin update unless the dependency change is intentional.

**Why:** A routine local sync changed a tracked native dependency while validating a frontend-only route; retaining it would have broadened the change beyond the requested feature.

**How to apply:** Check `git status` and the iOS package manifest diff after sync. Keep generated web assets as ignored; do not keep an unexpected native dependency bump.