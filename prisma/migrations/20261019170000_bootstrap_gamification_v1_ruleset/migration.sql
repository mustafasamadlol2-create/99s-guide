-- Phase 4 Study Engagement readiness repair.
--
-- The original GamificationRuleSet migration created the registry table but did
-- not seed an ACTIVE row. Runtime Overview/Achievements require exactly one
-- ACTIVE source-controlled ruleset, so fresh/upgraded databases could return
-- GAMIFICATION_ACTIVE_RULE_SET_NOT_CONFIGURED indefinitely even though
-- GAMIFICATION_ENABLED defaults to true.
--
-- This migration is deliberately narrow and idempotent for gamification-v1:
--   * insert+activate v1 when the registry is empty;
--   * activate an existing matching DRAFT v1 row;
--   * leave an already-valid ACTIVE v1 row intact;
--   * refuse to overwrite conflicting immutable definitions or another active
--     version, because silently rewriting those would corrupt durable history.

DO $$
DECLARE
  active_count INTEGER;
  v1 RECORD;
BEGIN
  SELECT COUNT(*)::INTEGER
    INTO active_count
    FROM "GamificationRuleSet"
   WHERE "status" = 'ACTIVE';

  IF active_count > 1 THEN
    RAISE EXCEPTION 'Gamification ruleset invariant failed: more than one ACTIVE row exists.';
  END IF;

  SELECT *
    INTO v1
    FROM "GamificationRuleSet"
   WHERE "version" = 'gamification-v1';

  IF NOT FOUND THEN
    IF active_count <> 0 THEN
      RAISE EXCEPTION 'Cannot bootstrap gamification-v1: a different ACTIVE ruleset already exists.';
    END IF;

    INSERT INTO "GamificationRuleSet" (
      "id",
      "version",
      "status",
      "schemaVersion",
      "definitionChecksum",
      "levelDefinitionChecksum",
      "challengeDefinitionChecksum",
      "effectiveFrom",
      "retiredAt",
      "createdAt",
      "updatedAt"
    ) VALUES (
      'gamification-ruleset-v1',
      'gamification-v1',
      'ACTIVE',
      1,
      '388058fb779059f6f9f43defd37389deef1787e74d71eaea4aeba223b159af24',
      '5bbf8eb146b70cb4de45eeb6ca2adf22bd2e801f205b76034cbf35718dd611e2',
      '18fb5e8859a5e17706115a0a65e1406c3edc51289786099ca7e4539bac095838',
      CURRENT_TIMESTAMP,
      NULL,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );
    RETURN;
  END IF;

  IF v1."schemaVersion" <> 1
     OR v1."definitionChecksum" <> '388058fb779059f6f9f43defd37389deef1787e74d71eaea4aeba223b159af24'
     OR v1."levelDefinitionChecksum" IS DISTINCT FROM '5bbf8eb146b70cb4de45eeb6ca2adf22bd2e801f205b76034cbf35718dd611e2'
     OR v1."challengeDefinitionChecksum" IS DISTINCT FROM '18fb5e8859a5e17706115a0a65e1406c3edc51289786099ca7e4539bac095838'
  THEN
    RAISE EXCEPTION 'Cannot bootstrap gamification-v1: stored immutable definition checksums do not match the current source bundle.';
  END IF;

  IF v1."status" = 'RETIRED' THEN
    RAISE EXCEPTION 'Cannot bootstrap gamification-v1: the matching ruleset is RETIRED.';
  END IF;

  IF v1."status" = 'ACTIVE' THEN
    IF active_count <> 1 THEN
      RAISE EXCEPTION 'Gamification ruleset invariant failed: ACTIVE v1 was not counted as active.';
    END IF;

    -- Older/manual rows can be structurally correct but miss effectiveFrom;
    -- repair only this lifecycle timestamp, never immutable definitions.
    IF v1."effectiveFrom" IS NULL OR v1."retiredAt" IS NOT NULL THEN
      UPDATE "GamificationRuleSet"
         SET "effectiveFrom" = COALESCE("effectiveFrom", CURRENT_TIMESTAMP),
             "retiredAt" = NULL,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = v1."id";
    END IF;
    RETURN;
  END IF;

  IF v1."status" = 'DRAFT' THEN
    IF active_count <> 0 THEN
      RAISE EXCEPTION 'Cannot activate gamification-v1: a different ACTIVE ruleset already exists.';
    END IF;

    UPDATE "GamificationRuleSet"
       SET "status" = 'ACTIVE',
           "effectiveFrom" = CURRENT_TIMESTAMP,
           "retiredAt" = NULL,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = v1."id";
    RETURN;
  END IF;

  RAISE EXCEPTION 'Cannot bootstrap gamification-v1: unsupported ruleset status %.', v1."status";
END $$;
