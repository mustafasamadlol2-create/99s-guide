const BASE = (process.env.PRIVATE_DATA_WORKER_BASE_URL || "").replace(/\/+$/, "");

if (!BASE) {
  console.error("PRIVATE_DATA_WORKER_BASE_URL is not set in this CMD session.");
  process.exit(2);
}

async function readJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

console.log("99's Guide — Stage 8D-1 Private Worker Verification");
console.log("----------------------------------------------------");
console.log(`Worker: ${BASE}`);
console.log("Mode: READ-ONLY / AUTH-GATE ONLY");
console.log("");

const health = await readJson(`${BASE}/health`);
if (health.status !== 200 || !health.body?.ok) {
  console.error("FAIL: health endpoint is not healthy.", health);
  process.exit(1);
}
if (health.body?.d1?.connected !== true) {
  console.error("FAIL: D1 not connected.", health.body);
  process.exit(1);
}
if (Number(health.body?.d1?.privateTablesPresent) !== 19) {
  console.error("FAIL: expected 19 private tables.", health.body);
  process.exit(1);
}
if (health.body?.privateSync?.configured !== true) {
  console.error("FAIL: PRIVATE_DATA_SYNC_SECRET is not configured.", health.body);
  process.exit(1);
}
console.log("Health + D1 + 19 private tables: PASS");

const unauth = await readJson(`${BASE}/internal/private-sync`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
if (unauth.status !== 401) {
  console.error("FAIL: unauthenticated private sync did not return 401.", unauth);
  process.exit(1);
}
console.log("Unauthorized private sync gate: PASS (401)");
console.log("");
console.log("No D1 row was modified.");
console.log("No Supabase row was modified.");
console.log("STAGE 8D-1 PRIVATE WORKER PASS");
