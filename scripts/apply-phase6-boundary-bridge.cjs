#!/usr/bin/env node
"use strict";
// Guarded installer: no typescript files are bundled outside their canonical
// paths, so tsc doesn't scan duplicate source directories from the ZIP.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "..");
const PAYLOAD = JSON.parse(fs.readFileSync(path.join(__dirname, "phase6-boundary-payload.json"), "utf8"));
const BACKUP = path.join(ROOT, ".phase6-boundary-bridge-backup");
const manifestPath = path.join(BACKUP, "manifest.json");
const args = process.argv.slice(2);
const applying = args.includes("--apply");
const rollingBack = args.includes("--rollback");
if (applying && rollingBack) throw new Error("Choose either --apply or --rollback.");
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function read(rel) { const abs=path.join(ROOT,rel);return fs.existsSync(abs) ? fs.readFileSync(abs,"utf8") : null; }
function atomicWrite(rel, data) {
  const out=path.join(ROOT,rel);
  fs.mkdirSync(path.dirname(out),{recursive:true});
  const tmp=out+".phase6-tmp";fs.writeFileSync(tmp,data);fs.renameSync(tmp,out);
}
function buildDesired() {
 const serverOriginal=read("server.ts");if(serverOriginal===null)throw new Error("Missing server.ts; start in the project root.");
 let text=serverOriginal;
 for (const patch of PAYLOAD.serverPatches) {
   if(text.includes(patch.to)) continue;
   const occurrences=text.split(patch.from).length-1;
   if(occurrences!==1)throw Error("BASELINE_CHANGED: the server.ts routing anchor changed. Don't force a patch; merge manually with the current code.");
   text=text.replace(patch.from,patch.to);
 }
 const desired={"server.ts":text,...PAYLOAD.newFiles};
 const originals={"server.ts":serverOriginal};
 for(const rel of Object.keys(PAYLOAD.newFiles)) originals[rel]=read(rel);
 const actions={};
 for(const [rel,value] of Object.entries(desired)) {
   const existing=originals[rel];
   if(existing===value)actions[rel]="ALREADY";
   else if(existing===null || rel==="server.ts")actions[rel]="NEW";
   else throw Error(`BASELINE_CHANGED: ${rel} already exists and differs; refusing to overwrite.`);
 }
 return {desired,originals,actions};
}
function rollback() {
 if(!fs.existsSync(manifestPath))throw Error("No backup manifest for rollback.");
 const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
 for(const [rel,value] of Object.entries(manifest.files)) {
   const current=read(rel);
   if(current!==null && hash(current)!==manifest.afterHashes[rel])throw Error(`ROLLBACK_REFUSED: ${rel} changed since apply. Don't overwrite edits.`);
 }
 for(const [rel,value] of Object.entries(manifest.files)) {
   if(value===null) {if(fs.existsSync(path.join(ROOT,rel))) fs.unlinkSync(path.join(ROOT,rel));}
   else atomicWrite(rel,value);
 }
 console.log("[Phase6 Bridge] ROLLBACK_PASS: original files restored.");
}
function main() {
 if(rollingBack)return rollback();
 const {desired,originals,actions}=buildDesired();
 const changed=Object.entries(actions).filter(([,v])=>v!=="ALREADY").map(([k])=>k);
 if(!applying) {
  console.log(`[Phase6 Bridge] CHECK_PASS; ${changed.length} files to update: ${changed.join(", ") || "none"}`);
  console.log("[Phase6 Bridge] No writes; use --apply after a git checkpoint.");return;
 }
 if(changed.length===0){console.log("[Phase6 Bridge] ALREADY_PATCHED; no writes.");return;}
 if(fs.existsSync(manifestPath))throw Error("Backup manifest already exists. Resolve/revert previous application before another apply.");
 fs.mkdirSync(BACKUP,{recursive:true});
 const manifest={files:Object.fromEntries(changed.map(k=>[k,originals[k]])),afterHashes:Object.fromEntries(changed.map(k=>[k,hash(desired[k])])),createdAt:new Date().toISOString()};
 fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
 for(const rel of changed){atomicWrite(rel,desired[rel]);console.log(`[Phase6 Bridge] PATCHED ${rel}`);}
 console.log("[Phase6 Bridge] APPLY_PASS; no database writes, no environment changes.");
}
try{main();}catch(e){console.error("[Phase6 Bridge] STOP:",e instanceof Error?e.message:String(e));process.exitCode=2;}
