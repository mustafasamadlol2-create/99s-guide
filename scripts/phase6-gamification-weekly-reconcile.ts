/**
 * Phase 6 emergency, one-off targeted weekly snapshot reconciliation.
 * DRY-RUN by default. --apply --confirm-apply can refresh canonical Challenges
 * (including idempotent, legitimately earned rewards) and queue D1 projections.
 * Does not reset tables or change canonical points/rule definitions.
 * This is not a replacement for an automatic weekly lifecycle scheduler.
 * v4: start-up stage diagnostics and bounded retries for READ-ONLY operations; never repeat
 * canonical Challenge refresh/reward/Outbox writes automatically.
 * Stop on first unresolved read or write error; no destructive backfill.
 */
import "dotenv/config";
import type { PrismaClient } from "@prisma/client";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";
import { getBaghdadWeekPeriod } from "../server/features/gamification/challengePeriods.js";
import { getMyGamificationSummary } from "../server/features/gamification/gamificationRead.js";
import {
  buildCanonicalGamificationD1Snapshot,
  gamificationD1Projection,
} from "../server/features/gamification/d1Replica.js";
import { enqueuePrivateD1Projection } from "../server/services/privateD1Sync.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (apply && !args.includes("--confirm-apply")) {
  throw new Error("Writes require --apply --confirm-apply. Make a Supabase backup first.");
}
const startAtArg = args.find((a) => a.startsWith("--start-at="));
const startAt = startAtArg ? Number(startAtArg.slice("--start-at=".length)) : 1;
if (!Number.isSafeInteger(startAt) || startAt < 1) {
  throw new Error("--start-at must be a 1-based positive account index.");
}
const limitArg = args.find((a) => a.startsWith("--max-accounts="));
// Important: --max controls successful enqueues, NOT inspected accounts.
// A P2010 failure could previously cause all 123 accounts to be attempted.
const maxAccounts = limitArg ? Number(limitArg.slice("--max-accounts=".length)) : (apply ? 1 : 500);
if (!Number.isSafeInteger(maxAccounts) || maxAccounts < 1 || maxAccounts > 500) {
  throw new Error("--max-accounts must be an integer between 1 and 500.");
}
const maxArg = args.find((a) => a.startsWith("--max="));
const max = maxArg ? Number(maxArg.slice(6)) : 25;
if (!Number.isSafeInteger(max) || max < 1 || max > 500) {
  throw new Error("--max must be an integer between 1 and 500.");
}
const userArg = args.find((a) => a.startsWith("--user-id="));
const onlyUser = userArg?.slice("--user-id=".length) ?? null;
if (onlyUser && (onlyUser.length > 128 || onlyUser.trim() !== onlyUser)) {
  throw new Error("Invalid --user-id.");
}
const base = String(process.env.PRIVATE_DATA_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
const secret = String(process.env.PRIVATE_DATA_SYNC_SECRET || "").trim();
if (!base.startsWith("https://") || !secret) {
  throw new Error("Set PRIVATE_DATA_WORKER_BASE_URL (https) and PRIVATE_DATA_SYNC_SECRET in local env.");
}
if (/^(1|true|yes|on)$/i.test(process.env.PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED || "")) {
  throw new Error("Disable Phase 6 cutover before reconciling.");
}

const db: PrismaClient = getPrisma();
const week = getBaghdadWeekPeriod(new Date());
const READ_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class D1ReadFailure extends Error {
  constructor(readonly reasonCode: string, readonly retryable: boolean) {
    super(reasonCode);
    this.name = "D1ReadFailure";
  }
}
function isRetryableReadFailure(error: unknown): boolean {
  if (error instanceof D1ReadFailure) return error.retryable;
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof e.code === "string" && [
      "P1001", "P1002", "P1017", "P2024", "P2028", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED",
    ].includes(e.code)) return true;
    if (typeof e.message === "string" && /Transaction already closed|expired transaction|can't reach database server|connection (?:reset|terminated|closed)|timed out|pool timeout/i.test(e.message)) return true;
    current = e.cause;
  }
  return false;
}
// Allowed only for read-only operations. Never wrap refreshUserChallenges,
// buildCanonicalGamificationD1Snapshot, or enqueuePrivateD1Projection here.
async function retryReadOnly<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!isRetryableReadFailure(error) || attempt >= READ_RETRY_DELAYS_MS.length) throw error;
      console.warn(`[Phase6 weekly] transient ${stage}: ${diagnostic(error)}; READ-ONLY retry ${attempt + 1}/${READ_RETRY_DELAYS_MS.length}.`);
      await pause(READ_RETRY_DELAYS_MS[attempt]);
    }
  }
}
function diagnostic(error: unknown): string {
  if (error instanceof D1ReadFailure) return error.reasonCode;
  if (!error || typeof error !== "object") return "UNCLASSIFIED";
  const e = error as { code?: unknown; errorCode?: unknown; meta?: { code?: unknown }; name?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code
    : typeof e.errorCode === "string" ? e.errorCode
    : typeof e.name === "string" ? e.name : "UNCLASSIFIED";
  const dbCode = typeof e.meta?.code === "string" ? ` dbCode=${e.meta.code}` : "";
  // Log a sanitized, category-only reason rather than raw SQL, URLs or tokens.
  const msg = typeof e.message === "string" ? e.message : "";
  const reason = /Transaction already closed|expired transaction/i.test(msg) ? "transaction-expired"
    : /can't reach database server|connection (?:reset|terminated|closed)/i.test(msg) ? "database-connection"
    : /timeout|timed out/i.test(msg) ? "timeout"
    : e.name === "AbortError" || e.name === "TimeoutError" ? "request-timeout"
    : "unknown";
  return `${code}${dbCode} reason=${reason}`;
}

function ensureSameWeek(): void {
  if (getBaghdadWeekPeriod(new Date()).periodKey !== week.periodKey) {
    throw new Error("Baghdad week boundary crossed during reconcile; stop and rerun with current period.");
  }
}

async function d1Row(userId: string): Promise<Record<string, unknown> | null> {
  const url = new URL("/internal/private-read/gamification-snapshot", `${base}/`);
  url.searchParams.set("userId", userId);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "X-Private-Data-Sync-Secret": secret,
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    // GET only. A failed request must not cause any canonical writes.
    const e = error as { name?: string } | null;
    throw new D1ReadFailure(
      e?.name === "TimeoutError" || e?.name === "AbortError" ? "D1_GET_TIMEOUT" : "D1_GET_NETWORK",
      true,
    );
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new D1ReadFailure(`D1_HTTP_${response.status}`, retryable);
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new D1ReadFailure("D1_BAD_JSON", false); }
  if (!data || typeof data !== "object" || !Object.prototype.hasOwnProperty.call(data, "row")) {
    throw new D1ReadFailure("D1_MISSING_ROW_FIELD", false);
  }
  const value = (data as { row: unknown }).row;
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new D1ReadFailure("D1_INVALID_ROW_TYPE", false);
  }
  const row = value as Record<string, unknown>;
  if (row.userId !== userId || row.userScope !== userId) {
    throw new D1ReadFailure("D1_USER_SCOPE_MISMATCH", false);
  }
  return row;
}

