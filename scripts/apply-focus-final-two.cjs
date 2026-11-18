"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname,"..");
const payloadFile = path.join(root,"focus-final-two.payload.json");
const backupRoot = path.resolve(root,"..",`focus-last-two-backup-${path.basename(root)}`);
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const allowed = (rel) => {
  if (!/^(src\/features\/focus\/|tests\/focus-solo-background-resume\.test\.ts$)/.test(rel) || rel.includes("..") || path.isAbsolute(rel)) throw new Error(`UNSAFE_PATH ${rel}`);
  const resolved = path.resolve(root,rel);
  if (!resolved.startsWith(root+path.sep)) throw new Error(`OUTSIDE_PROJECT ${rel}`);
  return resolved;
};
function run() {
  const action = process.argv.includes("--apply") ? "APPLY" : process.argv.includes("--rollback") ? "ROLLBACK" : "CHECK_ONLY";
  if (process.argv.includes("--apply") && process.argv.includes("--rollback")) throw new Error("Choose one action.");
  const data = JSON.parse(fs.readFileSync(payloadFile,"utf8"));
  if (data.formatVersion !== 1) throw new Error("Invalid payload version.");
  const entries = Object.entries(data.files).map(([rel,descriptor])=>{
    const dest=allowed(rel), existing=fs.existsSync(dest)?fs.readFileSync(dest):null;
    const patched=Buffer.from(descriptor.base64,"base64");
    if (sha(patched)!==descriptor.patchedSha256) throw new Error(`PAYLOAD_HASH_MISMATCH ${rel}`);
    const state=existing && sha(existing)===descriptor.patchedSha256 ? "PATCHED"
      : (descriptor.baselineSha256===null ? existing===null : existing!==null && sha(existing)===descriptor.baselineSha256)
        ? "BASELINE" : "MISMATCH";
    return {rel,dest,descriptor,patched,existing,state};
  });
  console.log(`[FocusFinal2] ${action}: ${entries.map((e)=>e.state).join(", ")}`);
  for (const entry of entries) console.log(`  ${entry.state} ${entry.rel}`);
  if (entries.some(e=>e.state==="MISMATCH")) throw new Error("BASELINE_CHANGED: no files written. Do NOT force an overwrite.");
  if (action==="CHECK_ONLY") { console.log("[FocusFinal2] CHECK_PASS. No files changed."); return; }
  if (action==="APPLY") {
    for (const entry of entries) {
      if (entry.state==="PATCHED") continue;
      if (entry.existing) {
        const backup=path.join(backupRoot,entry.rel);
        fs.mkdirSync(path.dirname(backup),{recursive:true});
        if (fs.existsSync(backup)) {
          if (sha(fs.readFileSync(backup))!==entry.descriptor.baselineSha256) throw new Error(`BACKUP_CHANGED ${entry.rel}`);
        } else fs.writeFileSync(backup,entry.existing);
      }
      fs.mkdirSync(path.dirname(entry.dest),{recursive:true});
      fs.writeFileSync(entry.dest,entry.patched);
      console.log(`[FocusFinal2] PATCHED ${entry.rel}`);
    }
    console.log(`[FocusFinal2] APPLY_COMPLETE. Backups outside project: ${backupRoot}`);
    return;
  }
  if (action==="ROLLBACK") {
    for (const entry of entries) {
      if (entry.state==="BASELINE") continue;
      if (entry.descriptor.baselineSha256===null) {
        fs.unlinkSync(entry.dest);
      } else {
        const backup=path.join(backupRoot,entry.rel);
        if (!fs.existsSync(backup) || sha(fs.readFileSync(backup))!==entry.descriptor.baselineSha256) throw new Error(`BACKUP_NOT_AVAILABLE ${entry.rel}`);
        fs.copyFileSync(backup,entry.dest);
      }
      console.log(`[FocusFinal2] RESTORED ${entry.rel}`);
    }
    console.log("[FocusFinal2] ROLLBACK_COMPLETE");
  }
}
try {run();}catch(error){console.error(`[FocusFinal2] FAILED: ${error.message}`);process.exitCode=1;}
