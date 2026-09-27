import type { OwnerMetricSourceDefinition } from "./types.js";

/** Internal source authority documentation; this is not persisted or exposed over HTTP. */
export const OWNER_METRIC_SOURCES = [
  {
    metricId: "population.eligibleStudents",
    canonicalSource: 'PostgreSQL "User"',
    aggregation: "COUNT(*)",
    semanticNotes: "Current ACTIVE accounts with role=user and isPrimaryOwner=false; the schema has no enrollment or cohort table.",
  },
  {
    metricId: "study.active_users",
    canonicalSource: 'FocusSession, GroupFocusParticipantSummary/GroupFocusRun, StudyEvent, RecallAttempt',
    timeField: "source-specific server completion/receipt timestamps",
    aggregation: "COUNT(DISTINCT user_id) over a UNION of qualifying user/lecture facts",
    semanticNotes: "Requires a meaningful canonical action; resource events and Recall skips do not qualify.",
  },
  {
    metricId: "focus.*",
    canonicalSource: 'PostgreSQL "FocusSession"',
    timeField: "actualEndedAt",
    aggregation: "Grouped counts, seconds, and distinct users",
    semanticNotes: "COMPLETED only, activeSeconds >= MASTERY_MEANINGFUL_FOCUS_SECONDS.",
  },
  {
    metricId: "groupFocus.*",
    canonicalSource: 'PostgreSQL "GroupFocusRun" + "GroupFocusParticipantSummary"',
    timeField: "GroupFocusRun.runtimeEndedAt",
    aggregation: "Grouped distinct runs, participant summaries, seconds, and users",
    semanticNotes: "Membership rows are never evidence; participant summaries require verifiedFocusSeconds > 0.",
  },
  {
    metricId: "mcq.normal.*",
    canonicalSource: 'PostgreSQL "StudyEvent" mcq_attempted + canonical "Mcq"',
    timeField: "StudyEvent.receivedAt",
    aggregation: "Grouped counts from server-validated persisted payload.correct",
    semanticNotes: "Separated from RecallAttempt objective answers to prevent source conflation.",
  },
  {
    metricId: "flashcards.*",
    canonicalSource: 'PostgreSQL "StudyEvent" flashcard_reviewed + canonical "Flashcard"',
    timeField: "StudyEvent.receivedAt",
    aggregation: "Grouped review/outcome counts and distinct users/cards",
    semanticNotes: "quality=AGAIN is self-reported not remembered; HARD/GOOD/EASY are self-reported remembered. Not accuracy.",
  },
  {
    metricId: "recall.periodic.*",
    canonicalSource: 'PostgreSQL "RecallAttempt"',
    timeField: "presentedAt, answeredAt, skippedAt, expiredAt",
    aggregation: "Grouped status/outcome counts and distinct users",
    semanticNotes: "issuanceSource=PERIODIC only; objective MCQ and Flashcard self-report outcomes remain distinct.",
  },
  {
    metricId: "mastery.base.*",
    canonicalSource: 'PostgreSQL "LectureMastery"',
    aggregation: "Current tracked user/lecture state counts as of the query snapshot",
    semanticNotes: "Only materialized rows enter trackedUserLecturePairs; missing rows are not NOT_STARTED.",
  },
  {
    metricId: "mastery.effective.* and retention.*",
    canonicalSource: 'PostgreSQL "LectureMastery" LEFT JOIN "LectureRetention"',
    timeField: "LectureRetention.nextEvaluationAt / lastEvaluatedAt relative to asOf",
    aggregation: "Fresh/stale/missing counts and fresh-only state distributions",
    semanticNotes: "Requires matching source mastery revision/rule and current retention rule; reads never refresh rows.",
  },
  {
    metricId: "resources.launches",
    canonicalSource: 'StudyEvent lecture_resource_launched',
    timeField: "StudyEvent.receivedAt",
    aggregation: "Unavailable",
    semanticNotes: "No producer exists in the repository; launches are null and are not inferred from files or handoffs.",
  },
  {
    metricId: "resources.handoffs",
    canonicalSource: 'Focus Service validated handoff transition → StudyEvent focus_resource_handoff_started',
    timeField: "StudyEvent.receivedAt",
    aggregation: "Grouped initiated handoffs and distinct users by PDF/VIDEO",
    semanticNotes: "The event is committed with a validated Material lookup and Focus state transition; it does not prove reading or viewing.",
  },
  {
    metricId: "manualCompletion.legacySignals",
    canonicalSource: 'PostgreSQL "LectureProgress" and "UserProgress"',
    aggregation: "Not included",
    semanticNotes: "Boolean progress flags are not verified completion; no manual completion metric is merged into study or Mastery.",
  },
  {
    metricId: "subjects",
    canonicalSource: 'PostgreSQL "Lecture".mainSubject',
    aggregation: "Grouped canonical lecture/activity facts",
    semanticNotes: "No Subject model or stable subject ID relation exists; mainSubject is the only current grouping key.",
  },
] as const satisfies readonly OwnerMetricSourceDefinition[];