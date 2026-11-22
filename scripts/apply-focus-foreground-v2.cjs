#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dataFile = path.join(root, 'focus-foreground-v2.payload.json');
const backupMarker = path.join(root, '.focus-foreground-v2-backup.json');
const args = process.argv.slice(2);
function stop(message) { console.error(`[FocusForegroundV2] STOP ${message}`); process.exit(1); }
function sha(contents) { return crypto.createHash('sha256').update(contents).digest('hex'); }
function destFor(rel) {
  if (typeof rel !== 'string' || !/^(src|tests)\/[A-Za-z0-9_./-]+$/.test(rel) || rel.split('/').includes('..')) stop('UNSAFE_PATH');
  const out = path.resolve(root, ...rel.split('/'));
  if (!out.startsWith(root + path.sep)) stop('UNSAFE_PATH');
  return out;
}
if (args.length > 1 || args.some(a => !['--apply', '--rollback'].includes(a))) {
  stop('Usage: node scripts/apply-focus-foreground-v2.cjs [--apply | --rollback]');
}
if (args[0] === '--rollback') {
  if (!fs.existsSync(backupMarker)) stop('NO_BACKUP_MARKER');
  const marker = JSON.parse(fs.readFileSync(backupMarker, 'utf8'));
  const backupDir = path.resolve(marker.backup);
  if (!backupDir.startsWith(path.dirname(root) + path.sep) ||
      !fs.existsSync(path.join(backupDir, 'manifest.json'))) stop('BAD_BACKUP_LOCATION');
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  for (const e of manifest) {
    const dest = destFor(e.path);
    if (!fs.existsSync(dest) || sha(fs.readFileSync(dest)) !== e.after) stop('LOCAL_EDIT_DETECTED '+e.path);
    if (e.before) {
      const backupPath = path.join(backupDir, ...e.path.split('/'));
      if (!fs.existsSync(backupPath) || sha(fs.readFileSync(backupPath)) !== e.before) stop('BAD_BACKUP '+e.path);
    }
  }
  for (const e of manifest) {
    const dest = destFor(e.path);
    if (e.before) fs.copyFileSync(path.join(backupDir, ...e.path.split('/')), dest);
    else fs.unlinkSync(dest);
  }
  fs.unlinkSync(backupMarker);
  console.log('[FocusForegroundV2] ROLLBACK_PASS. Originals restored; backup retained at '+backupDir);
  process.exit(0);
}
if (!fs.existsSync(dataFile)) stop('PAYLOAD_MISSING. Extract ZIP at project root.');
const payload = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
if (payload.format !== 1 || !Array.isArray(payload.files) || payload.files.length !== 3) stop('PAYLOAD_FORMAT');
const entries = [];
for (const e of payload.files) {
  const dest = destFor(e.path);
  const data = Buffer.from(e.data, 'base64');
  if (sha(data) !== e.after) stop('PAYLOAD_HASH_MISMATCH '+e.path);
  const exists = fs.existsSync(dest);
  const before = exists ? fs.readFileSync(dest) : null;
  const actual = before ? sha(before) : null;
  if (actual !== e.before && actual !== e.after) stop('BASELINE_CHANGED '+e.path+'; STOP, do not force overwrite.');
  entries.push({path:e.path, dest, data, before, actual, beforeHash:e.before, afterHash:e.after});
}
const ready = entries.filter(e => e.actual !== e.afterHash);
console.log(`[FocusForegroundV2] CHECK_PASS files=${entries.length} ready=${ready.length} already=${entries.length-ready.length}`);
if (args[0] !== '--apply') {
  console.log('[FocusForegroundV2] NO_WRITES. Create a Git checkpoint before --apply.');
  process.exit(0);
}
if (!ready.length) { console.log('[FocusForegroundV2] Already applied.'); process.exit(0); }
if (ready.length !== entries.length) stop('PARTIALLY_APPLIED');
if (fs.existsSync(backupMarker)) stop('BACKUP_MARKER_EXISTS');
const dir = path.resolve(root, '..', '99s-guide-focus-foreground-backup-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(dir, { recursive:true });
try {
  for (const e of entries) {
    if (!e.before) continue;
    const bak = path.join(dir,...e.path.split('/'));
    fs.mkdirSync(path.dirname(bak),{recursive:true});
    fs.writeFileSync(bak,e.before,{flag:'wx'});
  }
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(entries.map(e=>({path:e.path,before:e.beforeHash,after:e.afterHash})),null,2),{flag:'wx'});
  const applied=[];
  try {
    for (const e of entries) {
      fs.mkdirSync(path.dirname(e.dest),{recursive:true});
      fs.writeFileSync(e.dest,e.data);
      applied.push(e);
      console.log('[FocusForegroundV2] PATCHED '+e.path);
    }
    fs.writeFileSync(backupMarker,JSON.stringify({backup:dir,appliedAt:new Date().toISOString()},null,2),{flag:'wx'});
  } catch (error) {
    for (const e of applied.reverse()) {
      if (e.before) fs.writeFileSync(e.dest,e.before);
      else if (fs.existsSync(e.dest)) fs.unlinkSync(e.dest);
    }
    stop('PATCH_ROLLED_BACK '+String(error));
  }
} catch (error) { stop('BACKUP_OR_PATCH_FAILED '+String(error)); }
console.log('[FocusForegroundV2] APPLY_PASS. No database changes; no environment changes.');
console.log('[FocusForegroundV2] Run npm run typecheck, npm run build, and Focus regression tests.');