async function reasonsFor(userId: string, row: Record<string, unknown> | null): Promise<string[]> {
  if (!row) return ["D1 snapshot missing"];
  const reasons: string[] = [];
  let summary: any;
  let challenges: any;
  try {
    summary = JSON.parse(String(row.summaryJson ?? "null"));
    challenges = JSON.parse(String(row.challengesJson ?? "null"));
  } catch {
    return ["invalid D1 JSON"];
  }
  const canonical = await getMyGamificationSummary(userId);
  if (summary?.points?.totalPoints !== canonical.points.totalPoints) reasons.push("points.totalPoints");
  if (summary?.points?.masteryPoints !== canonical.points.masteryPoints) reasons.push("points.masteryPoints");
  if (summary?.points?.focusPoints !== canonical.points.focusPoints) reasons.push("points.focusPoints");
  if (summary?.points?.progressPoints !== canonical.points.progressPoints) reasons.push("points.progressPoints");
  if (summary?.points?.consistencyPoints !== canonical.points.consistencyPoints) reasons.push("points.consistencyPoints");
  if (summary?.ruleSetVersion !== canonical.ruleSetVersion) reasons.push("ruleSetVersion");
  if (!Array.isArray(summary?.achievements) || summary.achievements.length !== canonical.achievements.length) {
    reasons.push("achievements.length");
  }
  if (challenges?.currentPeriod?.periodKey !== week.periodKey) reasons.push("challenge.week rollover");
  if (!Number.isFinite(Date.parse(String(row.challengePeriodEndsAt ?? ""))) ||
      Date.parse(String(row.challengePeriodEndsAt)) <= Date.now()) {
    reasons.push("challenge.period expired");
  }
  return reasons;
}

async function outstandingOutboxState(userId: string): Promise<string | null> {
  const found = await db.$queryRaw`
    SELECT "state"
    FROM "PrivateD1SyncOutbox"
    WHERE "entity" = 'GamificationSnapshot'
      AND "key"->>'id' = ${userId}
      AND "state" IN ('PENDING','RETRY','BLOCKED','POISON')
    ORDER BY "id" DESC LIMIT 1
  ` as Array<{ state: string }>;
  return found[0]?.state ?? null;
}

