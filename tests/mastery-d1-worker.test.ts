import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(".");
const CONFIG = "cloudflare-private-data-api/wrangler.jsonc";
const SECRET = "prompt33-local-secret";

async function port() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const value = (server.address() as AddressInfo).port;
  await new Promise<void>((ok, no) => server.close((e) => e ? no(e) : ok()));
  return value;
}
async function worker(): Promise<{ base: string; child: ChildProcess; dir: string; logs: string[] }> {
  const dir = await mkdtemp("/tmp/prompt33-d1-");
  const logs: string[] = [];
  const bin = resolve(ROOT, "node_modules/wrangler/bin/wrangler.js");
  const migration = spawnSync(process.execPath, [bin, "d1", "migrations", "apply", "99s-guide-content", "--config", CONFIG, "--local", "--persist-to", dir], { cwd: ROOT, encoding: "utf8" });
  assert.equal(migration.status, 0, migration.stderr);
  const p = await port();
  const child = spawn(process.execPath, [bin, "dev", "--config", CONFIG, "--local", "--port", String(p), "--persist-to", dir, "--var", `PRIVATE_DATA_SYNC_SECRET:${SECRET}`], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  const base = `http://127.0.0.1:${p}`;
  for (let i = 0; i < 120; i++) {
    try { await fetch(base); return { base, child, dir, logs }; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error("local Worker did not start");
}
function request(base: string, path: string, body?: Record<string, unknown>) {
  return fetch(new URL(path, base), { method: body ? "POST" : "GET", headers: { "X-Private-Data-Sync-Secret": SECRET, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function mastery(user = "u1", lecture = "l1", revision = 1, projection_revision = "1") {
  return { user_id: user, lecture_id: lecture, subject_id: "s1", state: "GOOD", evidence_score: 4, evidence_count: 2, objective_attempt_count: 2, objective_correct_count: 2, objective_incorrect_count: 0, flashcard_review_count: 1, flashcard_remembered_count: 1, flashcard_not_remembered_count: 0, recall_objective_attempt_count: 0, recall_objective_correct_count: 0, recall_objective_incorrect_count: 0, meaningful_focus_session_count: 1, meaningful_focus_seconds: 60, last_study_evidence_at: null, last_objective_evidence_at: null, last_recall_evidence_at: null, rule_version: "mastery-v1", revision, projection_revision, last_evaluated_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
}
function retention(user = "u1", lecture = "l1", revision = 1, projection_revision = "2") {
  return { user_id: user, lecture_id: lecture, subject_id: "s1", source_mastery_revision: 1, source_mastery_rule_version: "mastery-v1", effective_mastery_state: "GOOD", retention_score: 80, review_state: "DUE", review_urgency_score: 3, retention_anchor_at: null, next_review_at: "2020-01-01T00:00:00Z", next_evaluation_at: "2027-01-01T00:00:00Z", last_positive_memory_evidence_at: null, last_negative_memory_evidence_at: null, last_forgetting_evidence_at: null, objective_forgetting_item_count: 0, self_reported_forgetting_item_count: 0, forgetting_evidence_kind: "NONE", rule_version: "retention-v1", revision, projection_revision, last_evaluated_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
}

test("Prompt 33 local D1 projection replay, reads, isolation, and delete tombstone", async (t) => {
  const w = await worker();
  t.after(async () => { if (w.child.pid) try { process.kill(-w.child.pid, "SIGTERM"); } catch {} await rm(w.dir, { recursive: true, force: true }); });
  const sync = (entity: string, revision: string, data: Record<string, unknown> | null, key: Record<string, unknown>, operation = "upsert") => request(w.base, "/internal/private-sync", { version: 1, entity, operation, revision, key, ...(data ? { data } : {}) });
  const firstMasterySync = await sync("LectureMastery", "1", mastery(), { user_id: "u1", lecture_id: "l1" });
  assert.equal(firstMasterySync.status, 200, await firstMasterySync.text());
  assert.equal((await sync("LectureRetention", "2", retention(), { user_id: "u1", lecture_id: "l1" })).status, 200);
  assert.equal((await (await sync("LectureMastery", "1", mastery(), { user_id: "u1", lecture_id: "l1" })).json() as any).result, "idempotent");
  assert.equal((await sync("LectureMastery", "1", { ...mastery(), evidence_score: 9 }, { user_id: "u1", lecture_id: "l1" })).status, 400);
  assert.equal((await (await sync("LectureMastery", "0", mastery("u1", "l1", 0, "0"), { user_id: "u1", lecture_id: "l1" })).json() as any).result, "stale");
  assert.equal((await sync("LectureMastery", "3", mastery("u1", "l1", 2, "3"), { user_id: "u1", lecture_id: "l1" })).status, 200);
  assert.equal((await sync("LectureMastery", "4", mastery("u2", "l1", 1, "4"), { user_id: "u2", lecture_id: "l1" })).status, 200);
  const dashboard = await request(w.base, "/internal/private-read/mastery-dashboard?userId=u1");
  assert.equal(dashboard.status, 200);
  const dto: any = await dashboard.json();
  assert.equal(dto.state.mastery_watermark, "3"); assert.equal(dto.state.retention_watermark, "2");
  assert.equal(dto.counts.mastery_count, 1); assert.equal(dto.counts.retention_count, 1); assert.equal(dto.counts.min_next_evaluation_at, "2027-01-01T00:00:00Z");
  assert.equal((await request(w.base, "/internal/private-read/mastery-lectures?userId=u1&limit=1")).status, 200);
  const reviews = await request(w.base, "/internal/private-read/mastery-reviews?userId=u1&reviewState=DUE");
  if (reviews.status !== 200) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(reviews.status, 200, `${await reviews.text()}\n${w.logs.join("")}`);
  assert.equal((await request(w.base, "/internal/private-read/mastery-lecture?userId=u1&lectureId=l1")).status, 200);
  assert.equal((await sync("LectureMastery", "5", { revision: 2 }, { user_id: "u1", lecture_id: "l1" }, "delete")).status, 200);
  assert.equal((await (await sync("LectureMastery", "4", mastery("u1", "l1", 3, "4"), { user_id: "u1", lecture_id: "l1" })).json() as any).result, "stale");
  assert.equal((await sync("LectureMastery", "6", mastery("u1", "l1", 4, "6"), { user_id: "u1", lecture_id: "l1" })).status, 200);
  assert.equal((await (await sync("LectureMastery", "5", { revision: 4 }, { user_id: "u1", lecture_id: "l1" }, "delete")).json() as any).result, "stale");
  assert.equal((await sync("LectureRetention", "7", retention("u1", "l2", 1, "7"), { user_id: "u1", lecture_id: "l2" })).status, 200);
  const reconciliation = await request(w.base, "/internal/private-read/mastery-reconcile?userId=u1&limit=1");
  assert.equal(reconciliation.status, 200);
  const reconciliationPage = await reconciliation.json() as any;
  assert.equal(reconciliationPage.schema_version, "mastery-private-cache-v1");
  assert.equal(reconciliationPage.nextCursor, "l1");
  const orphanPage = await request(w.base, `/internal/private-read/mastery-reconcile?userId=u1&limit=1&cursor=${reconciliationPage.nextCursor}`);
  assert.equal(orphanPage.status, 200);
  const orphan = ((await orphanPage.json() as any).rows || [])[0];
  assert.equal(orphan.lectureId, "l2");
  assert.equal(orphan.mastery, null);
  assert.equal(orphan.retention.user_id, "u1");
  assert.equal(((await (await request(w.base, "/internal/private-read/mastery-dashboard?userId=u2")).json()) as any).counts.mastery_count, 1);
  assert.equal((await (await sync("MasteryProjectionUser", "6", null, { user_id: "u1" }, "delete")).json() as any).result, "stale");
  assert.equal((await (await request(w.base, "/internal/private-read/mastery-dashboard?userId=u1")).json() as any).counts.mastery_count, 1);
  assert.equal((await sync("MasteryProjectionUser", "8", null, { user_id: "u1" }, "delete")).status, 200);
  const deleted = await request(w.base, "/internal/private-read/mastery-dashboard?userId=u1");
  assert.equal((await deleted.json() as any).counts.mastery_count, 0);
  assert.equal((await (await sync("LectureMastery", "4", mastery("u1", "l1", 3, "4"), { user_id: "u1", lecture_id: "l1" })).json() as any).result, "stale");
});