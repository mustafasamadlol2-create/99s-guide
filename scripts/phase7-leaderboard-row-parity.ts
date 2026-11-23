/**
 * Phase 7.3 - Leaderboard canonical snapshot vs D1 row parity.
 * NO production mutations, projection, replay, reproject, or snapshot rebuild.
 * HMAC-authenticated Worker GET may record short-lived anti-replay nonces.
 * User IDs, URLs, and secrets are never printed.
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getPrisma } from '../server/services/prismaClient.js';
import {
  getLeaderboardD1Config,
  requestLeaderboardD1,
  LEADERBOARD_CACHE_MAX_ENTRIES,
} from '../server/features/leaderboard/cacheProtocol.js';
import { reconcileLeaderboardD1Cache } from '../server/features/leaderboard/cacheReconciliation.js';
import { LEADERBOARD_LIVE_HARD_STALE_MS } from '../server/features/leaderboard/snapshots.js';

const SCOPES = ['MONTHLY', 'SEMESTER', 'ALL_TIME'] as const;
type Row = {
  userId: string;
  rank: number;
  tieSize: number;
  score: bigint | number;
  levelSnapshot: number | null;
};
type Cursor = { afterRank: number; afterScore: number; afterUserId: string };
type Page = { ok: true; entries: Row[]; nextCursor: Cursor | null };

export type ParityCounts = {
  expected: number;
  actual: number;
  missing: number;
  extra: number;
  duplicate: number;
  changedRank: number;
  changedTieSize: number;
  changedScore: number;
  changedLevel: number;
  passed: boolean;
};

function safeRow(value: unknown): Row {
  if (!value || typeof value !== 'object') throw new Error('ROW_INVALID');
  const v = value as Record<string, unknown>;
  if (typeof v.userId !== 'string' || !v.userId || v.userId.length > 200) throw new Error('ROW_INVALID_USER_ID');
  if (typeof v.rank !== 'number' || !Number.isSafeInteger(v.rank) || v.rank < 1) throw new Error('ROW_INVALID_RANK');
  if (typeof v.tieSize !== 'number' || !Number.isSafeInteger(v.tieSize) || v.tieSize < 1) throw new Error('ROW_INVALID_TIE');
  if (typeof v.score !== 'number' && typeof v.score !== 'bigint') throw new Error('ROW_INVALID_SCORE');
  const score = Number(v.score);
  if (!Number.isSafeInteger(score) || score < 0) throw new Error('ROW_INVALID_SCORE');
  if (v.levelSnapshot !== null && (typeof v.levelSnapshot !== 'number' || !Number.isSafeInteger(v.levelSnapshot) || v.levelSnapshot < 0)) throw new Error('ROW_INVALID_LEVEL');
  return {userId: v.userId, rank: v.rank, tieSize: v.tieSize, score, levelSnapshot: v.levelSnapshot as number | null};
}

/** Pure row-by-row comparison, suitable for isolated regression tests. */
export function compareLeaderboardRows(expected: readonly Row[], actual: readonly Row[]): ParityCounts {
  const counts: ParityCounts = {
    expected: expected.length, actual: actual.length, missing: 0, extra: 0, duplicate: 0,
    changedRank: 0, changedTieSize: 0, changedScore: 0, changedLevel: 0, passed: false,
  };
  const canonical = new Map<string, Row>();
  const projected = new Map<string, Row>();
  for (const raw of expected) {
    const row = safeRow(raw);
    if (canonical.has(row.userId)) throw new Error('DUPLICATE_CANONICAL_ROW');
    canonical.set(row.userId, row);
  }
  for (const raw of actual) {
    const row = safeRow(raw);
    if (projected.has(row.userId)) { counts.duplicate++; continue; }
    projected.set(row.userId, row);
  }
  for (const [userId, source] of canonical) {
    const replica = projected.get(userId);
    if (!replica) { counts.missing++; continue; }
    if (replica.rank !== source.rank) counts.changedRank++;
    if (replica.tieSize !== source.tieSize) counts.changedTieSize++;
    if (replica.score !== source.score) counts.changedScore++;
    if (replica.levelSnapshot !== source.levelSnapshot) counts.changedLevel++;
  }
  for (const userId of projected.keys()) if (!canonical.has(userId)) counts.extra++;
  counts.passed = counts.expected === counts.actual &&
    counts.missing === 0 && counts.extra === 0 && counts.duplicate === 0 &&
    counts.changedRank === 0 && counts.changedTieSize === 0 &&
    counts.changedScore === 0 && counts.changedLevel === 0;
  return counts;
}

