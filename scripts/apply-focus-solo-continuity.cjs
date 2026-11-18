#!/usr/bin/env node
/** Guarded, checksum-pinned patch installer. Run from the repository root. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = process.cwd();
const payload = path.join(root, 'focus-solo-continuity-patch');
const manifestPath = path.join(payload, 'manifest.json');
const backupRoot = path.join(root, '.focus-solo-continuity-backup');
const args = new Set(process.argv.slice(2));
if (args.size > 1 || [...args].some((x) => !['--apply','--rollback'].includes(x))) {
  console.error('Usage: node scripts/apply-focus-solo-continuity.cjs [--apply | --rollback]');
  process.exit(2);
}
const mode = args.has('--apply') ? 'APPLY' : args.has('--rollback') ? 'ROLLBACK' : 'CHECK_ONLY';
if (!fs.existsSync(manifestPath)) {
  console.error('[SoloFix] Patch payload missing. Extract the entire ZIP at the project root.');
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
  console.error('[SoloFix] Invalid manifest');process.exit(2);
}
function hash(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function fileHash(name) {return fs.existsSync(name) ? hash(fs.readFileSync(name)) : null;}
const changes = [];
const invalid = [];
for (const entry of manifest.files) {
  const rel = entry.path;
  if (typeof rel !== 'string' || !/^(?:src|server|tests)\/[A-Za-z0-9/_.-]+\.(?:ts|tsx)$/.test(rel) || rel.includes('..')) {
    console.error('[SoloFix] Unsafe manifest path');process.exit(2);
  }
  const target=path.join(root,...rel.split('/'));
  const source=path.join(payload,'files',...rel.split('/'));
  const backup=path.join(backupRoot,...rel.split('/'));
  const actual=fileHash(target);
  if(fileHash(source)!==entry.updatedSha256){invalid.push(rel+': PATCH_PAYLOAD_INVALID');continue;}
  const current=actual===entry.updatedSha256?'ALREADY_PATCHED':actual===entry.expectedSha256?'READY':'BASELINE_CHANGED';
  if(mode!=='ROLLBACK' && current==='BASELINE_CHANGED')invalid.push(rel+': '+current);
  if(mode==='ROLLBACK'){
    const restored=entry.expectedSha256;
    if(current==='ALREADY_PATCHED' && (restored===null ? fs.existsSync(backup):fileHash(backup)!==restored)) invalid.push(rel+': BACKUP_MISSING_OR_CHANGED');
    if(current==='BASELINE_CHANGED')invalid.push(rel+': MODIFIED_AFTER_PATCH');
  }
  changes.push({rel,target,source,backup,current,entry});
}
console.log(`[SoloFix] ${mode}: files=${changes.length}; ready=${changes.filter(x=>x.current==='READY').length}; already=${changes.filter(x=>x.current==='ALREADY_PATCHED').length}`);
if(invalid.length){for(const problem of invalid)console.error('  '+problem);console.error('[SoloFix] ABORTED without writing anything. Keep the existing files and share the latest project version.');process.exit(1)}
if(mode==='CHECK_ONLY'){console.log('[SoloFix] CHECK_PASS. No files changed. Back up your project before --apply.');process.exit(0)}
function atomicCopy(source,target){
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary=target+'.solo-fix-'+process.pid+'.tmp';
  try {fs.copyFileSync(source,temporary);fs.renameSync(temporary,target)}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
}
if(mode==='ROLLBACK'){
  for(const change of changes.filter(x=>x.current==='ALREADY_PATCHED')){
    if(change.entry.expectedSha256===null)fs.unlinkSync(change.target);
    else atomicCopy(change.backup,change.target);
    console.log('[SoloFix] RESTORED:',change.rel);
  }
  console.log('[SoloFix] ROLLBACK_COMPLETE');process.exit(0);
}
const prepared=[];
try{
  for(const change of changes.filter(x=>x.current==='READY')){
    if(change.entry.expectedSha256!==null){
      if(!fs.existsSync(change.backup)){
        fs.mkdirSync(path.dirname(change.backup),{recursive:true});
        fs.copyFileSync(change.target,change.backup);
      }
      if(fileHash(change.backup)!==change.entry.expectedSha256)throw new Error('Existing backup mismatched: '+change.rel);
    }
  }
  for(const change of changes.filter(x=>x.current==='READY')){
    atomicCopy(change.source,change.target);
    prepared.push(change);
    console.log('[SoloFix] PATCHED:',change.rel);
  }
}catch(error){
  console.error('[SoloFix] Failed:',String(error));
  for(const change of prepared.reverse()){
    try{
      if(change.entry.expectedSha256===null)fs.unlinkSync(change.target);
      else atomicCopy(change.backup,change.target);
    }catch(restoreError){console.error('[SoloFix] MANUAL_RESTORE_REQUIRED',change.rel,String(restoreError))}
  }
  process.exit(1);
}
console.log('[SoloFix] PATCH_COMPLETE. Existing originals in .focus-solo-continuity-backup/.');
console.log('[SoloFix] Keep Focus/Gamification D1 CUTOVER disabled. Run typecheck, build and the focused tests before staging deployment.');
