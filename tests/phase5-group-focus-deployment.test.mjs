import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function parseGeneratedEnvironment(output) {
  const values = new Map();
  for (const line of output.trim().split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    assert.notEqual(separator, -1, `Invalid environment line: ${line}`);
    const name = line.slice(0, separator);
    let value = line.slice(separator + 1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    values.set(name, value);
  }
  return values;
}

test("Phase 5 Group Focus runtime secret generator emits independent valid keyrings", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    new URL("../scripts/generate-group-focus-runtime-secrets.mjs", import.meta.url).pathname,
  ]);
  const values = parseGeneratedEnvironment(stdout);
  assert.deepEqual([...values.keys()], [
    "GROUP_FOCUS_CAPABILITY_KEYS_JSON",
    "GROUP_FOCUS_CAPABILITY_ACTIVE_KID",
    "GROUP_FOCUS_RECONCILIATION_KEYS_JSON",
    "GROUP_FOCUS_RECONCILIATION_ACTIVE_KID",
  ]);
  assert.equal(values.get("GROUP_FOCUS_CAPABILITY_ACTIVE_KID"), "gf-cap-v1");
  assert.equal(values.get("GROUP_FOCUS_RECONCILIATION_ACTIVE_KID"), "gf-rec-v1");

  const capability = JSON.parse(values.get("GROUP_FOCUS_CAPABILITY_KEYS_JSON"));
  const reconciliation = JSON.parse(values.get("GROUP_FOCUS_RECONCILIATION_KEYS_JSON"));
  assert.match(capability["gf-cap-v1"], /^[A-Za-z0-9_-]{43}$/u);
  assert.match(reconciliation["gf-rec-v1"], /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(capability["gf-cap-v1"], reconciliation["gf-rec-v1"]);
});

test("Phase 5 deployment guide requires Worker readiness before frontend exposure", async () => {
  const guide = await read("cloudflare-group-focus-worker/README.md");
  const env = await read(".env.example");
  assert.match(guide, /GROUP_FOCUS_API_BASE_URL/u);
  assert.match(guide, /\/ready[\s\S]*runtimeReady/u);
  assert.match(guide, /VITE_GROUP_FOCUS_FRONTEND_ENABLED=true/u);
  assert.match(guide, /VITE_GROUP_FOCUS_WORKER_URL/u);
  assert.match(env, /generate-group-focus-runtime-secrets\.mjs/u);
  assert.match(env, /\/ready returns runtimeReady=true/u);
});