function isCursor(value: unknown): value is Cursor {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Number.isSafeInteger(v.afterRank) && Number(v.afterRank) >= 1 &&
    Number.isSafeInteger(v.afterScore) && Number(v.afterScore) >= 0 &&
    typeof v.afterUserId === 'string' && v.afterUserId.length > 0 && v.afterUserId.length <= 200;
}

async function readAllProjectedRows(snapshotId: string): Promise<Row[]> {
  const result: Row[] = [];
  let cursor: Cursor | null = null;
  let pages = 0;
  const seenCursors = new Set<string>();
  do {
    if (++pages > Math.ceil(LEADERBOARD_CACHE_MAX_ENTRIES / 100) + 1) throw new Error('D1_PAGE_LIMIT');
    const query = new URLSearchParams({ snapshotId, limit: '100' });
    if (cursor) {
      query.set('afterRank', String(cursor.afterRank));
      query.set('afterScore', String(cursor.afterScore));
      query.set('afterUserId', cursor.afterUserId);
    }
    const response = await requestLeaderboardD1<unknown>(
      `/internal/leaderboard-cache/page?${query.toString()}`,
      undefined,
      { method: 'GET' },
    );
    if (!response || typeof response !== 'object') throw new Error('D1_PAGE_INVALID');
    const page = response as Partial<Page>;
    if (page.ok !== true || !Array.isArray(page.entries) || page.entries.length > 100) throw new Error('D1_PAGE_INVALID');
    for (const raw of page.entries) result.push(safeRow(raw));
    if (result.length > LEADERBOARD_CACHE_MAX_ENTRIES) throw new Error('D1_ENTRY_LIMIT');
    if (page.nextCursor === null) return result;
    if (!isCursor(page.nextCursor) || page.entries.length === 0) throw new Error('D1_CURSOR_INVALID');
    const marker = JSON.stringify(page.nextCursor);
    if (seenCursors.has(marker)) throw new Error('D1_CURSOR_LOOP');
    seenCursors.add(marker);
    cursor = page.nextCursor;
  } while (cursor);
  throw new Error('D1_PAGE_INCOMPLETE');
}

