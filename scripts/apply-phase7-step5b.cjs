#!/usr/bin/env node
'use strict';
// Phase 7.5B: guarded local install. No network, DB or environment writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.cwd();
const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'phase7-step5b.payload.json'), 'utf8'));
const flags = new Set(process.argv.slice(2));
const apply = flags.has('--apply');
const restore = flags.has('--restore');
if (apply && restore) { console.error('Only one mode allowed.'); process.exit(2); }
const backup = path.join(root, '.phase7-step5b-backup.json');
const existingBackup = fs.existsSync(backup) ? JSON.parse(fs.readFileSync(backup, 'utf8')) : null;
const sha = b => b === null ? null : crypto.createHash('sha256').update(b).digest('hex');
const pending = []; let ready = 0, already = 0, blocked = 0;
if (restore && !existingBackup) { console.error('[Phase7.5B] RESTORE_BLOCKED: no local backup.'); process.exit(2); }
for (const [relative, spec] of Object.entries(p.files)) {
  const f = path.resolve(root, ...relative.split('/'));
  if (!f.startsWith(root + path.sep)) { console.error('[Phase7.5B] Invalid path.'); process.exit(2); }
  const current = fs.existsSync(f) ? fs.readFileSync(f) : null;
  const expected = restore ? spec.newSha256 : spec.expectedSha256;
  const target = restore
    ? existingBackup[relative] === null ? null
      : existingBackup[relative]?.type === 'Buffer' ? Buffer.from(existingBackup[relative].data) : undefined
    : Buffer.from(spec.contentBase64, 'base64');
  if (target === undefined) { console.error('[Phase7.5B] Missing backup content for ' + relative); process.exit(2); }
  if (sha(current) === sha(target)) { already++; continue; }
  if (sha(current) !== expected) {
    console.error('[Phase7.5B] BASELINE_CHANGED ' + relative + '; no files modified.');
    blocked++;
    continue;
  }
  ready++; pending.push({relative, f, current, target});
}
if (blocked) process.exit(2);
console.log(`[Phase7.5B] CHECK_PASS files=${Object.keys(p.files).length} ready=${ready} already=${already}`);
if (!apply && !restore) { console.log('[Phase7.5B] NO_WRITES. Commit or back up before --apply.'); process.exit(0); }
if (restore) {
  for (const op of pending) {
    if (op.target === null) fs.unlinkSync(op.f); else fs.writeFileSync(op.f,op.target);
  }
  console.log(`[Phase7.5B] RESTORE_PASS files=${pending.length}`); process.exit(0);
}
if (existingBackup && ready) { console.error('[Phase7.5B] BACKUP_EXISTS. Refusing overwrite.'); process.exit(2); }
if (ready) {
  fs.writeFileSync(backup, JSON.stringify(Object.fromEntries(pending.map(op => [op.relative,op.current])),null,2));
  for (const op of pending) {
    fs.mkdirSync(path.dirname(op.f),{recursive:true});
    fs.writeFileSync(op.f,op.target);
    console.log('[Phase7.5B] PATCHED ' + op.relative);
  }
}
console.log(`[Phase7.5B] APPLY_PASS files=${pending.length}; no DB/env/network changes.`);
