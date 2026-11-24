/* Phase 7.2 guarded local installer. No DB or external operations. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, 'phase7-step2.payload.json');
const BACKUP = path.join(ROOT, '.phase7-step2-backup.json');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const mode = process.argv[2] || '--check';
if (!['--check', '--apply', '--rollback'].includes(mode)) {
  console.error('[Phase7.2] usage: node scripts\\apply-phase7-step2.cjs [--apply|--rollback]');
  process.exit(2);
}
if (!fs.existsSync(MANIFEST)) {
  console.error('[Phase7.2] Missing phase7-step2.payload.json in project root.');
  process.exit(2);
}
const doc = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
if (doc.phase !== '7.2' || doc.schema !== 1 || !Array.isArray(doc.changes)) {
  console.error('[Phase7.2] Invalid payload.');
  process.exit(2);
}
function safeTarget(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || !/^([A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(relative)) throw new Error('Unsafe target path.');
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(ROOT + path.sep)) throw new Error('Unsafe target root.');
  return target;
}
function fileState(item) {
  const target = safeTarget(item.path);
  const exists = fs.existsSync(target);
  const current = exists ? fs.readFileSync(target) : null;
  const actual = current ? sha(current) : null;
  const updated = Buffer.from(item.content_b64, 'base64');
  if (sha(updated) !== item.updated_sha256) throw new Error('Corrupt payload for ' + item.path);
  const status = actual === item.updated_sha256 ? 'ALREADY'
    : actual === item.original_sha256 ? 'READY'
    : 'BASELINE_CHANGED';
  return { item, target, current, updated, status };
}
try {
  const states = doc.changes.map(fileState);
  const changed = states.filter(x=>x.status==='BASELINE_CHANGED');
  if (changed.length) {
    for (const row of changed) console.error('[Phase7.2] BASELINE_CHANGED ' + row.item.path);
    process.exitCode = 2;
  } else if (mode === '--rollback') {
    const backup = fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, 'utf8')) : null;
    if (!backup || backup.phase !== '7.2' || !Array.isArray(backup.files)) throw new Error('Backup is missing/invalid.');
    // Backups are not used to overwrite content changed by the user since install.
    if (states.some(s => s.status !== 'ALREADY')) throw new Error('Refusing rollback: installed files were modified.');
    for (const item of backup.files) {
      const target = safeTarget(item.path);
      if (item.original === null) fs.rmSync(target, {force:true});
      else fs.writeFileSync(target, Buffer.from(item.original,'base64'));
      console.log('[Phase7.2] RESTORED ' + item.path);
    }
    console.log('[Phase7.2] ROLLBACK_PASS');
  } else {
    console.log(`[Phase7.2] CHECK_PASS files=${states.length} ready=${states.filter(s=>s.status==='READY').length} already=${states.filter(s=>s.status==='ALREADY').length}`);
    if (mode === '--check') {
      console.log('[Phase7.2] NO_WRITES. Use --apply after a Git checkpoint.');
    } else {
      const todo = states.filter(s=>s.status==='READY');
      if (todo.length && fs.existsSync(BACKUP)) throw new Error('Existing Phase 7.2 backup; inspect it before applying another patch.');
      if (todo.length) {
        const originals = states.map(s=>({ path:s.item.path, original:s.current ? s.current.toString('base64') : null }));
        fs.writeFileSync(BACKUP, JSON.stringify({phase:'7.2',files:originals}));
        for (const s of todo) {
          fs.mkdirSync(path.dirname(s.target),{recursive:true});
          fs.writeFileSync(s.target,s.updated);
          console.log('[Phase7.2] PATCHED ' + s.item.path);
        }
      }
      console.log(`[Phase7.2] APPLY_PASS files=${todo.length}. No DB, migrations, or environment changes.`);
    }
  }
} catch (error) {
  console.error('[Phase7.2] FAILED ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 2;
}
