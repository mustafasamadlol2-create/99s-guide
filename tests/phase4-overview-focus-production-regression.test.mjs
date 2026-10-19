import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const balanceSource = await readFile(
  new URL("../server/features/study-points/balanceProjection.ts", import.meta.url),
  "utf8",
);
const serverSource = await readFile(
  new URL("../server.ts", import.meta.url),
  "utf8",
);
const focusApiSource = await readFile(
  new URL("../src/features/focus/api/focusApi.ts", import.meta.url),
  "utf8",
);

test("canonical Study Points raw-SQL rows read the direct amount alias", () => {
  assert.match(balanceSource, /Array<\{ category: string; amount: string \}>/);
  assert.match(balanceSource, /AS amount/);
  assert.match(balanceSource, /safeStudyPointsAggregate\(group\.amount\)/);
  assert.doesNotMatch(balanceSource, /safeStudyPointsAggregate\(group\._sum\.amount\)/);
});

test("production CORS allows the Focus mutation client header", () => {
  assert.match(focusApiSource, /"X-Focus-Client-ID"/);
  assert.match(serverSource, /allowedHeaders:\s*\[[\s\S]*?"X-Focus-Client-ID"[\s\S]*?\]/);
});

test("Focus plan creation still uses the stable core contract", () => {
  assert.match(
    focusApiSource,
    /createFocusPlan:[\s\S]*?planBody\(input, false, false\)/,
  );
});
