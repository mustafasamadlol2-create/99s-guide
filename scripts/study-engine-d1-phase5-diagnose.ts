import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";

/** Non-mutating diagnostics for Phase 5 read cutover. Never prints any row or secret. */
const workerBaseUrl = String(process.env.PRIVATE_DATA_WORKER_BASE_URL || "").trim().replace(/\/+$/, "");
const secret = String(process.env.PRIVATE_DATA_SYNC_SECRET || "").trim();
const userArg = process.argv.find((arg) => arg.startsWith("--user-id="));
const userIdArgument = userArg ? userArg.slice("--user-id=".length) : "";

if (!workerBaseUrl || !secret) {
  throw new Error("Set PRIVATE_DATA_WORKER_BASE_URL and PRIVATE_DATA_SYNC_SECRET in local .env before diagnosing.");
}

async function workerRead(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(path, `${workerBaseUrl}/`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  const start = Date.now();
  try {
    const response = await fetch(url, {
      headers: { "X-Private-Data-Sync-Secret": secret, Accept: "application/json", "Cache-Control": "no-cache" },
      signal: controller.signal,
      cache: "no-store",
    });
    const durationMs = Date.now() - start;
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error(`${path}: HTTP ${response.status} non-JSON response (${durationMs}ms)`); }
    if (!response.ok) {
      const errorCode = body && typeof body === "object" && "code" in body ? String(body.code) : "UNKNOWN";
      throw new Error(`${path}: HTTP ${response.status}, code=${errorCode} (${durationMs}ms)`);
    }
    console.log(`[Phase5 diagnose] ${path}: HTTP ${response.status}, ${durationMs}ms`);
    return body;
  } finally { clearTimeout(timer); }
}

function rowCount(body: unknown): number {
  if (!body || typeof body !== "object" || !("rows" in body) || !Array.isArray(body.rows)) {
    throw new Error("D1 response must contain a rows array.");
  }
  return body.rows.length;
}

async function main() {
  const prisma = getPrisma();
  const health = await fetch(`${workerBaseUrl}/health`);
  console.log(`[Phase5 diagnose] Worker /health: HTTP ${health.status}`);
  if (!health.ok) throw new Error("Worker health is not ready. Check the deployed Worker and D1 binding.");
  const counts = await workerRead("/internal/private-read/phase5-counts") as Record<string, unknown>;
  console.log("[Phase5 diagnose] Global D1 counts (not a freshness check):", {
    focusPlans: counts.focusPlans, focusSessions: counts.focusSessions, studyDailyMetrics: counts.studyDailyMetrics,
  });
  const selected = userIdArgument ||
    (await prisma.focusSession.findFirst({ select: { userId: true }, orderBy: { updatedAt: "desc" } }))?.userId ||
    (await prisma.focusPlan.findFirst({ select: { userId: true }, orderBy: { updatedAt: "desc" } }))?.userId ||
    (await prisma.studyDailyMetric.findFirst({ select: { userId: true }, orderBy: { updatedAt: "desc" } }))?.userId;
  if (!selected) {
    console.log("[Phase5 diagnose] No canonical Study Engine rows exist yet; user-scoped reads were not tested.");
    return;
  }
  // Test user scoping and response shape; do not print the user ID or any rows.
  const targets = [
    { label: "FocusPlan", path: "/internal/private-read/focus-plans", limit: 500,
      canonical: () => prisma.focusPlan.count({ where: { userId: selected } }) },
    { label: "FocusSession", path: "/internal/private-read/focus-sessions", limit: 500,
      canonical: () => prisma.focusSession.count({ where: { userId: selected } }) },
    { label: "StudyDailyMetric", path: "/internal/private-read/study-daily-metrics", limit: 366,
      canonical: () => prisma.studyDailyMetric.count({ where: { userId: selected } }) },
  ];
  for (const target of targets) {
    const expected = await target.canonical();
    const body = await workerRead(target.path, { userId: selected, limit: target.limit });
    const actual = rowCount(body);
    const complete = expected <= target.limit;
    console.log(`[Phase5 diagnose] ${target.label}: canonical=${expected}, D1=${actual}, ${complete ? (expected === actual ? "COUNT OK" : "COUNT MISMATCH") : "SAMPLE ONLY"}`);
    if (complete && expected !== actual) throw new Error(`${target.label} replica count mismatch. Repair outbox/backfill before cutover.`);
    const rows = (body as { rows: Array<Record<string, unknown>> }).rows;
    for (const row of rows) {
      if (row.userId !== selected || row.userScope !== selected || row.id !== row.canonicalId ||
          typeof row.revision !== "string" || !/^\d+$/.test(row.revision) ||
          row.deletedAt !== null || !Number.isInteger(row.projectionVersion)) {
        throw new Error(`${target.label} D1 row metadata invalid; do not enable cutover.`);
      }
    }
    console.log(`[Phase5 diagnose] ${target.label}: scoped metadata OK`);
  }
  // Probe repeated Focus reads for intermittent cold-start timeouts.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await workerRead("/internal/private-read/focus-sessions", { userId: selected, nonterminal: 1, limit: 2 });
    console.log(`[Phase5 diagnose] Current-session probe ${attempt}/3 OK`);
  }
  console.log("[Phase5 diagnose] PASS. Read routes are reachable; verify live behavior after Render redeploy.");
}

main().catch((error) => {
  console.error("[Phase5 diagnose] FAILED:", error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 1;
}).finally(async () => { await disconnectPrisma().catch(() => {}); });
