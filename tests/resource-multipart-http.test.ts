import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  MAX_RESOURCE_PDF_BYTES,
  RESOURCE_MULTIPART_PART_SIZE_BYTES,
  SMALL_RESOURCE_UPLOAD_LIMIT_BYTES,
} from "../shared/resourceMultipart.js";

process.env.NODE_ENV = "test";
process.env.DISABLE_SERVER_START = "1";
process.env.JWT_SECRET ||= "prompt31b-http-test-secret";
process.env.R2_ENDPOINT ||= "https://r2.prompt31b.test";
process.env.R2_ACCESS_KEY_ID ||= "prompt31b-http-access";
process.env.R2_SECRET_ACCESS_KEY ||= "prompt31b-http-secret";
process.env.R2_BUCKET_NAME ||= "prompt31b-http-bucket";
const httpEnabled = Boolean(process.env.PROMPT31B_HTTP_DATABASE_URL);
if (process.env.PROMPT31B_HTTP_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PROMPT31B_HTTP_DATABASE_URL;
  process.env.DIRECT_URL = process.env.PROMPT31B_HTTP_DATABASE_URL;
}
const httpTest = httpEnabled ? test : test.skip;

type UploadState = {
  id: string;
  key: string;
  parts: Map<number, { ETag: string; Size: number }>;
  completed: boolean;
  aborted: boolean;
};

const uploads = new Map<string, UploadState>();
let uploadSequence = 0;
let completeCalls = 0;
let abortCalls = 0;
let deleteCalls = 0;
let headSizeOverride: number | null = null;
let invalidPdf = false;
let abortFailure = false;

const originalSend = S3Client.prototype.send;
(S3Client.prototype as any).send = async function send(command: any) {
  const input = command.input as Record<string, unknown>;
  if (command instanceof CreateMultipartUploadCommand) {
    const id = `upload-${++uploadSequence}`;
    const upload: UploadState = {
      id,
      key: String(input.Key),
      parts: new Map(),
      completed: false,
      aborted: false,
    };
    uploads.set(id, upload);
    return { UploadId: id };
  }
  if (command instanceof ListPartsCommand) {
    const upload = uploads.get(String(input.UploadId));
    return {
      Parts: [...(upload?.parts.entries() || [])]
        .sort(([a], [b]) => a - b)
        .map(([PartNumber, value]) => ({ PartNumber, ...value })),
      IsTruncated: false,
    };
  }
  if (command instanceof CompleteMultipartUploadCommand) {
    completeCalls += 1;
    const upload = uploads.get(String(input.UploadId));
    if (!upload) throw new Error("missing upload");
    upload.completed = true;
    return {};
  }
  if (command instanceof AbortMultipartUploadCommand) {
    abortCalls += 1;
    if (abortFailure) throw new Error("mock abort unavailable");
    const upload = uploads.get(String(input.UploadId));
    if (upload) upload.aborted = true;
    return {};
  }
  if (command instanceof DeleteObjectCommand) {
    deleteCalls += 1;
    const upload = [...uploads.values()].find((candidate) => candidate.key === input.Key);
    if (upload) uploads.delete(upload.id);
    return {};
  }
  if (command instanceof HeadObjectCommand) {
    const upload = [...uploads.values()].find((candidate) => candidate.key === input.Key);
    const naturalSize = [...(upload?.parts.values() || [])].reduce((sum, part) => sum + part.Size, 0);
    return {
      ContentLength: headSizeOverride ?? naturalSize,
      ContentType: "application/pdf",
    };
  }
  if (command instanceof GetObjectCommand) {
    assert.equal(input.Range, "bytes=0-1023");
    return {
      Body: {
        transformToByteArray: async () => new TextEncoder().encode(
          invalidPdf ? "not a pdf" : "%PDF-1.7\n",
        ),
      },
    };
  }
  throw new Error(`Unexpected mock S3 command ${command.constructor.name}`);
};

const { app } = await import("../server.js");
const prisma = new PrismaClient();
const server = createServer(app);

const ids = {
  owner: "prompt31b-http-owner",
  adminA: "prompt31b-http-admin-a",
  adminB: "prompt31b-http-admin-b",
  student: "prompt31b-http-student",
  lecture: "prompt31b-http-lecture",
};

