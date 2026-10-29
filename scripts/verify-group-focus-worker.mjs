const DEFAULT_ORIGIN = "https://99sguide-group-focus.mustafasamadlol2.workers.dev";
const configured = (
  process.env.GROUP_FOCUS_WORKER_URL
  || process.env.VITE_GROUP_FOCUS_WORKER_URL
  || DEFAULT_ORIGIN
).trim().replace(/\/$/u, "");

let origin;
try {
  const parsed = new URL(configured);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== "/" && parsed.pathname !== "")
  ) throw new Error("invalid origin");
  origin = parsed.origin;
} catch {
  console.error(`[group-focus] Invalid Worker origin: ${configured}`);
  process.exit(1);
}

const readyUrl = `${origin}/ready`;
let lastFailure = "unknown error";
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const response = await fetch(readyUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = null; }
    if (response.ok && payload?.runtimeReady === true) {
      console.log(`[group-focus] Worker ready: ${origin}`);
      process.exit(0);
    }
    lastFailure = `HTTP ${response.status}: ${text.slice(0, 240)}`;
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error);
  }
  if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 2_000));
}

console.error(`[group-focus] Worker readiness failed at ${readyUrl}: ${lastFailure}`);
console.error("[group-focus] Confirm the Worker is deployed and that capability/reconciliation secrets match Render.");
process.exit(1);