async function main(): Promise<void> {
  console.log('[Phase7.3] Business-data READ_ONLY; no snapshot builds, projection, outbox writes, or repairs.');
  if (!getLeaderboardD1Config()) {
    console.log('[Phase7.3] CONFIG_BLOCKED: Worker URL or LEADERBOARD_D1_SYNC_SECRET unavailable in this environment.');
    console.log('[Phase7.3] RESULT: NOT VERIFIED (do not enable LEADERBOARD_D1_READ_ENABLED).');
    process.exitCode = 2;
    return;
  }
  const database = getPrisma();
  let successes = 0;
  let failures = 0;
  try {
    const seasons = await database.leaderboardSeason.findMany({
      where: { scope: { in: [...SCOPES] } },
      orderBy: { updatedAt: 'desc' },
      take: 90,
      select: {
        id: true, scope: true, seasonKey: true, status: true,
        snapshots: {
          where: { status: 'READY' },
          orderBy: [{ generatedAt: 'desc' }, { revision: 'desc' }],
          take: 1,
          select: { id: true, generatedAt: true, snapshotType: true, entryCount: true },
        },
      },
    });
    const outboxStates = await database.leaderboardD1SyncOutbox.groupBy({ by: ['state'], _count: { _all: true } });
    console.log(`[Phase7.3] Outbox states: ${JSON.stringify(Object.fromEntries(outboxStates.map(x => [x.state, x._count._all])))}`);
    for (const scope of SCOPES) {
      const candidates = seasons.filter(x => x.scope === scope);
      const season = candidates.find(x => x.status === 'ACTIVE') ?? candidates[0];
      if (!season || !season.snapshots[0]) {
        console.log(`[Phase7.3] ${scope}: BLOCKED_NO_CANONICAL_SNAPSHOT`);
        failures++;
        continue;
      }
      const snapshot = season.snapshots[0];
      const canonical = await database.leaderboardSnapshotEntry.findMany({
        where: { snapshotId: snapshot.id },
        orderBy: [{ rank: 'asc' }, { score: 'desc' }, { userId: 'asc' }],
        select: { userId: true, rank: true, tieSize: true, score: true, levelSnapshot: true },
      });
      if (canonical.length !== snapshot.entryCount) {
        console.log(`[Phase7.3] ${scope}: CANONICAL_ENTRY_COUNT_MISMATCH`);
        failures++;
        continue;
      }
      try {
        const metadata = await reconcileLeaderboardD1Cache({ snapshotId: snapshot.id, database });
        const projected = await readAllProjectedRows(snapshot.id);
        const counts = compareLeaderboardRows(canonical, projected);
        const ageMinutes = Math.floor((Date.now() - snapshot.generatedAt.getTime()) / 60_000);
        const ageOkay = snapshot.snapshotType === 'FINAL' || ageMinutes * 60_000 <= LEADERBOARD_LIVE_HARD_STALE_MS;
        const mismatchedChecks = metadata.checks.filter(x => x.status !== 'PASS').map(x => x.code);
        const verdict = counts.passed && metadata.status === 'MATCHED' && ageOkay;
        console.log(`[Phase7.3] ${scope}: ${verdict ? 'PASS' : 'NOT_READY'} season=${season.seasonKey} snapshotEntries=${counts.expected} d1Entries=${counts.actual} ageMinutes=${ageMinutes}`);
        console.log(`[Phase7.3] ${scope}: rows=${counts.passed ? 'MATCHED' : 'MISMATCH'} missing=${counts.missing} extra=${counts.extra} duplicates=${counts.duplicate} rank=${counts.changedRank} tie=${counts.changedTieSize} score=${counts.changedScore} level=${counts.changedLevel}`);
        if (mismatchedChecks.length) console.log(`[Phase7.3] ${scope}: metadataChecks=${mismatchedChecks.join(',')}`);
        if (!ageOkay) console.log(`[Phase7.3] ${scope}: LIVE_SNAPSHOT_STALE_FOR_READ_CUTOVER`);
        if (verdict) successes++; else failures++;
      } catch (error) {
        // Do not expose URLs, IDs, raw Worker replies, or private connection strings.
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message)
          ? error.message : 'D1_UNAVAILABLE_OR_INVALID';
        console.log(`[Phase7.3] ${scope}: BLOCKED_${code}`);
        failures++;
      }
    }
    const blocked = outboxStates.filter(x => x.state === 'BLOCKED' || x.state === 'POISON')
      .reduce((sum, x) => sum + x._count._all, 0);
    const backlog = outboxStates.filter(x => x.state === 'PENDING' || x.state === 'RETRY')
      .reduce((sum, x) => sum + x._count._all, 0);
    console.log(`[Phase7.3] SUMMARY: matchedScopes=${successes}/3 blockedOutbox=${blocked} pendingOrRetry=${backlog}; ${failures === 0 && blocked === 0 && backlog === 0 ? 'PARITY_PASS' : 'NOT_APPROVED'}.`);
    if (failures || blocked || backlog) process.exitCode = 2;
  } finally {
    await database.$disconnect();
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNAVAILABLE';
    console.error(`[Phase7.3] FAILED: ${/^[A-Z][A-Z0-9_]{1,20}$/.test(code) ? code : 'UNAVAILABLE'}`);
    process.exitCode = 2;
  });
}