let mainStage = "startup";
async function main(): Promise<void> {
  // Database list was previously outside retry/diagnostics, so transient failures
  // were printed only as aborted(FAILED) with no actionable stage.
  mainStage = "load_active_accounts";
  const users = await retryReadOnly("load active account IDs", () => onlyUser
    ? db.user.findMany({ where: { id: onlyUser, accountStatus: "ACTIVE" }, select: { id: true } })
    : db.user.findMany({ where: { accountStatus: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" } }));
  if (!users.length) throw new Error("No eligible active users selected.");
  const selected = users.slice(startAt - 1, startAt - 1 + maxAccounts);
  if (!selected.length) throw new Error(`--start-at ${startAt} exceeds selected accounts ${users.length}.`);
  console.log(`[Phase6 weekly] mode=${apply ? "APPLY_WITH_CANONICAL_WRITES" : "READ_ONLY"}; Baghdad week=${week.periodKey}; active accounts=${users.length}; scan=${startAt}..${startAt + selected.length - 1}; max queued=${max}.`);
  // Read Worker availability before applying any canonical mutations.
  mainStage = "d1_preflight";
  await retryReadOnly("D1 preflight", () => d1Row(selected[0].id));
  if (apply) {
    mainStage = "outbox_sequence_preflight";
    const [{ owned }] = await retryReadOnly("outbox sequence preflight", () => db.$queryRaw<Array<{ owned: string | null }>>`
      SELECT pg_get_serial_sequence('public."PrivateD1SyncOutbox"', 'id') AS owned
    `);
    if (!owned) throw new Error("Outbox id sequence is not owned by id; repair PostgreSQL sequence first. No writes made.");
  }
  mainStage = "account_loop";
  let inspected = 0, divergent = 0, queued = 0, pending = 0, failed = 0;
  for (let i = 0; i < selected.length; i++) {
    ensureSameWeek();
    const userId = selected[i].id;
    let stage = "read_D1";
    inspected++;
    try {
      const row = await retryReadOnly(`D1 account ${startAt + i}`, () => d1Row(userId));
      stage = "compare_canonical_summary";
      const reasons = await retryReadOnly(`canonical read account ${startAt + i}`, () => reasonsFor(userId, row));
      if (!reasons.length) continue;
      divergent++;
      console.log(`[Phase6 weekly] account ${startAt + i}/${users.length}: ${reasons.join(", ")}.`);
      if (!apply) continue;
      stage = "outbox_lookup";
      const outboxState = await retryReadOnly(`outbox read account ${startAt + i}`, () => outstandingOutboxState(userId));
      if (outboxState) {
        pending++;
        console.warn(`[Phase6 weekly] account ${startAt + i}: outstanding outbox ${outboxState}; skip to avoid duplicate enqueue.`);
        continue;
      }
      stage = "canonical_challenge_refresh";
      const snapshot = await buildCanonicalGamificationD1Snapshot(userId);
      ensureSameWeek();
      if (snapshot.challenges.currentPeriod.periodKey !== week.periodKey) {
        throw new Error("Canonical Challenge refresh did not return the current Baghdad week.");
      }
      stage = "projection_serialization";
      const projection = gamificationD1Projection(userId, snapshot);
      stage = "enqueue_projection";
      const revision = await enqueuePrivateD1Projection(db, {
        entity: "GamificationSnapshot", key: { id: userId }, data: projection,
      });
      queued++;
      console.log(`[Phase6 weekly] account ${startAt + i}: snapshot queued (revision ${revision}).`);
      if (queued >= max) {
        console.log("[Phase6 weekly] Queue limit reached; let Render drain before applying the next batch.");
        break;
      }
    } catch (error) {
      failed++;
      console.error(`[Phase6 weekly] account ${startAt + i}: FAILED at ${stage} (${diagnostic(error)}).`);
      // Stop on the first unresolved error in either mode. Never advance past a failed account.
      break;
    }
  }
  console.log(`[Phase6 weekly] inspected=${inspected}/${selected.length}; divergent observed=${divergent}; outbox queued=${queued}; existing pending/blocked/poison=${pending}; failed=${failed}.`);
  if (!apply) console.log("[Phase6 weekly] READ_ONLY: no canonical writes or D1 changes.");
  else if (queued > 0) console.log("[Phase6 weekly] OUTBOX QUEUED: let Render deliver, then rerun dry-run and gamification:d1:verify.");
  else console.log("[Phase6 weekly] No new Outbox writes. Review any errors/pending tasks above.");
  if (failed || pending) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[Phase6 weekly] aborted at ${mainStage}: ${diagnostic(error)}.`);
  console.error("[Phase6 weekly] No reconcile writes from this failed command. Check DB/Worker status; do not blindly re-run --apply.");
  process.exitCode = 1;
}).finally(async () => { await disconnectPrisma().catch(() => {}); });
