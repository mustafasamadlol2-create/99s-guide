'use strict';
/**
 * Guarded TypeScript project separation + runtime-status check.
 * CHECK_ONLY by default. --apply and --rollback are local source edits only.
 * Never changes server data or deployments.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = process.cwd();
const apply = process.argv.includes('--apply');
const rollback = process.argv.includes('--rollback');
if (apply && rollback) { console.error('[FocusTS] Choose either --apply or --rollback'); process.exit(2); }
const backupDir = path.join(root, '.focus-tscheck-backup');
const targets = [
  {
    rel: 'src/features/group-focus/runtime/groupFocusRealtime.ts',
    transform(before) {
      const oldBlock = `        && !this.disposed\n        && this.snapshot.status !== "TERMINAL"\n      ) {\n        this.clearStoredResumeToken();`;
      const newBlock = `        && !this.disposed\n        && !this.isRuntimeTerminal()\n      ) {\n        this.clearStoredResumeToken();`;
      const methodAnchor = `  requestRoomState(): void {\n    this.send("ROOM_STATE_REQUEST");\n  }`;
      const methodReplacement = `  // Snapshot status can change in WebSocket callbacks while connect() is awaiting.\n  // Read it in a method so TS does not incorrectly treat its earlier narrowing\n  // as permanent after the asynchronous handshake has settled.\n  private isRuntimeTerminal(): boolean {\n    return this.snapshot.status === "TERMINAL";\n  }\n\n` + methodAnchor;
      if (before.includes(newBlock) && before.includes(methodReplacement)) return before;
      if (count(before, oldBlock) !== 1 || count(before, methodAnchor) !== 1 || before.includes('private isRuntimeTerminal()')) {
        throw new Error('ANCHOR_MISMATCH: GroupFocus realtime runtime has changed; no edits made');
      }
      return before.replace(oldBlock, newBlock).replace(methodAnchor, methodReplacement);
    },
  },
  {
    rel: 'tsconfig.json',
    transform(before) {
      let parsed;
      try { parsed = JSON.parse(before); } catch { throw Error('tsconfig.json is not JSON; no edits made'); }
      if (!Array.isArray(parsed.exclude) || !parsed.exclude.includes('cloudflare-group-focus-worker')) {
        throw Error('ANCHOR_MISMATCH: expected separate group-focus Worker in tsconfig.exclude');
      }
      if (parsed.exclude.includes('cloudflare-main-worker.ts')) return before;
      const anchor = `    "cloudflare-group-focus-worker",`;
      if (count(before, anchor) !== 1) throw Error('ANCHOR_MISMATCH: tsconfig exclude layout changed');
      const after = before.replace(anchor, `${anchor}\n    "cloudflare-main-worker.ts",`);
      JSON.parse(after);
      return after;
    },
  },
  {
    rel: 'tsconfig.cloudflare-main.json',
    transform(before) {
      const candidate = JSON.stringify({
        extends: './cloudflare-group-focus-worker/tsconfig.json',
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: [
          'cloudflare-main-worker.ts',
          'cloudflare-group-focus-worker/src/**/*.ts',
          'cloudflare-group-focus-worker/worker-configuration.d.ts',
          'shared/group-focus-capability/**/*.ts',
          'shared/group-focus-realtime/**/*.ts',
          'shared/group-focus-reconciliation/**/*.ts',
        ],
      }, null, 2) + '\n';
      if (before === candidate) return before;
      if (before) throw new Error('EXISTS: tsconfig.cloudflare-main.json already exists with different contents; please review it manually');
      return candidate;
    },
  },
];
function count(haystack, needle) { return haystack.split(needle).length - 1; }

if (rollback) {
  if (!fs.existsSync(backupDir)) { console.error('[FocusTS] No backups to restore'); process.exit(3); }
  try {
    for (const t of targets) {
      const item = { rel: t.rel, abs:path.join(root,t.rel) };
      const meta = path.join(backupDir, item.rel + '.meta.json');
      if (!fs.existsSync(meta)) throw Error(`Missing rollback metadata ${item.rel}`);
      const original = JSON.parse(fs.readFileSync(meta, 'utf8'));
      if (original.existed && !fs.existsSync(path.join(backupDir,item.rel))) throw Error(`Missing backup for ${item.rel}`);
    }
    for (const t of targets) {
      const item = { rel:t.rel, abs:path.join(root,t.rel) };
      const meta = JSON.parse(fs.readFileSync(path.join(backupDir,item.rel + '.meta.json'),'utf8'));
      if (meta.existed) fs.copyFileSync(path.join(backupDir,item.rel), item.abs);
      else if (fs.existsSync(item.abs)) fs.unlinkSync(item.abs);
      console.log('[FocusTS] RESTORED:', item.rel);
    }
  } catch (e) { console.error('[FocusTS] Rollback failed:',e.message); process.exit(3); }
  process.exit(0);
}


const planned = [];
try {
  for (const t of targets) {
    const abs = path.join(root, t.rel);
    if (!fs.existsSync(abs) && t.rel !== 'tsconfig.cloudflare-main.json') throw Error(`MISSING_FILE: ${t.rel}`);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    const after = t.transform(before ?? '');
    planned.push({rel:t.rel, abs, before, after, changed:before !== after});
  }
} catch (e) {
  console.error('[FocusTS] CHECK FAILED:', e.message, '; nothing written');
  process.exit(2);
}


console.log(`[FocusTS] ${apply?'APPLY':'CHECK_ONLY'} compatible=${planned.length}; changed=${planned.filter(x=>x.changed).length}; already-patched=${planned.filter(x=>!x.changed).length}`);
for (const t of planned) console.log(' ',t.rel,t.changed?'(change)': '(already patched)');
if (!apply) { console.log('[FocusTS] No writes. Run --apply after creating a Git checkpoint.'); process.exit(0); }
const changes=planned.filter(x=>x.changed);
if (!changes.length) { console.log('[FocusTS] Already applied; no edits needed.'); process.exit(0); }
if (fs.existsSync(backupDir)) { console.error('[FocusTS] Backup exists; refusing to overwrite. No files changed.'); process.exit(3); }
const staged=[];
try {
  // Prepare ALL backups and temporary replacement files before any modification.
  for (const item of planned) {
    const backup = path.join(backupDir,item.rel);
    fs.mkdirSync(path.dirname(backup),{recursive:true});
    if (item.before !== null) fs.writeFileSync(backup,item.before,{flag:'wx'});
    fs.writeFileSync(backup + '.meta.json',JSON.stringify({existed:item.before!==null}),{flag:'wx'});
  }
  for (const item of changes) {
    const tmp = `${item.abs}.focusts-${crypto.randomBytes(5).toString('hex')}.tmp`;
    fs.writeFileSync(tmp,item.after);
    staged.push({item,tmp});
  }
  for (const {item,tmp} of staged) {
    fs.renameSync(tmp,item.abs);
    console.log('[FocusTS] PATCHED:', item.rel);
  }
  console.log('[FocusTS] DONE. Run npm run typecheck and npx tsc -p tsconfig.cloudflare-main.json');
} catch(e) {
  console.error('[FocusTS] Apply failed, restoring original files:',e.message);
  for (const {item,tmp} of staged) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    if (item.before === null) {if(fs.existsSync(item.abs))fs.unlinkSync(item.abs)}
    else fs.writeFileSync(item.abs,item.before);
  }
  process.exit(3);
}
