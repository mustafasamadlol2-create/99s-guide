const BASE = (process.env.PRIVATE_DATA_WORKER_BASE_URL || "").replace(/\/+$/, "");

if (!BASE) {
  console.error("PRIVATE_DATA_WORKER_BASE_URL is not set.");
  process.exit(2);
}

async function get(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

console.log("99's Guide — Stage 8D-2A Private Worker Verification");
console.log("-----------------------------------------------------");
console.log(`Worker: ${BASE}`);
console.log("Mode: READ-ONLY / AUTH-GATE ONLY");
console.log("");

const health = await get(`${BASE}/health`);
if (health.status !== 200 || !health.body?.ok) {
  console.error("FAIL: Worker health.", health);
  process.exit(1);
}
if (health.body?.d1?.connected !== true) {
  console.error("FAIL: D1 disconnected.", health.body);
  process.exit(1);
}
if (Number(health.body?.d1?.safeMirrorTablesPresent) !== 16 ||
    Number(health.body?.d1?.safeMirrorTablesExpected) !== 16) {
  console.error("FAIL: expected 16 safe mirror tables.", health.body);
  process.exit(1);
}
if (health.body?.privateSync?.configured !== true) {
  console.error("FAIL: private secret is not configured.", health.body);
  process.exit(1);
}
console.log("Health + D1 + 16 safe mirror tables: PASS");

const unauth = await get(`${BASE}/internal/private-sync`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
if (unauth.status !== 401) {
  console.error("FAIL: unauthorized sync gate did not return 401.", unauth);
  process.exit(1);
}
console.log("Unauthorized private sync gate: PASS (401)");
console.log("");
console.log("No Supabase row was modified by this verifier.");
console.log("No D1 row was modified by this verifier.");
console.log("STAGE 8D-2A PRIVATE MIRROR HARDENING PASS");
