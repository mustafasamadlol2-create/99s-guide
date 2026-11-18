#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const payloadPath = path.join(root, 'focus-solo-race-guard.payload.json');
const pointerPath = path.join(root, '.focus-solo-race-guard-backup.json');
function fail(message) { console.error('[SoloRace] STOP: '+message); process.exit(1); }
function sha(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function underRoot(rel) {
  if (typeof rel !== 'string' || !/^(server|src|tests)\//.test(rel) ||
      !/^[A-Za-z0-9_./-]+$/.test(rel) || rel.split('/').includes('..')) fail('Unsafe payload path');
  const out = path.resolve(root, ...rel.split('/'));
  if (!out.startsWith(root+path.sep)) fail('Path leaves project');
  return out;
}
const arg = process.argv.slice(2);
if (arg.some(x => !['--apply','--rollback'].includes(x)) || arg.length>1) fail('Usage: node scripts/apply-solo-focus-race-guard.cjs [--apply | --rollback]');
if (arg.includes('--rollback')) {
  if (!fs.existsSync(pointerPath)) fail('No backup pointer. Nothing to rollback.');
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
  const backup = path.resolve(pointer.backup);
  if (!backup.startsWith(path.dirname(root)+path.sep) || !fs.existsSync(path.join(backup,'manifest.json'))) fail('Backup location is not valid');
  const entries = JSON.parse(fs.readFileSync(path.join(backup,'manifest.json'),'utf8'));
  for (const e of entries) {
    const target=underRoot(e.path);
    if (!fs.existsSync(target) || sha(fs.readFileSync(target))!==e.after) fail('Local edits detected; rollback refused: '+e.path);
    if (!fs.existsSync(path.join(backup,...e.path.split('/'))) || sha(fs.readFileSync(path.join(backup,...e.path.split('/'))))!==e.before) fail('Backup corruption: '+e.path);
  }
  for (const e of entries) fs.copyFileSync(path.join(backup,...e.path.split('/')),underRoot(e.path));
  fs.unlinkSync(pointerPath);
  console.log(`[SoloRace] ROLLBACK_OK restored ${entries.length} original files. Backup retained at ${backup}`);
  process.exit(0);
}
if (!fs.existsSync(payloadPath)) fail('Missing focus-solo-race-guard.payload.json in project root.');
const data=JSON.parse(fs.readFileSync(payloadPath,'utf8'));
if (data.format !== 1 || !Array.isArray(data.files) || data.files.length !== 10) fail('Unexpected payload format');
const entries=[];
for (const entry of data.files) {
  const target=underRoot(entry.path);
  if (!fs.existsSync(target)) fail('Required project file not found: '+entry.path);
  const before=fs.readFileSync(target);
  const contents=Buffer.from(entry.data,'base64');
  if (sha(contents)!==entry.after) fail('Package failed integrity check: '+entry.path);
  const actual=sha(before);
  if (actual!==entry.before && actual!==entry.after) fail('BASELINE_CHANGED: '+entry.path+'. Do not force overwrite; send updated files for merge.');
  entries.push({...entry,target,contents,actual,previous:before});
}
const changed=entries.filter(e=>e.actual===e.before);
console.log(`[SoloRace] ${arg.includes('--apply')?'APPLY':'CHECK_ONLY'} CHECK_PASS total=${entries.length} ready=${changed.length} already=${entries.length-changed.length}`);
for (const e of changed) console.log('  '+e.path);
if (!arg.includes('--apply')) {console.log('[SoloRace] NO_WRITES. Create a Git checkpoint before --apply.'); process.exit(0);}
if (!changed.length) {console.log('[SoloRace] Already applied. No file changes.');process.exit(0);}
if (changed.length !== entries.length) fail('Partly applied. Restore the original project or request a merge before applying.');
if (fs.existsSync(pointerPath)) fail('Existing repair backup pointer found; rollback before applying again.');
const dir = path.resolve(root, '..', '99s-guide-focus-race-backup-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(dir,{recursive:true});
try {
  for (const e of entries) {const dest=path.join(dir,...e.path.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,e.previous,{flag:'wx'});}
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(entries.map(e=>({path:e.path,before:e.before,after:e.after})),null,2),{flag:'wx'});
  const written=[];
  try {
    for (const e of entries) {fs.writeFileSync(e.target,e.contents);written.push(e);console.log('[SoloRace] PATCHED '+e.path);}
    fs.writeFileSync(pointerPath, JSON.stringify({backup:dir,appliedAt:new Date().toISOString()},null,2),{flag:'wx'});
  } catch (error) {
    for (const e of written) fs.writeFileSync(e.target,e.previous);
    fail('File write failed; originals restored: '+String(error));
  }
} catch (error) {fail('Backup/apply failed: '+String(error));}
console.log(`[SoloRace] APPLY_OK files=${entries.length}; backups stored outside project: ${dir}`);
console.log('[SoloRace] Run typecheck, build, focused tests; deploy Backend BEFORE Frontend to staging.');
