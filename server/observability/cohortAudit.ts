import { Prisma, type PrismaClient } from "@prisma/client";

export interface StudyCohortAuditCounts {
  zeroValueEntries: bigint;
  invalidCategories: bigint;
  invalidReversals: bigint;
  duplicateSourceAwards: bigint;
  duplicateConsistencyAwards: bigint;
  duplicateLegacyBaselines: bigint;
  categoryCapViolations: bigint;
  totalCapViolations: bigint;
  socialBonusCapViolations: bigint;
  projectionDriftRows: bigint;
}

/**
 * Full-cohort checks return aggregate counts only. The caller must require
 * explicit local/staging targeting and an explicit deep-audit opt-in.
 */
export async function runStudyCohortAudit(
  database: PrismaClient,
): Promise<StudyCohortAuditCounts> {
  const [ledgerRows, projectionRows] = await database.$transaction(
    async (tx) => Promise.all([
      tx.$queryRaw<Array<{
        zero_value_entries: bigint;
        invalid_categories: bigint;
        invalid_reversals: bigint;
        duplicate_source_awards: bigint;
        duplicate_consistency_awards: bigint;
        duplicate_legacy_baselines: bigint;
        category_cap_violations: bigint;
        total_cap_violations: bigint;
        social_bonus_cap_violations: bigint;
      }>>(Prisma.sql`
        WITH ledger AS (
          SELECT
            id, "userId", amount, category, "reasonCode", "sourceType", "sourceId",
            "ruleVersion", "effectiveAt", "reversalOfEntryId",
            ("effectiveAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date AS baghdad_day
          FROM "StudyPointsLedgerEntry"
        ),
        category_day AS (
          SELECT "userId", baghdad_day, category, SUM(amount) AS net
          FROM ledger
          WHERE category IN ('FOCUS', 'MASTERY', 'PROGRESS', 'CONSISTENCY')
          GROUP BY "userId", baghdad_day, category
        ),
        social_day AS (
          SELECT e."userId", e.baghdad_day, SUM(e.amount) AS net,
            COUNT(*) FILTER (
              WHERE e.amount > 0
                AND e.sourceType = 'GROUP_FOCUS_RUN'
                AND e."reasonCode" = 'group_focus.verified_social_bonus'
            ) AS awards
          FROM ledger e
          LEFT JOIN ledger original ON original.id = e."reversalOfEntryId"
          WHERE e.category = 'FOCUS'
            AND (
              (e.sourceType = 'GROUP_FOCUS_RUN'
                AND e."reasonCode" = 'group_focus.verified_social_bonus')
              OR
              (e."reversalOfEntryId" IS NOT NULL
                AND original.category = 'FOCUS'
                AND original.sourceType = 'GROUP_FOCUS_RUN'
                AND original."reasonCode" = 'group_focus.verified_social_bonus'
                AND original.baghdad_day = e.baghdad_day)
            )
          GROUP BY e."userId", e.baghdad_day
        )
        SELECT
          (SELECT COUNT(*) FROM ledger WHERE amount = 0)::bigint AS zero_value_entries,
          (SELECT COUNT(*) FROM ledger
            WHERE category NOT IN ('FOCUS', 'MASTERY', 'PROGRESS', 'CONSISTENCY')
          )::bigint AS invalid_categories,
          (
            SELECT COUNT(*) FROM ledger e
            LEFT JOIN ledger original ON original.id = e."reversalOfEntryId"
            WHERE
              (e."reversalOfEntryId" IS NOT NULL AND (
                e.sourceType <> 'REVERSAL'
                OR original.id IS NULL
                OR original."userId" <> e."userId"
                OR original.sourceType IN ('REVERSAL', 'LEGACY_POINTS_LOG')
                OR original."reversalOfEntryId" IS NOT NULL
                OR e.category <> original.category
                OR e.amount <> -original.amount
                OR e."sourceId" <> original.id
              ))
              OR
              (e."reversalOfEntryId" IS NULL AND (
                e.sourceType = 'REVERSAL' OR e.amount < 0
              ))
          )::bigint
            + (SELECT COUNT(*) FROM (
              SELECT "reversalOfEntryId"
              FROM ledger
              WHERE "reversalOfEntryId" IS NOT NULL
              GROUP BY "reversalOfEntryId"
              HAVING COUNT(*) > 1
            ) duplicate_reversals)::bigint AS invalid_reversals,
          (SELECT COUNT(*) FROM (
            SELECT "userId", "sourceType", "sourceId", "reasonCode", "ruleVersion"
            FROM ledger
            WHERE amount > 0
              AND "sourceId" IS NOT NULL
              AND "sourceType" NOT IN ('ADMIN_ADJUSTMENT', 'LEGACY_POINTS_LOG', 'REVERSAL')
            GROUP BY "userId", "sourceType", "sourceId", "reasonCode", "ruleVersion"
            HAVING COUNT(*) > 1
          ) duplicate_awards)::bigint AS duplicate_source_awards,
          (SELECT COUNT(*) FROM (
            SELECT "userId", baghdad_day
            FROM ledger
            WHERE "sourceType" = 'DAILY_CONSISTENCY'
              AND "reasonCode" = 'consistency.verified_study_day'
              AND "ruleVersion" = 'daily-consistency-v1'
              AND amount > 0
            GROUP BY "userId", baghdad_day
            HAVING COUNT(*) > 1
          ) duplicate_consistency)::bigint AS duplicate_consistency_awards,
          (SELECT COUNT(*) FROM (
            SELECT "userId"
            FROM ledger
            WHERE "sourceType" = 'LEGACY_POINTS_LOG'
              AND "reasonCode" = 'legacy.baseline_import'
            GROUP BY "userId"
            HAVING COUNT(*) > 1
          ) duplicate_baselines)::bigint AS duplicate_legacy_baselines,
          (SELECT COUNT(*) FROM category_day
            WHERE net > CASE category
              WHEN 'FOCUS' THEN 60
              WHEN 'MASTERY' THEN 40
              WHEN 'PROGRESS' THEN 30
              WHEN 'CONSISTENCY' THEN 5
              ELSE 0
            END
          )::bigint AS category_cap_violations,
          (SELECT COUNT(*) FROM (
            SELECT "userId", baghdad_day, SUM(net) AS total
            FROM category_day
            GROUP BY "userId", baghdad_day
            HAVING SUM(net) > 100
          ) daily_total_violations)::bigint AS total_cap_violations,
          (SELECT COUNT(*) FROM social_day
            WHERE awards > 3 OR net > 6
          )::bigint AS social_bonus_cap_violations
      `),
      tx.$queryRaw<Array<{ drift_rows: bigint }>>(Prisma.sql`
        WITH canonical AS (
          SELECT
            "userId",
            COUNT(*)::bigint AS ledger_count,
            COALESCE(SUM(amount) FILTER (WHERE category = 'FOCUS'), 0)::bigint AS focus_points,
            COALESCE(SUM(amount) FILTER (WHERE category = 'MASTERY'), 0)::bigint AS mastery_points,
            COALESCE(SUM(amount) FILTER (WHERE category = 'PROGRESS'), 0)::bigint AS progress_points,
            COALESCE(SUM(amount) FILTER (WHERE category = 'CONSISTENCY'), 0)::bigint AS consistency_points,
            COALESCE(SUM(amount) FILTER (
              WHERE category IN ('FOCUS', 'MASTERY', 'PROGRESS', 'CONSISTENCY')
            ), 0)::bigint AS total_points
          FROM "StudyPointsLedgerEntry"
          GROUP BY "userId"
        ),
        comparison AS (
          SELECT
            c."userId" AS canonical_user,
            p."userId" AS projected_user,
            COALESCE(c.focus_points, 0)::bigint AS focus_points,
            COALESCE(c.mastery_points, 0)::bigint AS mastery_points,
            COALESCE(c.progress_points, 0)::bigint AS progress_points,
            COALESCE(c.consistency_points, 0)::bigint AS consistency_points,
            COALESCE(c.total_points, 0)::bigint AS total_points,
            COALESCE(c.ledger_count, 0)::bigint AS ledger_count,
            p."focusPoints" AS projected_focus,
            p."masteryPoints" AS projected_mastery,
            p."progressPoints" AS projected_progress,
            p."consistencyPoints" AS projected_consistency,
            p."totalPoints" AS projected_total,
            p."ledgerEntryCount" AS projected_count
          FROM canonical c
          FULL OUTER JOIN "StudyPointsBalanceProjection" p ON p."userId" = c."userId"
        )
        SELECT COUNT(*)::bigint AS drift_rows
        FROM comparison
        WHERE
          (canonical_user IS NOT NULL AND projected_user IS NULL)
          OR
          (projected_user IS NOT NULL AND (
            COALESCE(projected_focus, 0)::bigint <> focus_points
            OR COALESCE(projected_mastery, 0)::bigint <> mastery_points
            OR COALESCE(projected_progress, 0)::bigint <> progress_points
            OR COALESCE(projected_consistency, 0)::bigint <> consistency_points
            OR COALESCE(projected_total, 0)::bigint <> total_points
            OR COALESCE(projected_count, 0)::bigint <> ledger_count
            OR COALESCE(projected_total, 0)::bigint <>
              COALESCE(projected_focus, 0)::bigint
              + COALESCE(projected_mastery, 0)::bigint
              + COALESCE(projected_progress, 0)::bigint
              + COALESCE(projected_consistency, 0)::bigint
          ))
      `),
    ]),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    },
  );
  const ledger = ledgerRows[0];
  const projection = projectionRows[0];
  if (!ledger || !projection) throw new Error("COHORT_AUDIT_RESULT_MISSING");
  return {
    zeroValueEntries: ledger.zero_value_entries,
    invalidCategories: ledger.invalid_categories,
    invalidReversals: ledger.invalid_reversals,
    duplicateSourceAwards: ledger.duplicate_source_awards,
    duplicateConsistencyAwards: ledger.duplicate_consistency_awards,
    duplicateLegacyBaselines: ledger.duplicate_legacy_baselines,
    categoryCapViolations: ledger.category_cap_violations,
    totalCapViolations: ledger.total_cap_violations,
    socialBonusCapViolations: ledger.social_bonus_cap_violations,
    projectionDriftRows: projection.drift_rows,
  };
}