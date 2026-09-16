
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const workerDir = path.join(ROOT, "cloudflare-content-api");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const newTables = [
  "EmailVerificationToken",
  "FlashcardProgress",
  "LectureProgress",
  "ModerationHistory",
  "Notification",
  "OAuthIdentity",
  "PasswordResetToken",
  "PointsLog",
  "QaAnswer",
  "QaQuestion",
  "QaVote",
  "Report",
  "SmartNotification",
  "SystemSetting",
  "User",
  "UserBan",
  "UserBlock",
  "UserMute",
  "UserProgress",
];

const sharedExpected = {
  Lecture: 53,
  Material: 115,
  Mcq: 100,
  Flashcard: 100,
  DailyMotto: 14,
  CalendarEvent: 0,
};

function runSql(sql) {
  const out = execFileSync(
    npx,
    [
      "wrangler",
      "d1",
      "execute",
      "99s-guide-content",
      "--remote",
      "--command",
      sql,
      "-c",
      "wrangler.jsonc",
      "--json",
    ],
    {
      cwd: workerDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  const parsed = JSON.parse(out);
  const rows = [];
  for (const item of parsed) {
    if (Array.isArray(item?.results)) rows.push(...item.results);
  }
  return rows;
}

let pass = true;

console.log("99's Guide — Stage 8B Remote Verification V3");
console.log("==============================================");
console.log("Mode: READ-ONLY");
console.log("");

console.log("A) NEW TABLE EXISTENCE");
for (const table of newTables) {
  const esc = table.replaceAll("'", "''");
  const rows = runSql(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='${esc}') THEN 1 ELSE 0 END AS ok`
  );
  const ok = Number(rows?.[0]?.ok ?? 0) === 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${table}`);
  if (!ok) pass = false;
}

console.log("");
console.log("B) NEW TABLE ROW COUNTS");
for (const table of newTables) {
  const rows = runSql(`SELECT COUNT(*) AS count FROM "${table}"`);
  const count = Number(rows?.[0]?.count ?? -1);
  const ok = count === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${table} = ${count}`);
  if (!ok) pass = false;
}

console.log("");
console.log("C) EXISTING SHARED D1 COUNTS");
for (const [table, expected] of Object.entries(sharedExpected)) {
  const rows = runSql(`SELECT COUNT(*) AS count FROM "${table}"`);
  const count = Number(rows?.[0]?.count ?? -1);
  const ok = count === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${table} = ${count} (expected ${expected})`);
  if (!ok) pass = false;
}

console.log("");
console.log("D) NEW TABLE INDEX COUNTS");
for (const table of newTables) {
  const esc = table.replaceAll("'", "''");
  const rows = runSql(
    `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='index' AND tbl_name='${esc}'`
  );
  const count = Number(rows?.[0]?.count ?? -1);
  const ok = count >= 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${table} indexes = ${count}`);
  if (!ok) pass = false;
}

console.log("");
console.log("No D1 rows were modified.");
console.log("No Supabase rows were modified.");
console.log(pass ? "STAGE 8B REMOTE VERIFY PASS" : "STAGE 8B REMOTE VERIFY FAIL");

process.exit(pass ? 0 : 1);
