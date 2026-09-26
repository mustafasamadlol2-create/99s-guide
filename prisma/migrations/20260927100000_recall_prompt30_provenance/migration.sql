ALTER TABLE "RecallAttempt"
  ADD COLUMN "issuanceSource" VARCHAR(16),
  ADD COLUMN "issuancePolicyVersion" VARCHAR(64);

ALTER TABLE "RecallAttempt"
  ADD CONSTRAINT "RecallAttempt_issuance_source_check"
    CHECK ("issuanceSource" IS NULL OR "issuanceSource" IN ('INTERNAL', 'PERIODIC')),
  ADD CONSTRAINT "RecallAttempt_periodic_policy_check"
    CHECK (
      COALESCE(
        ("issuanceSource" IS NULL AND "issuancePolicyVersion" IS NULL)
        OR ("issuanceSource" = 'INTERNAL' AND "issuancePolicyVersion" IS NULL)
        OR (
          "issuanceSource" = 'PERIODIC'
          AND "issuancePolicyVersion" = 'recall-policy-v1'
          AND "expiresAt" IS NOT NULL
          AND "expiresAt" = "presentedAt" + INTERVAL '30 minutes'
        ),
        FALSE
      )
    );

CREATE INDEX "recall_attempt_user_periodic_presented_idx"
  ON "RecallAttempt"("userId", "issuanceSource", "issuancePolicyVersion", "presentedAt");