function token(userId: string): string {
  return jwt.sign(
    { userId, email: `${userId}@fixture.invalid`, sessionVersion: 0 },
    process.env.JWT_SECRET!,
    { algorithm: "HS256" },
  );
}

const auth = {
  owner: token(ids.owner),
  adminA: token(ids.adminA),
  adminB: token(ids.adminB),
  student: token(ids.student),
};

async function request(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  headers["X-Requested-With"] = "XMLHttpRequest";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });
}

async function startUpload(
  baseUrl: string,
  options: {
    token?: string;
    size?: number;
    filename?: string;
    mime?: string;
    lectureId?: string;
    title?: string;
    bodyExtras?: Record<string, unknown>;
  } = {},
): Promise<{ response: Response; body: any }> {
  const response = await request(baseUrl, "/api/materials/uploads/multipart", {
    method: "POST",
    token: options.token ?? auth.adminA,
    body: {
      lectureId: options.lectureId ?? ids.lecture,
      title: options.title ?? "Prompt 31B test PDF",
      filename: options.filename ?? "resource.pdf",
      mime: options.mime ?? "application/pdf",
      size: options.size ?? SMALL_RESOURCE_UPLOAD_LIMIT_BYTES + 1,
      lastModified: 1,
      ...(options.bodyExtras ?? {}),
    },
  });
  return { response, body: await response.json() };
}

function latestUpload(): UploadState {
  const upload = [...uploads.values()].at(-1);
  assert.ok(upload);
  return upload;
}

function populateValidParts(upload: UploadState, size: number): void {
  const finalSize = size - RESOURCE_MULTIPART_PART_SIZE_BYTES;
  upload.parts.set(1, {
    ETag: "\"provider-part-1\"",
    Size: RESOURCE_MULTIPART_PART_SIZE_BYTES,
  });
  upload.parts.set(2, {
    ETag: "\"provider-part-2\"",
    Size: finalSize,
  });
}

let baseUrl = "";

test.before(async () => {
  if (!httpEnabled) return;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await prisma.resourceMultipartUpload.deleteMany();
  await prisma.material.deleteMany({ where: { lectureId: ids.lecture } });
  await prisma.lecture.deleteMany({ where: { id: ids.lecture } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids).filter((id) => id !== ids.lecture) } } });
  await prisma.user.createMany({
    data: [
      { id: ids.owner, email: `${ids.owner}@fixture.invalid`, name: "Prompt Owner", role: "owner" },
      { id: ids.adminA, email: `${ids.adminA}@fixture.invalid`, name: "Prompt Admin A", role: "admin" },
      { id: ids.adminB, email: `${ids.adminB}@fixture.invalid`, name: "Prompt Admin B", role: "admin" },
      { id: ids.student, email: `${ids.student}@fixture.invalid`, name: "Prompt Student", role: "user" },
    ],
  });
  await prisma.lecture.create({
    data: {
      id: ids.lecture,
      name: "Prompt 31B Lecture",
      mainSubject: "ID",
      trackMode: "all",
    },
  });
});

test.beforeEach(async () => {
  if (!httpEnabled) return;
  await prisma.resourceMultipartUpload.deleteMany();
  await prisma.material.deleteMany({ where: { lectureId: ids.lecture } });
  uploads.clear();
  completeCalls = 0;
  abortCalls = 0;
  deleteCalls = 0;
  headSizeOverride = null;
  invalidPdf = false;
  abortFailure = false;
});

test.after(async () => {
  if (!httpEnabled) return;
  await prisma.resourceMultipartUpload.deleteMany();
  await prisma.material.deleteMany({ where: { lectureId: ids.lecture } });
  await prisma.lecture.deleteMany({ where: { id: ids.lecture } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids).filter((id) => id !== ids.lecture) } } });
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  S3Client.prototype.send = originalSend;
});

httpTest("HTTP authentication distinguishes anonymous, student, and authorized admin", async () => {
  assert.equal((await request(baseUrl, "/api/materials/uploads/multipart", {
    method: "POST",
  })).status, 401);
  assert.equal((await request(baseUrl, "/api/materials/uploads/multipart", {
    method: "POST",
    token: auth.student,
    body: {},
  })).status, 403);
  const started = await startUpload(baseUrl);
  assert.equal(started.response.status, 201, JSON.stringify(started.body));
});

