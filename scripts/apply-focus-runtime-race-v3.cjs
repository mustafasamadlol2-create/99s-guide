#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const payloadPath = path.join(root, 'focus-runtime-race-v3.payload.json');
const markerPath = path.join(root, '.focus-runtime-race-v3-backup.json');
const mode = process.argv[2] ?? 'check';
function stop(message) { console.error('[FocusRuntimeRaceV3] STOP: '+message); process.exit(1); }
function hash(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function target(rel) {
  if (typeof rel !== 'string' || !/^(src|tests)\/[A-Za-z0-9_./-]+$/.test(rel) || rel.split('/').includes('..')) stop('UNSAFE_PATH '+rel);
  const f = path.resolve(root, ...rel.split('/'));
  if (!f.startsWith(root + path.sep)) stop('UNSAFE_PATH '+rel);
  return f;
}
if (!['check','--apply','--rollback'].includes(mode) || process.argv.length > 3) {
  stop('Usage: node scripts/apply-focus-runtime-race-v3.cjs [--apply | --rollback]');
}
if (mode === '--rollback') {
  if (!fs.existsSync(markerPath)) stop('NO_BACKUP_MARKER');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  const directory = path.resolve(marker.backup);
  if (!directory.startsWith(path.dirname(root) + path.sep) || !fs.existsSync(path.join(directory,'manifest.json'))) stop('INVALID_BACKUP');
  const files = JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  for (const item of files) {
    const f = target(item.path); const backup = path.join(directory,...item.path.split('/'));
    if (!fs.existsSync(f) || hash(fs.readFileSync(f)) !== item.after) stop('LOCAL_EDIT_DETECTED '+item.path);
    if (!fs.existsSync(backup) || hash(fs.readFileSync(backup)) !== item.before) stop('BACKUP_MISMATCH '+item.path);
  }
  for (const item of files) fs.copyFileSync(path.join(directory,...item.path.split('/')),target(item.path));
  fs.unlinkSync(markerPath);
  console.log('[FocusRuntimeRaceV3] ROLLBACK_PASS; backup remains at '+directory);
  process.exit(0);
}
if (!fs.existsSync(payloadPath)) stop('PAYLOAD_MISSING: unzip the entire archive in the project root');
const payload = JSON.parse(fs.readFileSync(payloadPath,'utf8'));
if (payload.format !== 1 || !Array.isArray(payload.files) || payload.files.length !== 2) stop('PAYLOAD_INVALID');
const files = payload.files.map(item=>{
  const file=target(item.path), data=Buffer.from(item.data,'base64');
  if (hash(data) !== item.after) stop('PAYLOAD_INTEGRITY_FAILED '+item.path);
  if (!fs.existsSync(file)) stop('FILE_MISSING '+item.path);
  const current=fs.readFileSync(file), found=hash(current);
  if (found!==item.before && found!==item.after) stop('BASELINE_CHANGED '+item.path+' — do NOT force');
  return {...item, file, data, current, found};
});
const pending=files.filter(e=>e.found===e.before);
console.log(`[FocusRuntimeRaceV3] CHECK_PASS files=2 ready=${pending.length} already=${files.length-pending.length}`);
if (mode !== '--apply') {
  console.log('[FocusRuntimeRaceV3] NO_WRITES; use --apply only after a Git checkpoint');
  process.exit(0);
}
if (!pending.length) { console.log('[FocusRuntimeRaceV3] ALREADY_APPLIED'); process.exit(0); }
if (pending.length !== files.length) stop('PARTIALLY_APPLIED; no changes made');
if (fs.existsSync(markerPath)) stop('BACKUP_ALREADY_EXISTS');
const backup = path.resolve(root,'..','99s-guide-focus-runtime-race-v3-backup-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(backup, {recursive:true});
for (const item of files) {
  const b=path.join(backup,...item.path.split('/'));
  fs.mkdirSync(path.dirname(b),{recursive:true});
  fs.writeFileSync(b,item.current,{flag:'wx'});
}
fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify(files.map(e=>({path:e.path,before:e.before,after:e.after})),null,2),{flag:'wx'});
const written=[];
try {
  for (const item of files) {
    fs.writeFileSync(item.file,item.data);
    written.push(item);
    console.log('[FocusRuntimeRaceV3] PATCHED '+item.path);
  }
  fs.writeFileSync(markerPath,JSON.stringify({backup,appliedAt:new Date().toISOString()},null,2),{flag:'wx'});
} catch(error) {
  for (const item of written.reverse()) fs.writeFileSync(item.file,item.current);
  stop('PATCH_ROLLED_BACK '+String(error));
}
console.log('[FocusRuntimeRaceV3] APPLY_PASS; no database writes, no environment changes');
