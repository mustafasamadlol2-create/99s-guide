#!/usr/bin/env node
"use strict";
/**
 * Phase 6 SAFE READ-ONLY batch audit, Windows CMD compatible.
 * This launcher never calls --apply and never performs remote writes itself.
 * It intentionally starts a fresh Prisma process for each small window so
 * a long-running Prisma connection cannot stall an entire 123-account audit.
 * A local checkpoint is saved after *only* a fully successful batch.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(__dirname, "phase6-gamification-weekly-reconcile.ts");
const CHECKPOINT = path.join(ROOT, ".phase6-readonly-audit-checkpoint.json");

function numberOption(name, fallback, low, high) {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
  if (!a) return fallback;
  const raw = a.slice(name.length + 3);
  if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be an integer.`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < low || n > high) {
    throw new Error(`--${name} must be between ${low} and ${high}.`);
  }
  return n;
}

function readCheckpoint() {
  if (!fs.existsSync(CHECKPOINT)) throw new Error("No local checkpoint exists. Start with --from=1.");
  const result = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
  if (!Number.isSafeInteger(result.nextStart) || result.nextStart < 1) {
    throw new Error("Invalid checkpoint; use explicit --from=N.");
  }
  return result;
}

// Resolve the installed tsx CLI once. Do not invoke `cmd /c npx tsx` on
// Windows: cmd's quote handling can turn an absolute path into a quoted file
// name, causing ERR_MODULE_NOT_FOUND before the audit even starts.
function resolveTsxCli() {
  try {
    return require.resolve("tsx/cli", { paths: [ROOT] });
  } catch (error) {
    throw new Error(`Cannot resolve the project's tsx CLI. Run npm install in ${ROOT}. Cause: ${error.message}`);
  }
}

function runWindow(start, count, seconds) {
  return new Promise((resolve) => {
    // Pass every argument as a separate value; no cmd.exe, shell, npx, or
    // manual quoting. This works with spaces and backslashes on Windows.
    const useWindows = process.platform === "win32";
    const command = process.execPath;
    const commandArgs = [resolveTsxCli(), SCRIPT, `--start-at=${start}`, `--max-accounts=${count}`];
    const child = spawn(command, commandArgs, {
      cwd: ROOT, env: process.env, windowsHide: true,
      detached: !useWindows, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    let started = false;
    let settled = false;
    const capture = (stream, destination) => {
      stream?.on("data", (chunk) => {
        const line = chunk.toString("utf8");
        output = (output + line).slice(-180_000);
        destination.write(line);
      });
    };
    capture(child.stdout, process.stdout);
    capture(child.stderr, process.stderr);
    const timer = setTimeout(() => {
      timedOut = true;
      process.stderr.write(`\n[BatchAudit] TIMEOUT after ${seconds}s for accounts ${start}–${start + count - 1}. Stopping this window.\n`);
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" });
      } else if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else child.kill();
    }, seconds * 1000);
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output, timedOut, error });
    };
    child.once("error", (e) => finish(null, e));
    child.once("close", (code) => finish(code, null));
  });
}

function analyzeWindow(r, count, expectedWeek, expectedTotal) {
  if (r.error) return { error: `Launcher error: ${r.error.code || r.error.message}` };
  if (r.timedOut) return { error: "Timed-out batch. The canonical comparison is not trustworthy." };
  if (r.code !== 0) return { error: `The underlying audit exited with code ${r.code}.` };
  const output = r.output;
  if (/\[Achievements\].*(?:could not be read|without history)|\[Gamification\] Achievement section degraded|"level":"ERROR","category":"DATABASE"|VERY_SLOW_QUERY/i.test(output)) {
    return { error: "A canonical achievement/DB read degraded. Treat this batch as incomplete even if it printed zero mismatches." };
  }
  const status = /\[Phase6 weekly\] inspected=(\d+)\/(\d+); divergent observed=(\d+); outbox queued=(\d+); existing pending\/blocked\/poison=(\d+); failed=(\d+)\./.exec(output);
  if (!status) return { error: "Missing verified end-of-batch summary." };
  if (+status[1] !== count || +status[2] !== count || +status[4] !== 0 || +status[6] !== 0 || !output.includes("READ_ONLY: no canonical writes or D1 changes")) {
    return { error: "Incomplete/failed batch, or script is no longer READ_ONLY." };
  }
  const week = /\[Phase6 weekly\] mode=READ_ONLY; Baghdad week=([^;\s]+); active accounts=(\d+);/.exec(output);
  if (!week) return { error: "Missing read-only week/account count metadata." };
  if (expectedWeek && week[1] !== expectedWeek) return { error: `Baghdad challenge week changed from ${expectedWeek} to ${week[1]}. Start a new audit.` };
  if (expectedTotal !== null && +week[2] !== expectedTotal) return { error: `Account count changed from ${expectedTotal} to ${week[2]}. Restart the audit.` };
  return { week: week[1], total: Number(week[2]), mismatches: Number(status[3]) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--apply") || args.includes("--confirm-apply")) throw new Error("This launcher is READ_ONLY. It never supports --apply.");
  const to = numberOption("to", 123, 1, 100000);
  const batchSize = numberOption("batch-size", 5, 1, 10);
  const seconds = numberOption("timeout-seconds", 180, 30, 900);
  const resume = args.includes("--resume");
  const dryRun = args.includes("--dry-run");
  const checkpoint = resume ? readCheckpoint() : null;
  const from = resume ? checkpoint.nextStart : numberOption("from", 1, 1, 100000);
  if (from > to) {
    console.log(`[BatchAudit] Nothing to check: next account ${from}, requested end ${to}.`);
    return;
  }
  if (!fs.existsSync(SCRIPT)) throw new Error(`Missing ${SCRIPT}. Keep the latest Phase 6 reconciliation script.`);
  console.log(`[BatchAudit] READ_ONLY. Range ${from}–${to}, ${batchSize} accounts per process, ${seconds}s deadline per batch.`);
  console.log("[BatchAudit] Expected mismatches are reported; this launcher never grants rewards or queues Outbox writes.");
  if (dryRun) {
    for (let i = from; i <= to; i += batchSize) {
      const count = Math.min(batchSize, to - i + 1);
      console.log(`  npx tsx scripts/phase6-gamification-weekly-reconcile.ts --start-at=${i} --max-accounts=${count}`);
    }
    return;
  }
  let week = checkpoint?.week || null;
  let total = checkpoint?.total ?? null;
  let checked = 0;
  let mismatched = 0;
  for (let start = from; start <= to; start += batchSize) {
    const count = Math.min(batchSize, to - start + 1);
    console.log(`\n[BatchAudit] Starting accounts ${start}–${start + count - 1}...`);
    const r = await runWindow(start, count, seconds);
    const parsed = analyzeWindow(r, count, week, total);
    if (parsed.error) {
      console.error(`\n[BatchAudit] STOP at account ${start}. ${parsed.error}`);
      console.error(`[BatchAudit] Check connectivity/PC sleep and retry this exact batch. Last completed account: ${start - 1}.`);
      console.error(`[BatchAudit] To resume: node scripts/phase6-safe-batch-audit.cjs --resume --to=${to}`);
      process.exitCode = 2;
      return;
    }
    week = parsed.week;
    total = parsed.total;
    checked += count;
    mismatched += parsed.mismatches;
    fs.writeFileSync(CHECKPOINT, JSON.stringify({ nextStart: start + count, lastCompleted: start + count - 1, week, total, updatedAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(`[BatchAudit] PASS accounts ${start}–${start + count - 1}. Mismatches=${parsed.mismatches}; checkpoint saved.`);
  }
  console.log(`\n[BatchAudit] READ_ONLY RANGE COMPLETE: accounts ${from}–${to}, scanned=${checked}, mismatches=${mismatched}, active accounts=${total}, Baghdad week=${week}.`);
  console.log("[BatchAudit] This is a diagnostic scan, NOT proof of full D1 cutover readiness. Keep CUTOVER=false.");
}
main().catch((error) => {
  console.error(`[BatchAudit] STOP: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
