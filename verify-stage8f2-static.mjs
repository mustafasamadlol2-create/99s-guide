import fs from "node:fs";

const server = fs.readFileSync("server.ts", "utf8");
const userService = fs.readFileSync("server/services/userService.ts", "utf8");

const checks = [
  ["profile bundle master flag", userService.includes("PRIVATE_D1_PROFILE_BUNDLE_READS_ENABLED")],
  ["points read flag", userService.includes("PRIVATE_D1_POINTS_READS_ENABLED")],
  ["roster read flag", userService.includes("PRIVATE_D1_ROSTER_READS_ENABLED")],
  ["blocks read flag", server.includes("PRIVATE_D1_BLOCKS_READS_ENABLED")],
  ["sync forced canonical Supabase response", server.includes("forceSupabaseState: true")],
  ["auth/session authority not moved", !server.includes("PRIVATE_D1_AUTH_READS_ENABLED")],
  ["Supabase fallbacks present", userService.includes("logPrivateReadFallback") && server.includes("logPrivateReadFallback")],
];

let pass = true;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) pass = false;
}
console.log("");
console.log(pass ? "STAGE 8F-2 STATIC CHECK PASS" : "STAGE 8F-2 STATIC CHECK FAIL");
process.exitCode = pass ? 0 : 1;
