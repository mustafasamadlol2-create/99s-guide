#!/usr/bin/env node
'use strict';
// Phase 7.5A: hash-guarded install + restore. Reads only unless --apply.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.cwd();
const payloadPath = path.join(__dirname, '..', 'phase7-step5a.payload.json');
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const restore = args.has('--restore');
if (apply && restore) { console.error('Choose --apply or --restore, not both.'); process.exit(2); }
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const backupPath = path.join(root, '.phase7-step5a-backup.json');
const existingBackup = fs.existsSync(backupPath) ? JSON.parse(fs.readFileSync(backupPath, 'utf8')) : null;
const records = Object.entries(payload.files);
let ready = 0, already = 0, blocked = 0;
const pending = [];
if (restore && !existingBackup) { console.error('[Phase7.5A] RESTORE_BLOCKED: missing backup file.'); process.exit(2); }
for (const [relative, spec] of records) {
  const filePath = path.join(root, ...relative.split('/'));
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const currentHash = current ? hash(current) : null;
  const expected = restore ? spec.newSha256 : spec.expectedSha256;
  const target = restore ? existingBackup?.[relative] : Buffer.from(spec.contentBase64, 'base64');
  if (restore && target === undefined) { console.error('[Phase7.5A] RESTORE_BLOCKED: incomplete backup for ' + relative); process.exit(2); }
  if (restore && target !== null && !Buffer.isBuffer(target)) {
    // Serialized Buffer data is restored to its binary representation below.
  }
  const normalizedTarget = restore ? (target === null ? null : Buffer.from(target.data)) : target;
  const targetHash = normalizedTarget ? hash(normalizedTarget) : null;
  if (currentHash === targetHash) { already++; continue; }
  if (currentHash !== expected) {
    console.error('[Phase7.5A] BASELINE_CHANGED ' + relative + '. No files were changed.');
    blocked++;
    continue;
  }
  ready++;
  pending.push({relative, filePath, current, target:normalizedTarget});
}
if (blocked) process.exit(2);
console.log(`[Phase7.5A] CHECK_PASS files=${records.length} ready=${ready} already=${already}`);
if (!apply && !restore) { console.log('[Phase7.5A] NO_WRITES. Save a Git checkpoint before --apply.'); process.exit(0); }
if (restore) {
  for (const op of pending) {
    if (op.target === null) fs.unlinkSync(op.filePath);
    else fs.writeFileSync(op.filePath, op.target);
  }
  console.log(`[Phase7.5A] RESTORE_PASS files=${pending.length}`);
  process.exit(0);
}
if (existingBackup && ready) {
  console.error('[Phase7.5A] BACKUP_EXISTS. Refusing to replace a previous backup.');
  process.exit(2);
}
if (ready) {
  const backups = Object.fromEntries(pending.map(op => [op.relative, op.current]));
  fs.writeFileSync(backupPath, JSON.stringify(backups, null, 2));
  for (const op of pending) {
    fs.mkdirSync(path.dirname(op.filePath), {recursive:true});
    fs.writeFileSync(op.filePath, op.target);
    console.log('[Phase7.5A] PATCHED ' + op.relative);
  }
}
console.log(`[Phase7.5A] APPLY_PASS files=${pending.length}; no DB or environment changes.`);