httpTest("cross-admin ownership blocks status, presign, complete, and abort", async () => {
  const started = await startUpload(baseUrl);
  const sessionId = started.body.sessionId;
  const paths = [
    `/api/materials/uploads/multipart/${sessionId}`,
    `/api/materials/uploads/multipart/${sessionId}/parts`,
    `/api/materials/uploads/multipart/${sessionId}/complete`,
    `/api/materials/uploads/multipart/${sessionId}`,
  ];
  const methods = ["GET", "POST", "POST", "DELETE"];
  for (let index = 0; index < paths.length; index += 1) {
    const response = await request(baseUrl, paths[index]!, {
      method: methods[index],
      token: auth.adminB,
      body: methods[index] === "POST" && paths[index]!.endsWith("/parts")
        ? { partNumbers: [1] }
        : methods[index] === "POST" ? { parts: [] } : undefined,
    });
    assert.equal(response.status, 404);
  }
});

httpTest("start validation rejects invalid inputs before R2 creation", async () => {
  const createCount = () => uploads.size;
  for (const input of [
    { size: 0 },
    { size: MAX_RESOURCE_PDF_BYTES + 1 },
    { mime: "text/plain" },
    { filename: "resource.txt" },
    { lectureId: "deleted-lecture" },
  ]) {
    const result = await startUpload(baseUrl, input);
    assert.ok(result.response.status === 400 || result.response.status === 404 || result.response.status === 413);
    assert.equal(createCount(), 0);
  }
});

httpTest("active-session limit is three and an aborted terminal session frees a slot", async () => {
  const sessions = [];
  for (let index = 0; index < 3; index += 1) {
    const result = await startUpload(baseUrl, { title: `Active ${index}` });
    assert.equal(result.response.status, 201);
    sessions.push(result.body.sessionId);
  }
  assert.equal((await startUpload(baseUrl, { title: "Fourth" })).response.status, 429);
  assert.equal((await request(
    baseUrl,
    `/api/materials/uploads/multipart/${sessions[0]}`,
    { method: "DELETE", token: auth.adminA },
  )).status, 200);
  assert.equal((await startUpload(baseUrl, { title: "Replacement" })).response.status, 201);
});

