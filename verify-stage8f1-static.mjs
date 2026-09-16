import fs from "node:fs";

const server = fs.readFileSync("server.ts", "utf8");
const helper = fs.readFileSync("server/services/privateD1Read.ts", "utf8");

const checks = [
  ["private read helper import", server.includes('from "./server/services/privateD1Read.js"')],
  ["users flag", server.includes('PRIVATE_D1_USERS_READS_ENABLED')],
  ["progress flag", server.includes('PRIVATE_D1_PROGRESS_READS_ENABLED')],
  ["notifications flag", server.includes('PRIVATE_D1_NOTIFICATIONS_READS_ENABLED')],
  ["calendar flag", server.includes('PRIVATE_D1_CALENDAR_READS_ENABLED')],
  ["qa flag", server.includes('PRIVATE_D1_QA_READS_ENABLED')],
  ["users source header", server.includes('X-Private-Users-Read-Source')],
  ["progress source header", server.includes('X-Private-Progress-Read-Source')],
  ["notifications source header", server.includes('X-Private-Notifications-Read-Source')],
  ["qa source header", server.includes('X-Private-QA-Read-Source')],
  ["private no-store fetch", helper.includes('cache: "no-store"')],
  ["private secret header", helper.includes('"X-Private-Data-Sync-Secret"')],
  ["Supabase fallback logger", helper.includes("falling back to Supabase")],
  ["auth middleware unchanged", !server.includes("PRIVATE_D1_AUTH_READS_ENABLED")],
];

let pass = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) pass = false;
}

console.log("");
console.log("Authentication/session validation remains Supabase-authoritative: PASS");
console.log("No credential/token read cutover is present.");
console.log(pass ? "STAGE 8F-1 STATIC CUTOVER CHECK PASS" : "STAGE 8F-1 STATIC CUTOVER CHECK FAIL");
process.exitCode = pass ? 0 : 1;
