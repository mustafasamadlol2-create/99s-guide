import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const constants = read("server/features/study-integrity/constants.ts");
const adapters = read("server/features/study-integrity/adapters.ts");
const policy = read("server/features/study-integrity/policy.ts");
const guard = read("server/features/study-integrity/studyEventGuard.ts");
const eventService = read("server/features/study-events/service.ts");
const persistence = read("server/features/study-integrity/persistence/service.ts");
const focusController = read("src/features/focus/runtime/controller.ts");
const pointsGate = read("server/features/study-points/integrityGate.ts");
const adminRoute = read("server/routes/adminStudyIntegrity.ts");
const adminConsole = read("src/features/admin/components/ControlCenterView.tsx");
const dashboard = read("src/features/study-integrity/components/StudyIntegrityDashboard.tsx");

function indexOfOrFail(source, needle, label) {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `${label}: missing ${needle}`);
  return index;
}

test("Phase 7 covers the full Focus lifecycle with versioned integrity actions", () => {
  assert.match(constants, /STUDY_INTEGRITY_RULE_VERSION = "study-integrity-v2"/);
  for (const action of [
    "FOCUS_SESSION_START",
    "FOCUS_SESSION_PAUSE",
    "FOCUS_SESSION_RESUME",
    "FOCUS_SESSION_ABANDON",
    "FOCUS_SESSION_COMPLETE",
    "FOCUS_INTERRUPTION_RECORD",
    "FOCUS_RESOURCE_HANDOFF_START",
    "FOCUS_RESOURCE_HANDOFF_RETURN",
  ]) {
    assert.match(constants, new RegExp(`${action}:`));
  }
  for (const event of [
    "focus_session_started",
    "focus_session_paused",
    "focus_session_resumed",
    "focus_session_abandoned",
    "focus_session_completed",
    "focus_interruption_recorded",
    "focus_resource_handoff_started",
    "focus_resource_handoff_returned",
  ]) {
    assert.match(adapters, new RegExp(`${event}:\\s*INTEGRITY_ACTION_TYPES\\.`));
  }
});

test("Study Events are integrity-checked after canonical ownership/reference validation and before persistence", () => {
  assert.match(eventService, /enforceStudyEventIntegrity/);
  const references = indexOfOrFail(eventService, "await validateReferences(repository, tx, semanticEvent, policy);", "reference validation");
  const integrity = indexOfOrFail(eventService, "await enforceStudyEventIntegrity(tx", "integrity guard");
  const create = indexOfOrFail(eventService, "const event = await tx.studyEvent.create", "event creation");
  assert.ok(references < integrity && integrity < create);
  assert.match(guard, /STUDY_INTEGRITY_ENABLED/);
  assert.match(guard, /priorActionTimestamps/);
  assert.match(guard, /decision\.outcome === "REJECT"/);
});

test("rate-based anti-spam is conservative and review-first for MCQ and flashcards", () => {
  assert.match(policy, /integrity\.mcq\.answer\.rate\.v2/);
  assert.match(policy, /integrity\.flashcard\.review\.rate\.v2/);
  const reviewBehaviors = policy.match(/exceededBehavior: "ALLOW_WITH_OBSERVATION"/g) ?? [];
  assert.ok(reviewBehaviors.length >= 2);
  assert.match(policy, /durationBounds: \{ minSeconds: 60, maxSeconds: 6 \* 60 \* 60 \}/);
  assert.match(policy, /durationBounds: \{ minSeconds: 1, maxSeconds: 6 \* 60 \* 60 \}/);
});

test("integrity observations can be persisted in the caller transaction without breaking canonical atomic writes", () => {
  assert.match(persistence, /options: \{ transaction\?: Prisma\.TransactionClient \}/);
  assert.match(persistence, /if \(options\.transaction\)/);
  assert.match(persistence, /await persistWithinTransaction\(options\.transaction\)/);
  assert.match(guard, /transaction: tx as unknown as Prisma\.TransactionClient/);
});

test("background absence is reconciled first and then recorded automatically as an interruption", () => {
  const reconcile = indexOfOrFail(focusController, "const reconciled = await this.reconcile();", "foreground reconciliation");
  const candidate = indexOfOrFail(focusController, "this.setState({ potentialInterruption: candidate });", "interruption candidate");
  const automatic = indexOfOrFail(focusController, "void this.recordInterruption(\"background_absence\").catch(() => {});", "automatic interruption record");
  assert.ok(reconcile < candidate && candidate < automatic);
});

test("Study Points remain append-only and blocked by canonical integrity signals", () => {
  assert.match(pointsGate, /hasBlockingIntegritySignal/);
  assert.match(pointsGate, /INTEGRITY_BLOCKED/);
  assert.match(adminRoute, /reverseStudyPointsLedgerEntry/);
  assert.match(adminRoute, /integrity\.focus\.block_reversal/);
  assert.match(adminRoute, /requestUser\?\.role !== "owner"/);
  assert.doesNotMatch(adminRoute, /studyPointsLedgerEntry\.delete/);
  assert.doesNotMatch(adminRoute, /studyPointsLedgerEntry\.update/);
});

test("owner Control Center exposes a private Study Integrity audit and review workflow", () => {
  assert.match(adminConsole, /id: "study-integrity" as SubTab/);
  assert.match(adminConsole, /StudyIntegrityDashboard/);
  assert.match(dashboard, /listIntegritySignals/);
  assert.match(dashboard, /reviewIntegritySignal/);
  assert.match(dashboard, /reverseIntegrityFocusPoints/);
  assert.match(dashboard, /ACKNOWLEDGE/);
  assert.match(dashboard, /RESOLVE/);
  assert.match(dashboard, /DISMISS/);
  assert.match(dashboard, /REOPEN/);
});
