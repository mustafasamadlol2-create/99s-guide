import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../server/features/leaderboard/cacheReads.ts", import.meta.url), "utf8");

test("leaderboard D1 reads reject a snapshot older than canonical Points V2 ledger writes", () => {
  assert.match(source, /createdAt:\s*\{\s*gt:\s*snapshot\.generatedAt\s*\}/u);
  assert.match(source, /Canonical Points V2 ledger is newer than the cached leaderboard snapshot\./u);
});
