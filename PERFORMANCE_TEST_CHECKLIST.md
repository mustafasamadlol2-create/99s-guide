# Performance Build — Test Checklist

Use this after a clean install/build.

## Clean local checks

```bash
npm ci
npm run typecheck
npm run lint
npm run security:check
npm run build
```

## PWA

- Hard refresh once after deployment so the new service worker (`v1.4.0`) activates.
- Verify Splash in light/dark mode.
- Verify login and dashboard load.
- Keep DevTools Network open: dashboard should request `/api/materials?scope=subjects`, not the full materials payload.
- Verify offline sync requests `/api/materials?scope=offline`.
- Confirm no idle `/api/users` prefetch for a normal dashboard session.
- Briefly throttle/drop the network: one transient health failure should not immediately show offline.
- Fully disable network: offline state should still appear.

## Capacitor iOS

```bash
npm run cap:sync
```

Then build/run from Xcode and verify:
- native splash / web launch transition;
- login;
- background/resume;
- realtime reconnect;
- PDF/Notes opening;
- new Storage PDF upload (< 50 MB);
- YouTube deep-link behavior;
- no false offline state.

## Performance comparison suggestions

Measure old vs new under the same network/device:
- cold launch until dashboard usable;
- Network transferred bytes during login + first dashboard;
- number of API requests in first 10 seconds;
- `/api/materials` response size and duration;
- memory/CPU while opening a lecture with many videos.