httpTest("path-like filenames cannot override the server-owned object namespace", async () => {
  const result = await startUpload(baseUrl, {
    filename: "../../other-user/file.pdf",
    bodyExtras: {
      bucket: "attacker-bucket",
      key: "../../attacker-key",
      uploadId: "attacker-upload",
    },
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.filename, "file.pdf");
  assert.match(latestUpload().key, /^materials\/prompt31b-http-lecture\/[0-9a-f-]+\.pdf$/);
  const partResponse = await request(
    baseUrl,
    `/api/materials/uploads/multipart/${result.body.sessionId}/parts`,
    { method: "POST", token: auth.adminA, body: { partNumbers: [1] } },
  );
  assert.equal(partResponse.status, 200);
  const partBody = await partResponse.json();
  assert.equal(partBody.parts.length, 1);
  assert.match(partBody.parts[0].uploadUrl, /prompt31b-http-lecture/);
});

httpTest("presign validation rejects invalid, duplicate, excessive, expired, aborted, and completed requests", async () => {
  const started = await startUpload(baseUrl);
  const path = `/api/materials/uploads/multipart/${started.body.sessionId}/parts`;
  for (const partNumbers of [[0], [-1], [started.body.expectedPartCount + 1], [1, 1], Array.from({ length: 17 }, (_, index) => index + 1)]) {
    assert.equal((await request(baseUrl, path, {
      method: "POST",
      token: auth.adminA,
      body: { partNumbers },
    })).status, 400);
  }

  await prisma.resourceMultipartUpload.update({
    where: { id: started.body.sessionId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
  assert.equal((await request(baseUrl, path, {
    method: "POST",
    token: auth.adminA,
    body: { partNumbers: [1] },
  })).status, 410);

  const aborted = await startUpload(baseUrl);
  const abortedPath = `/api/materials/uploads/multipart/${aborted.body.sessionId}`;
  assert.equal((await request(baseUrl, abortedPath, { method: "DELETE", token: auth.adminA })).status, 200);
  assert.equal((await request(baseUrl, `${abortedPath}/parts`, {
    method: "POST",
    token: auth.adminA,
    body: { partNumbers: [1] },
  })).status, 409);

  const completed = await startUpload(baseUrl);
  populateValidParts(latestUpload(), SMALL_RESOURCE_UPLOAD_LIMIT_BYTES + 1);
  const completePath = `/api/materials/uploads/multipart/${completed.body.sessionId}`;
  assert.equal((await request(baseUrl, `${completePath}/complete`, {
    method: "POST",
    token: auth.adminA,
  })).status, 201);
  assert.equal((await request(baseUrl, `${completePath}/parts`, {
    method: "POST",
    token: auth.adminA,
    body: { partNumbers: [1] },
  })).status, 409);
});

httpTest("valid completion uses provider ListParts and persists Material last", async () => {
  const size = SMALL_RESOURCE_UPLOAD_LIMIT_BYTES + 1;
  const started = await startUpload(baseUrl, { size });
  const statusResponse = await request(
    baseUrl,
    `/api/materials/uploads/multipart/${started.body.sessionId}`,
    { token: auth.adminA },
  );
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).totalBytes, size);
  populateValidParts(latestUpload(), size);
  const response = await request(
    baseUrl,
    `/api/materials/uploads/multipart/${started.body.sessionId}/complete`,
    { method: "POST", token: auth.adminA, body: { parts: [{ partNumber: 1, etag: "attacker-etag" }] } },
  );
  assert.equal(response.status, 201);
  assert.equal(completeCalls, 1);
  const material = await prisma.material.findUnique({ where: { id: started.body.sessionId } });
  assert.equal(material?.storagePath, latestUpload().key);
  assert.equal(material?.title, "Prompt 31B test PDF");
});

httpTest("part-size, final-size, total-size, and missing-part validation block completion", async () => {
  const size = SMALL_RESOURCE_UPLOAD_LIMIT_BYTES + 1;
  const finalRemainder = size - RESOURCE_MULTIPART_PART_SIZE_BYTES;
  const cases = [
    (upload: UploadState) => {
      upload.parts.set(1, { ETag: "\"one\"", Size: RESOURCE_MULTIPART_PART_SIZE_BYTES - 1 });
      upload.parts.set(2, { ETag: "\"two\"", Size: finalRemainder + 1 });
    },
    (upload: UploadState) => {
      upload.parts.set(1, { ETag: "\"one\"", Size: RESOURCE_MULTIPART_PART_SIZE_BYTES });
      upload.parts.set(2, { ETag: "\"two\"", Size: finalRemainder - 1 });
    },
    (upload: UploadState) => {
      upload.parts.set(1, { ETag: "\"one\"", Size: RESOURCE_MULTIPART_PART_SIZE_BYTES });
      upload.parts.set(2, { ETag: "\"two\"", Size: finalRemainder - 1 });
    },
    (upload: UploadState) => {
      upload.parts.set(1, { ETag: "\"one\"", Size: RESOURCE_MULTIPART_PART_SIZE_BYTES });
    },
  ];
  for (const setup of cases) {
    await prisma.resourceMultipartUpload.deleteMany();
    uploads.clear();
    completeCalls = 0;
    const started = await startUpload(baseUrl, { size });
    setup(latestUpload());
    const response = await request(
      baseUrl,
      `/api/materials/uploads/multipart/${started.body.sessionId}/complete`,
      { method: "POST", token: auth.adminA },
    );
    assert.equal(response.status, 400);
    assert.equal(completeCalls, 0);
    assert.equal(await prisma.material.count({ where: { id: started.body.sessionId } }), 0);
  }
});

httpTest("HeadObject mismatch and invalid PDF perform object cleanup and fail the session", async () => {
  const size = SMALL_RESOURCE_UPLOAD_LIMIT_BYTES + 1;
  const first = await startUpload(baseUrl);
  populateValidParts(latestUpload(), size);
  headSizeOverride = size + 1;
  assert.equal((await request(baseUrl, `/api/materials/uploads/multipart/${first.body.sessionId}/complete`, {
    method: "POST",
    token: auth.adminA,
  })).status, 400);
  assert.equal(deleteCalls, 1);
  assert.equal((await prisma.resourceMultipartUpload.findUnique({ where: { id: first.body.sessionId } }))?.status, "FAILED");

  await prisma.resourceMultipartUpload.deleteMany();
  uploads.clear();
  headSizeOverride = null;
  deleteCalls = 0;
  const second = await startUpload(baseUrl);
  populateValidParts(latestUpload(), size);
  invalidPdf = true;
  assert.equal((await request(baseUrl, `/api/materials/uploads/multipart/${second.body.sessionId}/complete`, {
    method: "POST",
    token: auth.adminA,
  })).status, 400);
  assert.equal(deleteCalls, 1);
  assert.equal(await prisma.material.count({ where: { id: second.body.sessionId } }), 0);
});

httpTest("Material database failure after R2 completion deletes the object and fails the session", async () => {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION prompt31b_fail_material_insert() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'prompt31b material failure'; END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER prompt31b_fail_material_trigger
    BEFORE INSERT ON "Material"
    FOR EACH ROW EXECUTE FUNCTION prompt31b_fail_material_insert();
  `);
  try {
    const size = SMALL_RESOURCE_UPLOAD_LIMIT_BYTES + 1;
    const started = await startUpload(baseUrl);
    populateValidParts(latestUpload(), size);
    assert.equal((await request(baseUrl, `/api/materials/uploads/multipart/${started.body.sessionId}/complete`, {
      method: "POST",
      token: auth.adminA,
    })).status, 400);
    assert.equal(deleteCalls, 1);
    assert.equal((await prisma.resourceMultipartUpload.findUnique({ where: { id: started.body.sessionId } }))?.status, "FAILED");
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS prompt31b_fail_material_trigger ON "Material"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS prompt31b_fail_material_insert()`);
  }
});

