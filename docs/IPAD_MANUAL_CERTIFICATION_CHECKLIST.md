# iPad Manual Certification Checklist

**Initial status: NOT_RUN**  
**Gate: Required before Prompt 52 production rollout.**  
Use a real iPad and a non-production build/account. A simulated wide browser viewport is not iPad certification.

Record device model, iPadOS version, build identifier, orientation, date, tester, and evidence. Mark each row `PASS`, `FAIL`, `NOT_RUN`, or `BLOCKED`.

| Device / scenario | Steps | Expected result | Status |
| --- | --- | --- | --- |
| Portrait layout | Test a regular iPad portrait viewport and the largest supported iPad portrait viewport. | Pages use iPad layout rather than a stretched phone or desktop layout; safe areas and scroll regions are correct. | NOT_RUN |
| Landscape layout | Rotate to landscape, including split-width/Stage Manager if supported. | Layout reflows without clipped controls, stale dimensions, or trapped scroll. | NOT_RUN |
| Lecture detail / tab bar | Open a lecture, switch all lecture tabs, and use back navigation. | Tabs remain reachable; content and interactive navigation fit the viewport. | NOT_RUN |
| Focus Hub | Open plans/presets, create/edit a plan, reorder, and start a plan with a disposable fixture. | Queue and actions remain visible and usable in both orientations. | NOT_RUN |
| Active Focus | Start, pause, resume, background/foreground, and open/return from a resource. | Timer and session recovery remain canonical; safe areas and CTA placement remain correct. | NOT_RUN |
| Focus Summary / History | Complete a permitted test flow and inspect summary/history. | Summary and history remain readable, private, and correctly paginated. | NOT_RUN |
| Group Focus | Host/join with two non-production accounts; rotate and briefly disconnect/reconnect. | Participant layout, controls, and reconnect state remain usable without duplicate realtime connections. | NOT_RUN |
| Gamification / Leaderboard | Inspect points, achievements, challenges, ranking/ties, and privacy states. | Columns/cards remain readable; hidden/suppressed data is not exposed. | NOT_RUN |
| Recall | Open and answer/skip a test item in portrait and landscape. | Prompt/options/result fit and remain operable; no duplicate attempt. | NOT_RUN |
| Mastery / Retention | Search and inspect each supported state and due/review sections. | Search, state labels, and due ordering remain readable; no per-row request storm. | NOT_RUN |
| Study Analyzer | Inspect 7-day, 30-day, and semester views, unknown-vs-zero states, and charts. | Responsive charts preserve chronological order and have usable text alternatives. | NOT_RUN |
| Owner Analytics | As a non-production authorized owner, inspect windows, subject filters, suppression, and hidden individual data. | Aggregate privacy rules hold; small cohorts and suppressed values remain hidden. | NOT_RUN |
| System Health | Inspect authorized and denied roles with non-production accounts. | Role gates and status semantics remain clear; no secret appears in responses or screen. | NOT_RUN |
| Keyboard / safe areas / accessibility | Open forms and dialogs with the software keyboard; test focus, VoiceOver, zoom/accessibility settings, and both orientations. | CTA remains visible, focus is restored, dialogs are operable, and top/bottom insets are correct. | NOT_RUN |

## Evidence

- iPad model / iPadOS:
- Display mode / viewport:
- Build / commit:
- Account role (non-production):
- Tester / date:
- Defects and evidence:
- Overall result: