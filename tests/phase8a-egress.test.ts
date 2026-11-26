import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { readLegacyPdf } from "../server/services/legacyPdfRead.ts";
import { readSessionAuthorization } from "../server/services/sessionAuthorization.ts";
import { getRevokedSessionKey, SESSION_LIFETIME_SECONDS } from "../server/services/sessionRevocation.ts";

const storedPdf = Buffer.alloc(4 * 1024 * 1024);
storedPdf.write("%PDF-1.7");
const createdAt = new Date("2026-01-01T12:00:00Z");
const etag = `W/"${storedPdf.length}-${createdAt.getTime()}"`;

function pdfDatabase(options: { bytes?: Buffer | null; type?: string; storagePath?: string; localUrl?: string; exists?: boolean } = {}) {
  const bytes = options.bytes === undefined ? storedPdf : options.bytes;
  const reads: Array<{ sql: string; values: unknown[]; returnedBlobBytes: number }> = [];
  const database = {
    async $transaction<T>(read: (tx: Prisma.TransactionClient) => Promise<T>, transactionOptions: unknown) {
      assert.equal((transactionOptions as { isolationLevel: string }).isolationLevel, "RepeatableRead");
      const tx = {
        async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
          const sql = parts.join("?");
          const record = { sql, values, returnedBlobBytes: 0 };
          reads.push(record);
          if (reads.length === 1) {
            assert.match(sql, /octet_length\("fileData"\) AS "byteLength"/);
            assert.match(sql, /substring\("fileData" FROM 1 FOR 5\) = decode/);
            assert.deepEqual(values, ["material-1"]);
            return options.exists === false ? [] : [{
              type: options.type ?? "PDF",
              title: "Sample PDF",
              storagePath: options.storagePath ?? null,
              fileUrlOrLink: options.localUrl ?? "",
              createdAt,
              byteLength: bytes?.length ?? null,
              validSignature: bytes?.subarray(0, 5).equals(Buffer.from("%PDF-")) ?? null,
            }];
          }
          assert.match(sql, /substring\("fileData" FROM \?::int FOR \?::int\) AS "bytes"/);
          const [oneBasedStart, length, id] = values;
          assert.equal(id, "material-1");
          const result = bytes!.subarray(Number(oneBasedStart) - 1, Number(oneBasedStart) - 1 + Number(length));
          record.returnedBlobBytes = result.length;
          return [{ bytes: result }];
        },
      } as unknown as Prisma.TransactionClient;
      return read(tx);
    },
  } as unknown as Pick<PrismaClient, "$transaction">;
  return { database, reads };
}

test("legacy PDF fallback returns only the requested body range and keeps blob precedence", async () => {
  const { database, reads } = pdfDatabase({ type: "note", storagePath: "other-object.pdf" });
  const result = await readLegacyPdf(database, "material-1", { range: "bytes=1024-66559" });
  assert.equal(result.kind, "pdf");
  assert.deepEqual(result.range, { start: 1024, end: 66559 });
  assert.equal(result.etag, etag);
  assert.equal(result.total, storedPdf.length);
  assert.equal(result.length, 65_536);
  assert.deepEqual(result.body, storedPdf.subarray(1024, 66560));
  assert.deepEqual(reads.map(({ returnedBlobBytes }) => returnedBlobBytes), [0, 65_536]);
});

test("legacy PDF fallback keeps full, suffix, open-ended and clipped downloads", async () => {
  const total = storedPdf.length;
  const inputs = [
    { range: undefined, start: 0, length: total },
    { range: "bytes=-9", start: total - 9, length: 9 },
    { range: `bytes=${total - 5}-`, start: total - 5, length: 5 },
    { range: `bytes=${total - 2}-${total + 500}`, start: total - 2, length: 2 },
  ];
  for (const { range, start, length } of inputs) {
    const { database, reads } = pdfDatabase();
    const result = await readLegacyPdf(database, "material-1", { range });
    assert.equal(result.kind, "pdf");
    assert.deepEqual(result.range, range ? { start, end: start + length - 1 } : undefined);
    assert.deepEqual(result.body, storedPdf.subarray(start, start + length));
    assert.equal(reads[1].returnedBlobBytes, length);
  }
});

test("legacy PDF metadata-only outcomes never retrieve file bytes", async () => {
  const cases = [
    { metadata: { exists: false }, request: {}, kind: "notFound" },
    { metadata: { type: "VIDEO" }, request: {}, kind: "notFound" },
    { metadata: { bytes: null, storagePath: "test/object" }, request: {}, kind: "r2" },
    { metadata: { bytes: null, localUrl: "/uploads/materials/test.pdf" }, request: {}, kind: "local" },
    { metadata: { bytes: Buffer.alloc(0) }, request: {}, kind: "invalidPdf" },
    { metadata: { bytes: Buffer.from("not a PDF") }, request: {}, kind: "invalidPdf" },
    { metadata: {}, request: { ifNoneMatch: etag, range: "invalid" }, kind: "notModified" },
    { metadata: {}, request: { range: "bytes=1-0" }, kind: "invalidRange" },
    { metadata: {}, request: { range: "bytes=0-1,4-5" }, kind: "invalidRange" },
    { metadata: {}, request: { range: `bytes=${storedPdf.length}-` }, kind: "invalidRange" },
    { metadata: {}, request: { headOnly: true, range: "bytes=0-1" }, kind: "pdf" },
    { metadata: {}, request: { headOnly: true }, kind: "pdf" },
  ];
  for (const { metadata, request, kind } of cases) {
    const { database, reads } = pdfDatabase(metadata);
    const result = await readLegacyPdf(database, "material-1", request);
    assert.equal(result.kind, kind);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].returnedBlobBytes, 0);
    if (result.kind === "pdf") assert.equal(result.body, undefined);
  }
});

const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

function route(start: string, end: string): string {
  const startIndex = server.indexOf(start);
  const endIndex = server.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return server.slice(startIndex, endIndex);
}

