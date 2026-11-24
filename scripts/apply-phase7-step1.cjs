"use strict";
/* 99s Guide — Phase 7.1 audited, non-destructive installer. No network / database / env access. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const payloadRoot = path.join(root, "phase7-step1-payload");
const backupRoot = path.join(root, ".phase7-step1-backup");
const manifest = [
  {
    "path": "server/features/leaderboard/types.ts",
    "before": "da328af02c5ad6dc9d0ba8a495412e8135c0ebf91fcfa30718636b70ddb6b673",
    "after": "ea4d530f5df9e1763ca6542be0ca12cc3af47856e97397edfedf261768daf74d"
  },
  {
    "path": "server/features/leaderboard/periods.ts",
    "before": "41dbe89c8fb6482f2cdb425bf8c000c030fac982fd664e499001496773739a46",
    "after": "136e4ecb4dce88565866d41225f7eafdec8da8f4f242ea667c444f166954a782"
  },
  {
    "path": "server/routes/leaderboards.ts",
    "before": "b4b93ddfa4ff0ea9e040519316b86bb3d9219011706ef1311a716372d2ba9f0a",
    "after": "d7b937d4b53be52bad426e4acbbfae70f20a0b39b92fb7db662137e7404ade91"
  },
  {
    "path": "src/features/gamification/types.ts",
    "before": "303d95070fc10e58be1d80bd3753fc471853d3536a612fb30a65110d13bb5041",
    "after": "7e38afcded7dfade1301dcbfcd78f97667bc65ea5d2a69284fad8ef471493947"
  },
  {
    "path": "src/features/gamification/LeaderboardView.tsx",
    "before": "f21384b7dd308c9c71514bd3694f5ff743f9c01fc1945bdb6bb01edf283bdd79",
    "after": "d5cf8b35223740140c69190e29895fae2add12bcdee6aeb09e42d9af995d97e9"
  },
  {
    "path": "tests/leaderboard.test.ts",
    "before": "aa71a65a34c9a8d25193652565bff6bf8b44902554bd5c34a43a2a221e4e30c6",
    "after": "730df4ccc7ede60e02b450c37aab623ab455012b01f146e0486168385f6c03a4"
  },
  {
    "path": "tests/phase7-public-leaderboard-scopes.test.ts",
    "before": null,
    "after": "96da11888b8104cf86b87517e397c7398e95fa2b5542edc4870334d771865d03"
  }
];
const hash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const read = (filename) => fs.existsSync(filename) ? fs.readFileSync(filename) : null;
const target = (relative) => path.join(root, ...relative.split("/"));
const payload = (relative) => path.join(payloadRoot, ...relative.split("/"));
const backup = (relative) => path.join(backupRoot, ...relative.split("/"));
function status(entry) {
  const current = read(target(entry.path));
  const currentHash = current ? hash(current) : null;
  if (currentHash === entry.after) return "already";
  if (currentHash === entry.before) return "ready";
  return "BASELINE_CHANGED";
}
function verifyPayload() {
  for (const entry of manifest) {
    const bytes = read(payload(entry.path));
    if (!bytes || hash(bytes) !== entry.after) {
      console.error(`[Phase7.1] PAYLOAD_INVALID ${entry.path}`);
      process.exit(2);
    }
  }
}
function backupExisting(entry) {
  if (entry.before === null) return;
  const old = fs.readFileSync(target(entry.path));
  const backupPath = backup(entry.path);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  const prior = read(backupPath);
  if (prior) {
    if (hash(prior) !== entry.before) throw new Error(`BACKUP_CONFLICT ${entry.path}`);
  } else {
    fs.writeFileSync(backupPath, old, { flag: "wx" });
  }
}
function writeAtomic(filename, bytes) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const tmp = filename + ".phase7tmp-" + process.pid;
  fs.writeFileSync(tmp, bytes, { flag: "wx" });
  fs.renameSync(tmp, filename);
}
function main() {
  const mode = process.argv[2] || "--check";
  if (!["--check", "--apply", "--rollback"].includes(mode) || process.argv.length > 3) {
    console.error("Usage: node scripts/apply-phase7-step1.cjs [--check|--apply|--rollback]");
    process.exitCode = 2; return;
  }
  if (mode !== "--rollback") verifyPayload();
  const statuses = manifest.map((entry) => ({ ...entry, status: status(entry) }));
  const blocked = statuses.filter((entry) => entry.status === "BASELINE_CHANGED");
  if (blocked.length) {
    for (const entry of blocked) console.error(`[Phase7.1] BASELINE_CHANGED ${entry.path}`);
    console.error("[Phase7.1] STOP: Local files differ from uploaded project baseline. No writes performed.");
    process.exitCode = 2; return;
  }
  if (mode === "--rollback") {
    const pending = statuses.filter((entry) => entry.status === "already");
    for (const entry of pending) {
      if (entry.before === null) continue;
      const prior = read(backup(entry.path));
      if (!prior || hash(prior) !== entry.before) {
        console.error(`[Phase7.1] BACKUP_MISSING_OR_CHANGED ${entry.path}`);
        process.exitCode = 2; return;
      }
    }
    for (const entry of pending) {
      if (entry.before === null) fs.unlinkSync(target(entry.path));
      else writeAtomic(target(entry.path), fs.readFileSync(backup(entry.path)));
      console.log(`[Phase7.1] ROLLED_BACK ${entry.path}`);
    }
    console.log(`[Phase7.1] ROLLBACK_PASS reverted=${pending.length}`); return;
  }
  console.log(`[Phase7.1] CHECK_PASS files=${statuses.length} ready=${statuses.filter(e=>e.status==='ready').length} already=${statuses.filter(e=>e.status==='already').length}`);
  if (mode !== "--apply") {
    console.log("[Phase7.1] NO_WRITES. Run --apply after a Git checkpoint."); return;
  }
  // Preflight every backup before the first target write; avoid half-applied patches.
  const pending = statuses.filter((entry) => entry.status === "ready");
  for (const entry of pending) {
    if (entry.before !== null) {
      const oldBackup = read(backup(entry.path));
      if (oldBackup && hash(oldBackup) !== entry.before) {
        console.error(`[Phase7.1] BACKUP_CONFLICT ${entry.path}`);
        process.exitCode = 2; return;
      }
    }
  }
  for (const entry of pending) backupExisting(entry);
  for (const entry of pending) {
    writeAtomic(target(entry.path), fs.readFileSync(payload(entry.path)));
    console.log(`[Phase7.1] PATCHED ${entry.path}`);
  }
  console.log(`[Phase7.1] APPLY_PASS files=${pending.length}. No DB writes, migrations or environment changes.`);
}
try { main(); } catch (error) { console.error(`[Phase7.1] ERROR ${error.message}`); process.exitCode = 2; }