httpTest("completion is idempotent and never sends a second provider completion", async () => {
  const size = SMALL_RESOURCE_UPLOAD_LIMIT_BYTES + 1;
  const started = await startUpload(baseUrl);
  populateValidParts(latestUpload(), size);
  const path = `/api/materials/uploads/multipart/${started.body.sessionId}/complete`;
  assert.equal((await request(baseUrl, path, { method: "POST", token: auth.adminA })).status, 201);
  assert.equal((await request(baseUrl, path, { method: "POST", token: auth.adminA })).status, 200);
  assert.equal(completeCalls, 1);
  assert.equal(await prisma.material.count({ where: { id: started.body.sessionId } }), 1);
});

httpTest("abort is idempotent, blocks future operations, and does not falsely claim provider cleanup on failure", async () => {
  const started = await startUpload(baseUrl);
  const path = `/api/materials/uploads/multipart/${started.body.sessionId}`;
  abortFailure = true;
  assert.equal((await request(baseUrl, path, { method: "DELETE", token: auth.adminA })).status, 502);
  assert.equal((await prisma.resourceMultipartUpload.findUnique({ where: { id: started.body.sessionId } }))?.status, "FAILED");
  abortFailure = false;
  assert.equal((await request(baseUrl, path, { method: "DELETE", token: auth.adminA })).status, 200);
  assert.equal((await request(baseUrl, path, { method: "DELETE", token: auth.adminA })).status, 200);
  assert.equal((await request(baseUrl, `${path}/parts`, {
    method: "POST",
    token: auth.adminA,
    body: { partNumbers: [1] },
  })).status, 409);
});

httpTest("expired active sessions are aborted and removed by opportunistic cleanup", async () => {
  const expired = await startUpload(baseUrl, { title: "Expired" });
  await prisma.resourceMultipartUpload.update({
    where: { id: expired.body.sessionId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
  const active = await startUpload(baseUrl, { title: "Active" });
  assert.ok(active.response.status === 201 || active.response.status === 429);
  assert.equal(await prisma.resourceMultipartUpload.findUnique({ where: { id: expired.body.sessionId } }), null);
  assert.ok(abortCalls >= 1);
});