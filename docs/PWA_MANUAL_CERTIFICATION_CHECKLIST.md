# PWA Manual Certification Checklist

**Initial status: NOT_RUN**  
**Gate: Complete on a supported browser before staged rollout.**  
Use a non-production test account and a non-production build. Do not use production student data or production AI quota.

Record browser/version, OS, viewport, build identifier, date, tester, and evidence for every row. Mark each `PASS`, `FAIL`, `NOT_RUN`, or `BLOCKED`; do not convert an unavailable check to PASS.

| Check | Steps | Expected result | Status |
| --- | --- | --- | --- |
| Manifest and install affordance | Open the deployed non-production build in a supported browser; inspect the manifest and browser install UI. | App name, standalone display, scope `/`, start URL `/`, portrait preference, and all three declared PNG icons resolve; browser offers install when its installability requirements are met. | NOT_RUN |
| Fresh install / first launch | Install, launch from the app icon, then reload once online. | Branded shell renders; no permanent blank screen or broken asset request. | NOT_RUN |
| Offline shell | After one complete online load, switch the browser offline and relaunch/open `/`. | Cached app shell renders; API-backed screens clearly report unavailable data and do not fabricate successful writes. | NOT_RUN |
| Deep links | Open a non-production authenticated deep link directly, then reload it. | SPA route recovery works; unauthenticated navigation returns to the expected sign-in flow without losing the intended safe destination. | NOT_RUN |
| Authentication URL/storage | Exercise login callback and password-reset routes with disposable credentials; inspect URL and Cache Storage after completion. | One-time codes are removed/consumed as designed and auth responses are not cached. Never paste a real credential into evidence. | NOT_RUN |
| Service-worker update | Keep an old client open, publish a new non-production build, then revisit/update. | New worker activates once; client refreshes once; no reload loop, stale chunk failure, or permanent blank view. | NOT_RUN |
| Stale-client/chunk recovery | Simulate an old cached client referencing a removed hashed asset. | User receives a recoverable refresh/error state; a single reload does not loop. | NOT_RUN |
| Offline canonical action | Go offline, attempt a Focus/Recall/Mastery action, then restore network. | No fake success, duplicate canonical mutation, or client-only reward; retries are explicit and safe. | NOT_RUN |
| Online restore / timeout / 5xx | Exercise reconnect, a slow request, a timeout, and a non-production 5xx response. | Clear loading/error/retry state; successful restore does not create duplicate events. | NOT_RUN |
| Cache and privacy audit | Inspect Cache Storage and the browser URL after logout and account switch. | No API/private student DTO, auth callback, capability, resume token, Recall token, Quick Note, or AI grounding is stored in a public cache or URL. | NOT_RUN |
| Theme and visual check | Check light/dark system appearance and a narrow phone plus desktop viewport. | Browser chrome theme and shell background remain readable; no clipped controls. This is a visual check, not Safari certification. | NOT_RUN |

## Evidence

- Browser / version:
- OS:
- Build:
- Viewports:
- Tester / date:
- Failing screenshots or console evidence:
- Overall result: