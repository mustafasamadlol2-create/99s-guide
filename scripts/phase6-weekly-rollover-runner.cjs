#!/usr/bin/env node
"use strict";
/**
 * 99's Guide Phase 6 weekly Challenge/D1 rollout controller.
 * DRY-RUN by default. ALL writes require --apply --confirm-apply.
 * Each child command is exactly the existing per-window Phase6 reconciliation.
 * Never retry an ambiguous write. Verify after Outbox drain, fail closed.
 * Works on Windows & Render Linux: spawn Node->tsx CLI without CMD quoting.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(__dirname, 'phase6-gamification-weekly-reconcile.ts');
const CHECKPOINT = path.join(ROOT, '.phase6-rollover-checkpoint.json');
const args = process.argv.slice(2);
const has = (s) => args.includes('--' + s);
function intArg(name, fallback, min, max) {
  const hit = args.find(s => s.startsWith('--' + name + '='));
  if (!hit) return fallback;
  const raw = hit.slice(name.length + 3);
  if (!/^\d+$/.test(raw)) throw Error(`--${name} must be a positive integer`);
  const v = Number(raw);
  if (!Number.isSafeInteger(v) || v < min || v > max) throw Error(`--${name} must be ${min}..${max}`);
  return v;
}
const APPLY = has('apply');
const CRON = has('cron');
if (APPLY && !has('confirm-apply')) throw Error('Canonical writes require --apply --confirm-apply and a recent Supabase backup.');
if (!APPLY && has('confirm-apply')) throw Error('--confirm-apply requires --apply');
if (CRON && (!APPLY || process.env.PHASE6_ALLOW_AUTOMATED_CANONICAL_WRITES !== 'true')) {
  throw Error('Cron canonical writes need --apply --confirm-apply --cron AND PHASE6_ALLOW_AUTOMATED_CANONICAL_WRITES=true.');
}
if (CRON && process.env.PRIVATE_D1_PHASE6_GAMIFICATION_SYNC_ENABLED !== 'true') {
  throw Error('Cron needs PRIVATE_D1_PHASE6_GAMIFICATION_SYNC_ENABLED=true for live sync.');
}
if (/^(true|1|on|yes)$/i.test(process.env.PRIVATE_D1_PHASE6_GAMIFICATION_CUTOVER_ENABLED || '')) {
  throw Error('Phase6 CUTOVER must remain OFF during the initial reconciliation. Keep CUTOVER=false in this separate Cron service, even after web service cutover.');
}
const FROM = intArg('from', 1, 1, 1000000);
const TO = intArg('to', 0, 0, 1000000); // 0 means dynamic active account count
const SIZE = intArg('batch-size', 2, 1, 10);
const TIMEOUT_SEC = intArg('timeout-seconds', 180, 45, 900);
const VERIFY_WAIT_SEC = intArg('verify-wait-seconds', 10, 1, 60);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function cli() {
  try { return require.resolve('tsx/cli', { paths: [ROOT] }); }
  catch { throw Error('Cannot resolve tsx/cli. Run npm install in the project root.'); }
}
if (!fs.existsSync(SOURCE)) throw Error(`Missing ${SOURCE}`);
function readCheckpoint() {
  if (!fs.existsSync(CHECKPOINT)) throw Error('No local checkpoint. Run with --from=N.');
  const cp = JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
  if (!Number.isSafeInteger(cp.nextStart) || !/^\d{4}-\d{2}-\d{2}$/.test(cp.week)) throw Error('Invalid checkpoint.');
  return cp;
}
let START = has('resume') ? readCheckpoint().nextStart : FROM;
let expectedWeek = has('resume') ? readCheckpoint().week : null;
let expectedTotal = has('resume') ? readCheckpoint().total : null;
const shouldCheckpoint = !CRON;
async function runWindow(start, count, mode) {
  const cmdArgs = [cli(), SOURCE, `--start-at=${start}`, `--max-accounts=${count}`];
  if (mode === 'apply') cmdArgs.push('--apply', '--confirm-apply', `--max=${count}`);
  const child = spawn(process.execPath, cmdArgs, { cwd: ROOT, env: process.env, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
  let output = ''; let timedOut = false;
  for (const [stream, target] of [[child.stdout, process.stdout],[child.stderr, process.stderr]]) {
    stream.on('data', chunk => { const str = String(chunk); output = (output + str).slice(-100000);
      target.write(str); });
  }
  let timer;
  const exit = await new Promise(resolve => {
    timer = setTimeout(() => { timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/T','/F','/PID', String(child.pid)], { windowsHide:true,stdio:'ignore' });
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      } else child.kill('SIGKILL');
    }, TIMEOUT_SEC * 1000);
    child.on('error', err => resolve({ code: 1, error: err.message }));
    child.on('close', code => resolve({ code }));
  });
  clearTimeout(timer);
  if (timedOut) throw Error(`TIMEOUT at ${start}..${start+count-1} (${mode}); do not blindly repeat writes`);
  if (exit.error) throw Error(`Process spawn failure: ${exit.error}`);
  const header = output.match(/Baghdad week=(\d{4}-\d{2}-\d{2}); active accounts=(\d+)/);
  const footer = output.match(/inspected=(\d+)\/(\d+); divergent observed=(\d+); outbox queued=(\d+); existing pending\/blocked\/poison=(\d+); failed=(\d+)/);
  if (!header || !footer || exit.code !== 0) {
    throw Error(`Incomplete or failed ${mode} at ${start}..${start+count-1} (exit=${exit.code}); inspect child logs; no automatic write retries`);
  }
  const result = { week: header[1], total: Number(header[2]), inspected: Number(footer[1]),
    requested: Number(footer[2]), divergent: Number(footer[3]), queued: Number(footer[4]),
    pending: Number(footer[5]), failed: Number(footer[6]) };
  if (result.inspected !== count || result.requested !== count || result.failed || result.pending) {
    throw Error(`Partial ${mode} result at ${start}: ${JSON.stringify(result)}; inspect logs`);
  }
  if (expectedWeek && expectedWeek !== result.week) throw Error('Baghdad week changed mid-run; stop.');
  if (expectedTotal !== null && expectedTotal !== result.total) throw Error('Active account count changed mid-run; stop and re-plan indices.');
  expectedWeek ??= result.week;
  expectedTotal ??= result.total;
  return result;
}
function checkpoint(next) {
  if (!shouldCheckpoint) return;
  const data = { week: expectedWeek, total: expectedTotal, nextStart: next, mode: APPLY ? 'APPLY' : 'READ_ONLY', updatedAt: new Date().toISOString() };
  const tmp = CHECKPOINT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, CHECKPOINT);
}
async function main() {
  if (has('resume') && readCheckpoint().mode !== (APPLY ? 'APPLY' : 'READ_ONLY'))
    throw Error('Checkpoint mode mismatch. Use explicit --from=N.');
  console.log(`[Phase6 controller] ${APPLY ? 'CANONICAL WRITES ENABLED' : 'READ_ONLY'}; from=${START}, to=${TO || 'live active count'}, batch-size=${SIZE}; cron=${CRON}.`);
  console.log('[Phase6 controller] No weekly leaderboard changes. Weekly Challenges remain enabled.');
  let matched = 0, queued = 0, examined = 0, last = START-1;
  // Until total is discovered, do an initial single-account read. Do NOT write.
  if (!expectedTotal) {
    const preflight = await runWindow(START, 1, 'read');
    if (TO && TO > preflight.total) throw Error(`Requested --to=${TO} exceeds ${preflight.total} active accounts`);
    if (preflight.total < START) throw Error('Start exceeds active user count');
  }
  const stop = TO || expectedTotal;
  if (stop > expectedTotal) throw Error('End exceeds active account count.');
  for (let start=START; start<=stop; start+=SIZE) {
    const count=Math.min(SIZE, stop-start+1);
    console.log(`[Phase6 controller] Window ${start}..${start+count-1}`);
    const before=await runWindow(start,count,'read');
    examined+=count;
    if (before.divergent===0) { matched+=count; last=start+count-1; checkpoint(last+1); continue; }
    if (!APPLY) { console.log(`[Phase6 controller] DRY_RUN mismatch=${before.divergent} in ${start}..${start+count-1}`); last=start+count-1; checkpoint(last+1); continue; }
    const applied=await runWindow(start,count,'apply');
    queued+=applied.queued;
    // NEVER repeat canonical refresh/award after ambiguous failure. Poll only READ_ONLY verification.
    let reconciled=false;
    for (const delay of [VERIFY_WAIT_SEC, VERIFY_WAIT_SEC * 2, VERIFY_WAIT_SEC * 3, VERIFY_WAIT_SEC * 4]) {
      await sleep(delay*1000);
      const checked=await runWindow(start,count,'read');
      if (checked.divergent===0) { reconciled=true; break; }
      console.warn(`[Phase6 controller] Still divergent=${checked.divergent} for ${start}..${start+count-1}; waiting for Outbox drainer.`);
    }
    if (!reconciled) throw Error(`D1 parity not confirmed for ${start}..${start+count-1}; inspect Outbox/Render; do NOT rerun --apply blindly.`);
    matched+=count;last=start+count-1;checkpoint(last+1);
    console.log(`[Phase6 controller] VERIFIED ${start}..${last}. Total queued=${queued}.`);
  }
  console.log(`[Phase6 controller] ${APPLY ? 'ROLLOVER PASS' : 'READ_ONLY SCAN COMPLETE'}; examined=${examined}; matched=${matched}; queued=${queued}; last=${last}; week=${expectedWeek}.`);
  console.log(APPLY ? '[Phase6 controller] Run npm run gamification:d1:verify and UI tests before CUTOVER.' : '[Phase6 controller] No database writes performed.');
}
main().catch(err => { console.error(`[Phase6 controller] STOP: ${err.message}`); process.exitCode=2; });
