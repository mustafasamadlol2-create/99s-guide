# iPhone / iOS Manual Certification Checklist

**Initial status: NOT_RUN**  
**Gate: Required before Prompt 52 production rollout.**  
Run on a real iPhone using a signed non-production build and disposable test accounts. A desktop browser or simulator is not physical-device evidence. Do not submit to TestFlight or the App Store as part of this checklist.

Record device model, iOS version, build identifier, network, account role, date, tester, and evidence. Mark each row `PASS`, `FAIL`, `NOT_RUN`, or `BLOCKED`.

| Check | Steps | Expected result | Status |
| --- | --- | --- | --- |
| Native build / bridge | Build from the certified commit in Xcode; launch the app. Confirm `BridgeViewController` loads and native plugins are available. | No compile/link error; `CapExternalOpener` and `AppIcon` are registered once. | NOT_RUN |
| Cold launch / sign-in | Force-quit, cold launch, sign in with a disposable student account, then relaunch. | Login and session restore work; no other account's content appears. | NOT_RUN |
| Deep link / auth expiry | Open an allowed deep link; separately expire the test session. | Route is restored safely after auth; expired auth returns to sign-in without a loop or private-data flash. | NOT_RUN |
| Focus start / timer | Start a planned Focus session, note server-backed start time, background for two minutes, then foreground. | Timer derives from canonical timestamps and recovers the correct remaining/elapsed time. | NOT_RUN |
| Pause / resume / break | Pause and resume; complete one permitted round and enter/leave a break. | Invalid transitions remain blocked; no client-only completion or duplicate credit occurs. | NOT_RUN |
| Lock / unlock | Lock the screen during active Focus, wait, unlock, and reopen. | State reconciles from canonical timestamps; no duplicate session or fake completion. | NOT_RUN |
| Offline / online restore | Disable network during active Focus, attempt an action, restore network. | Timer remains honest; canonical action failures do not show success; retry does not duplicate writes. | NOT_RUN |
| Terminate / relaunch | Force-quit during active and paused states; relaunch. | Current server session is restored or a clear reconciliation state is shown; no stale local state wins. | NOT_RUN |
| Lecture/resource handoff | Open a PDF and a video from a test lecture, return to the app, then resume Focus. | Handoff and return preserve the canonical session; opening a PDF adds 0 Points, 0 direct Mastery change, no Retention anchor, and 0 Calendar events. | NOT_RUN |
| Keyboard / Quick Notes | Create and edit a private Quick Note with the keyboard open; dismiss keyboard and reload. | Input and CTA remain usable above the keyboard; note persists privately and does not create Calendar events. | NOT_RUN |
| Group Focus reconnect | On two non-production test accounts, join a room; disconnect briefly, reconnect within grace, then test beyond grace. | No duplicate socket/session; grace does not earn study credit; capability/resume secrets are not exposed. | NOT_RUN |
| Recall | Open one eligible test item, answer/skip, background, then reopen. | Server remains authoritative; no duplicate attempt or reward; skip/expiry are neutral. | NOT_RUN |
| Audio | Test ambient and local user audio, volume, looping, interruption, foreground return, and cleanup. | Playback follows user intent; no automatic unsafe resume, upload, or duplicate listener. | NOT_RUN |
| Safe area / appearance | Inspect top/bottom insets on a notched device and home-indicator area in light/dark modes. | Content and controls avoid the Dynamic Island/status area and home indicator without double insets. | NOT_RUN |
| Arabic / English | Switch language during Active Focus, Group Focus, Recall, and Analyzer; inspect timer digits and mixed Arabic/Latin text. | Direction and labels update; canonical session, attempt, and socket do not restart; chronology remains correct. | NOT_RUN |
| Logout / account switch | Log out, then sign in as a second disposable account. Inspect visible screens and local storage. | Prior private data and active local state are cleared; no cross-account data appears. | NOT_RUN |
| Accessibility / zoom | Use system text/accessibility settings, keyboard/switch navigation where applicable, and VoiceOver on timer/status/dialog flows. | Controls remain operable and meanings are announced; document the intentional app-level zoom restriction separately from device accessibility magnification. | NOT_RUN |
| Logs / storage | Inspect app/browser logs and local/session storage after the flows. | No capability, resume/Recall token, Quick Note content, correct MCQ answer, or AI grounding/response is logged or persisted insecurely. | NOT_RUN |

## Evidence

- Device / iOS:
- Build / commit:
- Test accounts (non-production identifiers only):
- Network conditions:
- Tester / date:
- Defects and evidence:
- Overall result: