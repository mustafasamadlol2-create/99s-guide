# Study Points baseline — version 1

This document records the active, server-verified reward rules before any new
completion source is activated. PostgreSQL's immutable Study Points ledger is
the canonical record; leaderboard snapshots are derived from that record.
Cloudflare D1 is an optional read projection and must fall back to PostgreSQL
when a projection is missing, stale, or inconsistent.

## Active award rules

| Source | Rule version | Eligibility and reward |
| --- | --- | --- |
| Solo Focus | `focus-completion-v1` | A completed session with matching backend completion evidence; 4 points at 10–24:59 active minutes, 8 at 25–44:59, 12 at 45–59:59, 16 at 60–89:59, and 20 at 90+ minutes. Only verified active seconds count. |
| Group Focus participation | `group-focus-participation-v1` | Verified participant completion; uses the same duration tiers as Solo Focus. |
| Group Focus social bonus | `group-focus-participation-v1` | 2 points after at least 25 verified active minutes; at most 3 awards and 6 bonus points per Baghdad day. |
| Daily consistency | `daily-consistency-v1` | 5 points once per Baghdad day after at least 25 minutes of eligible, server-verified Solo/Group Focus. |
| Correct Recall objective | `recall-objective-correct-v1` | 2 points for a server-verified correct Recall attempt; at most 6 per Baghdad day and 20 per Baghdad week. This is not a generic MCQ submission reward. |

## Existing budgets

| Budget | Daily limit |
| --- | ---: |
| FOCUS category | 60 |
| MASTERY category | 40 |
| PROGRESS category | 30 |
| CONSISTENCY category | 5 |
| All categories combined | 100 |

Daily boundaries use `Asia/Baghdad`. A category or total cap may reduce an
award below its rule's base amount. Replays return the original ledger entry
and do not spend the cap a second time.

## Sources not activated

There is no eligible reward for opening or re-viewing a lecture/PDF, saving or
editing a note, submitting an MCQ, flipping/repeating a flashcard, clicking a
video, or seeking to its end. Generic MCQ and flashcard rule descriptors remain
inactive because a trusted server-side completion signal and eligibility
window have not been established. Lecture/PDF, notes, and YouTube rewards also
remain off until their completion meaning, canonical evidence, deduplication,
and shadow evaluation are agreed and implemented.

## Versioning and season changes

Award entries retain their rule version and are never rewritten or backfilled
just because a rule changes. Any future change to values or eligibility must
use a new rule version and be introduced at a declared season boundary; do not
retroactively recompute balances. New sources must be shadow-evaluated before
being enabled for students.
