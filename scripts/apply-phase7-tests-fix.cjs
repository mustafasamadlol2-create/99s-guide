"use strict";
/* Test-only Phase 7.1 repair, never touches runtime, network or DB. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const entry = {"path": "tests/leaderboard.test.ts", "before": "730df4ccc7ede60e02b450c37aab623ab455012b01f146e0486168385f6c03a4", "after": "4546c25b833b654e5741eb68f6649716c1ac3a7e695e96f0a4164e9bc9c7dd8f"};
const target = path.join(root, ...entry.path.split("/"));
const payload = path.join(root, "phase7-tests-fix-payload", "leaderboard.test.ts.txt");
const backup = path.join(root, ".phase7-tests-fix-backup", ...entry.path.split("/"));
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const read = (filename) => fs.existsSync(filename) ? fs.readFileSync(filename) : null;
const status = (b) => b === null ? "MISSING" : hash(b) === entry.after ? "ALREADY" : hash(b) === entry.before ? "READY" : "BASELINE_CHANGED";
function atomic(filename, data) {
  fs.mkdirSync(path.dirname(filename), {recursive:true});
  const tmp = filename + ".phase7fix-" + process.pid;
  fs.writeFileSync(tmp, data, {flag:"wx"});
  try { fs.renameSync(tmp, filename); } catch(e) { fs.rmSync(tmp, {force:true}); throw e; }
}
function run() {
 const mode = process.argv[2] || "--check";
 if (!['--check','--apply','--rollback'].includes(mode)) throw Error('Usage: node scripts/apply-phase7-tests-fix.cjs [--check|--apply|--rollback]');
 const current = read(target); const state=status(current);
 if (state==='MISSING'||state==='BASELINE_CHANGED') throw Error(`STOP ${state}: ${entry.path}. No changes made.`);
 if (mode==='--rollback') {
   if (state==='READY') return console.log('[Phase7 QA] ROLLBACK_ALREADY');
   const prior=read(backup);
   if (!prior||hash(prior)!==entry.before) throw Error('STOP BACKUP_MISSING_OR_CHANGED');
   atomic(target,prior); console.log('[Phase7 QA] ROLLBACK_PASS');return;
 }
 const next=read(payload);
 if(!next||hash(next)!==entry.after) throw Error('STOP PAYLOAD_INVALID');
 console.log(`[Phase7 QA] CHECK_PASS state=${state}`);
 if(mode==='--check') return console.log('[Phase7 QA] NO_WRITES');
 if(state==='ALREADY') return console.log('[Phase7 QA] APPLY_ALREADY');
 const old=read(backup);
 if(old && hash(old)!==entry.before) throw Error('STOP BACKUP_CONFLICT');
 if(!old){fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,current,{flag:'wx'});}
 atomic(target,next);
 console.log('[Phase7 QA] APPLY_PASS: test file only; no runtime, database, env, or migrations changed.');
}
try {run();} catch(e){console.error('[Phase7 QA]',e.message);process.exitCode=2;}