test("HTTP file wiring keeps authorization, strict D1/R2 and local safeguards", () => {
  const pdf = route('app.get("/api/materials/pdf/:id"', 'app.post("/api/mcqs"');
  assert.match(pdf, /requirePdfUser, pdfLimiter/);
  assert.match(pdf, /filesR2Phase2CutoverEnabled\(\)[\s\S]*?createSupabaseSignedUrl\(material\.storagePath, 300\)[\s\S]*?return res\.redirect\(302, signedUrl\)/);
  assert.match(pdf, /readLegacyPdf\(getPrisma\(\), idToFind,/);
  assert.match(pdf, /pdf\.kind === "r2"[\s\S]*?createSupabaseSignedUrl\(pdf\.storagePath, 300\)/);
  assert.match(pdf, /parsed\.origin !== requestOrigin/);
  assert.match(pdf, /!redirectTarget\.startsWith\("\/uploads\/"\)/);
  assert.match(pdf, /res\.status\(416\)[\s\S]*?res\.status\(206\)[\s\S]*?res\.end\(pdf\.body\)/);
  assert.match(pdf, /'Cache-Control', 'private, no-store'/);
});

test("file cleanup and progress lookups select only the fields that their callers need", () => {
  const deletes = route('app.delete("/api/lectures/:id"', '"/api/materials/uploads/multipart/');
  assert.match(deletes, /material\.findMany\(\{\s*where: \{ lectureId \},\s*select: \{ fileUrlOrLink: true, storagePath: true \}/);
  assert.match(deletes, /material\.findUnique\(\{\s*where: \{ id: materialId \},\s*select: \{ fileUrlOrLink: true, storagePath: true \}/);
  assert.match(deletes, /material\.delete\(\{ where: \{ id: materialId \}, select: \{ id: true \} \}\)/);
  assert.match(deletes, /syncContentDelete\("Lecture", lectureId\)/);
  assert.match(deletes, /syncContentDelete\("Material", materialId\)/);
  assert.equal([...server.matchAll(/const materialExists = await client\.material\.findUnique\(\{ where: \{ id: materialId \}, select: \{ id: true \} \}\)/g)].length, 2);
});

test("academic bootstrap retains full offline packs and strict D1/account-group boundaries", () => {
  const materials = route('app.get("/api/materials",', 'app.get("/api/search",');
  assert.match(materials, /contentD1MaterialsReadsEnabled\(\)[\s\S]*?contentD1Phase1CutoverEnabled\(\)[\s\S]*?return sendStrictContentReadFailure/);
  assert.match(materials, /eventVisibleToGroup\(event\.targetGroups, currentUserGroup\)/);
  const mcqQuery = /needsOfflineStudyData \? prismaClient\.mcq\.findMany\(\{([\s\S]*?)\}\) : Promise\.resolve/.exec(materials)?.[1];
  assert.ok(mcqQuery);
  assert.match(mcqQuery, /take: 2000/);
  for (const field of ["question", "optionA", "optionB", "optionC", "optionD", "hint", "explanation", "lectureId"]) {
    assert.match(mcqQuery, new RegExp(`\\b${field}: true`));
  }
  assert.doesNotMatch(mcqQuery, /correctAnswer/);
  assert.match(materials, /needsOfflineStudyData \? prismaClient\.flashcard\.findMany\(\{ take: 2000 \}\)/);
  assert.match(materials, /const \{ correctAnswer: _omit, \.\.\.rest \} = m/);
  assert.match(app, /academicUserId = currentUser\?\.id[\s\S]*?academicStudentGroup = currentUser\?\.studentGroup[\s\S]*?!academicUserId \|\| !isActive \|\| !isOnline[\s\S]*?fetchAndStoreAcademicMaterials\(academicUserId, academicStudentGroup, controller\.signal\)[\s\S]*?controller\.abort\(\)[\s\S]*?\[academicUserId, academicStudentGroup, isActive, isOnline\]/);
});

test("account bootstrap skips identity data only after the existing session and account checks", () => {
  const me = route('app.get("/api/auth/me"', 'app.get("/api/auth/verify-email"');
  assert.match(me, /jwt\.verify[\s\S]*?decoded\.scope === PDF_DOWNLOAD_SCOPE[\s\S]*?getSessionAuthorization\(decoded\.userId, token\)[\s\S]*?revokedUntil \|\| !account \|\| \(decoded\.sessionVersion \?\? 0\) !== account\.sessionVersion[\s\S]*?!account\.emailVerified \|\| ban[\s\S]*?getAuthenticatedUser\(account\)/);
  assert.match(me, /!user\.profileEmail && \(\s*phase3UserReadCutoverEnabled\(\)\s*\? user\.hasAppleIdentity === true\s*: !!\(await getPrisma\(\)\.oAuthIdentity\.findFirst\(\{\s*where: \{ provider: "apple", userId: user\.id \},\s*select: \{ id: true \}/);
  assert.match(me, /res\.json\(\{ \.\.\.fullData, token, needsEmailSelection \}\)/);
  assert.match(server, /systemSetting\.findUnique\(\{ where: \{ key \}, select: \{ value: true \} \}\)/);
});

const activeAccount = {
  id: "fixture-user",
  email: "fixture@example.invalid",
  sessionVersion: 1,
  role: "admin",
  accountStatus: "ACTIVE",
  emailVerified: true,
  studentGroup: "A",
  isPrimaryOwner: false,
  banReason: null as string | null,
  banIsPermanent: null as boolean | null,
  banEndTime: null as Date | null,
  revocationValue: null as string | null,
};

function authorizationDatabase() {
  let row = { ...activeAccount };
  let unavailable = false;
  const args: unknown[][] = [];
  const database = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      const statement = parts.join("?");
      assert.match(statement, /LEFT JOIN "User" AS "u"[\s\S]*?LEFT JOIN "UserBan" AS "b"[\s\S]*?LEFT JOIN "SystemSetting" AS "r"/);
      assert.doesNotMatch(statement, /avatar|password|SELECT \*/i);
      args.push(values);
      if (unavailable) throw new Error("Fixture PostgreSQL unavailable");
      return [row];
    },
  } as unknown as Pick<PrismaClient, "$queryRaw">;
  return {
    database,
    args,
    update: (fields: Partial<typeof activeAccount>) => { row = { ...row, ...fields }; },
    disconnect: () => { unavailable = true; },
  };
}

test("each protected request sees canonical changes before loading a cached profile", async () => {
  const { database, args, update } = authorizationDatabase();
  const key = getRevokedSessionKey("fixture-test-token");
  const before = await readSessionAuthorization(database, activeAccount.id, key);
  assert.equal(before.account?.role, "admin");
  assert.equal(before.account?.sessionVersion, 1);
  assert.equal(before.ban, null);
  update({ role: "user", sessionVersion: 2, studentGroup: "B", accountStatus: "BANNED" });
  const after = await readSessionAuthorization(database, activeAccount.id, key);
  assert.equal(after.account?.role, "user");
  assert.equal(after.account?.sessionVersion, 2);
  assert.equal(after.account?.studentGroup, "B");
  assert.deepEqual(after.ban, { reason: null, isPermanent: true, endTime: null });
  assert.deepEqual(args, [[activeAccount.id, key], [activeAccount.id, key]]);
  assert.match(server, /return \{ \.\.\.cached\.user, \.\.\.account \}/);
});

test("canonical authorization retains timed ban, expiry, revocation and fail-closed semantics", async () => {
  const { database, disconnect, update } = authorizationDatabase();
  const userId = activeAccount.id;
  const key = getRevokedSessionKey("other-fixture-token");
  const endTime = new Date(Date.now() + 60_000);
  update({ accountStatus: "banned", banReason: "fixture", banIsPermanent: false, banEndTime: endTime });
  assert.deepEqual((await readSessionAuthorization(database, userId, key)).ban, {
    reason: "fixture", isPermanent: false, endTime,
  });
  update({ banEndTime: new Date(0) });
  assert.equal((await readSessionAuthorization(database, userId, key)).ban, null);
  const expiry = Date.now() + 60_000;
  update({ revocationValue: JSON.stringify({ expiresAt: expiry }) });
  assert.deepEqual(await readSessionAuthorization(database, userId, key), {
    revokedUntil: expiry, account: null, ban: null,
  });
  disconnect();
  await assert.rejects(readSessionAuthorization(database, userId, key), /PostgreSQL unavailable/);
});

test("revocation cleanup retains persisted revocations for the full session lifetime", () => {
  assert.equal(SESSION_LIFETIME_SECONDS, 30 * 24 * 60 * 60);
  const cleanup = route("async function cleanupOAuthStore", "const _oauthStoreCleanup");
  assert.match(cleanup, /OAUTH_STORE_RETENTION_MS[\s\S]*?key: \{ startsWith: OAUTH_STATE_KEY_PREFIX \}[\s\S]*?key: \{ startsWith: REVOKED_SESSION_KEY_PREFIX \},[\s\S]*?updatedAt: \{ lt: new Date\(now - SESSION_LIFETIME_SECONDS \* 1000\)/);
  assert.match(server, /expiresIn: SESSION_LIFETIME_SECONDS/);
});

test("email login checks credentials without a duplicate account lookup and keeps generic denial", () => {
  const login = route('app.post("/api/auth/login"', 'app.post("/api/auth/register"');
  assert.equal([...login.matchAll(/AuthService\.authenticateUser\(cleanEmail, password\)/g)].length, 1);
  assert.doesNotMatch(login, /UserService\.findByEmail/);
  assert.match(login, /status\(401\)\.json\(\{ error: "Invalid email or password\." \}\)/);
  assert.match(login, /userBan\.findUnique\(\{\s*where: \{ userId: validatedUser\.id \},\s*select: \{ reason: true, isPermanent: true, endTime: true \}/);
});
