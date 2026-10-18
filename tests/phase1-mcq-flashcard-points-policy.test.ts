import assert from "node:assert/strict";
import test from "node:test";
import { INTEGRITY_ACTION_TYPES } from "../server/features/study-integrity/constants.js";
import { isEvidenceEligibleForReward } from "../server/features/study-integrity/evidence.js";
import { getIntegrityPolicy } from "../server/features/study-integrity/policy.js";

test("server-validated MCQ answers are reward-eligible", () => {
  const policy = getIntegrityPolicy(INTEGRITY_ACTION_TYPES.MCQ_ANSWER);
  assert.ok(policy);
  assert.deepEqual(policy.rewardEligibleEvidence, ["SERVER_VALIDATED"]);
  assert.equal(policy.requiredEvidenceClass, "SERVER_VALIDATED");
  assert.equal(
    isEvidenceEligibleForReward({
      actionType: INTEGRITY_ACTION_TYPES.MCQ_ANSWER,
      source: "backend",
      decision: {
        outcome: "ALLOW",
        effectiveEvidenceClass: "SERVER_VALIDATED",
      },
    }).eligible,
    true,
  );
});

test("server-validated flashcard reviews are reward-eligible", () => {
  const policy = getIntegrityPolicy(INTEGRITY_ACTION_TYPES.FLASHCARD_REVIEW);
  assert.ok(policy);
  assert.deepEqual(policy.rewardEligibleEvidence, ["SERVER_VALIDATED"]);
  assert.equal(policy.requiredEvidenceClass, "SERVER_VALIDATED");
  assert.equal(
    isEvidenceEligibleForReward({
      actionType: INTEGRITY_ACTION_TYPES.FLASHCARD_REVIEW,
      source: "backend",
      decision: {
        outcome: "ALLOW",
        effectiveEvidenceClass: "SERVER_VALIDATED",
      },
    }).eligible,
    true,
  );
});
