import assert from "node:assert/strict";
import test from "node:test";
import {
  RESOURCE_MULTIPART_PART_SIZE_BYTES,
  SMALL_RESOURCE_UPLOAD_LIMIT_BYTES,
} from "../shared/resourceMultipart.js";

type Scenario = "normal" | "retry" | "resume" | "cancel";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as any).window;
const originalLocalStorage = (globalThis as any).localStorage;
const originalXhr = (globalThis as any).XMLHttpRequest;

let scenario: Scenario = "normal";
let startCalls = 0;
let completeCalls = 0;
let abortCalls = 0;
let activePuts = 0;
let maximumActivePuts = 0;
let attemptsByPart = new Map<number, number>();
let controlRequests: Array<{ method: string; path: string; body: any }> = [];
let sliceCalls: Array<{ start: number; end: number }> = [];
let stored = new Map<string, string>();

const windowStub = {
  location: { href: "http://localhost.test/", origin: "http://localhost.test" },
  setTimeout,
  clearTimeout,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  localStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
    clear: () => { stored.clear(); },
  },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFile(size: number, name = "resource.pdf"): File {
  return {
    name,
    size,
    lastModified: 123,
    type: "application/pdf",
    slice(start: number, end: number) {
      sliceCalls.push({ start, end });
      return { size: end - start, start, end } as unknown as Blob;
    },
  } as unknown as File;
}

class FakeXHR {
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number }) => void } = {};
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private url = "";
  private finished = false;

  open(_method: string, url: string): void {
    this.url = url;
  }

  setRequestHeader(): void {}

  send(body: { size: number }): void {
    const part = Number(this.url.split("/").at(-1) || 0);
    const attempt = (attemptsByPart.get(part) || 0) + 1;
    attemptsByPart.set(part, attempt);
    activePuts += 1;
    maximumActivePuts = Math.max(maximumActivePuts, activePuts);

    if (scenario === "cancel") return;

    setTimeout(() => {
      if (this.finished) return;
      if (scenario === "retry" && part === 2 && attempt === 1) {
        this.finish(() => {
          this.status = 403;
          this.onload?.();
        });
        return;
      }
      this.finish(() => {
        this.status = 200;
        this.upload.onprogress?.({ lengthComputable: true, loaded: Math.floor(body.size / 2) });
        this.upload.onprogress?.({ lengthComputable: true, loaded: body.size });
        this.onload?.();
      });
    }, 0);
  }

  abort(): void {
    if (this.finished) return;
    this.finish(() => this.onabort?.());
  }

  private finish(callback: () => void): void {
    if (this.finished) return;
    this.finished = true;
    activePuts -= 1;
    callback();
  }
}

function resetScenario(next: Scenario): void {
  scenario = next;
  startCalls = 0;
  completeCalls = 0;
  abortCalls = 0;
  activePuts = 0;
  maximumActivePuts = 0;
  attemptsByPart = new Map();
  controlRequests = [];
  sliceCalls = [];
  stored = new Map();
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const path = new URL(url, "http://localhost.test").pathname;
  const method = (init?.method || "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  controlRequests.push({ method, path, body });

  if (method === "GET") {
    const size = 3 * RESOURCE_MULTIPART_PART_SIZE_BYTES + 5;
    return response({
      sessionId: "resume-session",
      status: "UPLOADING",
      title: "Test title",
      filename: "resource.pdf",
      totalBytes: size,
      partSizeBytes: RESOURCE_MULTIPART_PART_SIZE_BYTES,
      expectedPartCount: 4,
      completedPartNumbers: [1],
      completedParts: [{ partNumber: 1, sizeBytes: RESOURCE_MULTIPART_PART_SIZE_BYTES }],
      uploadedBytes: RESOURCE_MULTIPART_PART_SIZE_BYTES,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastModifiedMs: 123,
    });
  }

  if (method === "DELETE") {
    abortCalls += 1;
    return response({ success: true });
  }

  if (path.endsWith("/parts")) {
    return response({
      parts: (body.partNumbers as number[]).map((partNumber) => ({
        partNumber,
        uploadUrl: `https://r2.test/parts/${partNumber}`,
      })),
    });
  }

  if (path.endsWith("/complete")) {
    completeCalls += 1;
    return response({ success: true });
  }

  startCalls += 1;
  const size = Number(body.size);
  const partCount = Math.ceil(size / RESOURCE_MULTIPART_PART_SIZE_BYTES);
  return response({
    sessionId: "new-session",
    status: "UPLOADING",
    title: body.title,
    filename: body.filename,
    totalBytes: size,
    partSizeBytes: RESOURCE_MULTIPART_PART_SIZE_BYTES,
    expectedPartCount: partCount,
    completedPartNumbers: [],
    completedParts: [],
    uploadedBytes: 0,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    lastModifiedMs: body.lastModified,
    uploadUrlTtlSeconds: 900,
    urlBatchSize: 16,
    concurrency: 3,
  });
}) as typeof fetch;

(globalThis as any).window = windowStub;
(globalThis as any).localStorage = windowStub.localStorage;
(globalThis as any).XMLHttpRequest = FakeXHR;

const { uploadLargeResourcePdf } = await import("../src/features/lectures/api/resourceMultipartUpload.js");

test.after(() => {
  globalThis.fetch = originalFetch;
  (globalThis as any).window = originalWindow;
  (globalThis as any).localStorage = originalLocalStorage;
  (globalThis as any).XMLHttpRequest = originalXhr;
});

test("frontend uses at most three concurrent PUTs, exact slices, and bounded progress", async () => {
  resetScenario("normal");
  const size = 3 * RESOURCE_MULTIPART_PART_SIZE_BYTES + 5;
  const progress: Array<{ uploadedBytes: number; completedParts: number }> = [];
  await uploadLargeResourcePdf({
    lectureId: "lecture-1",
    title: "Test title",
    file: fakeFile(size),
    signal: new AbortController().signal,
    onStage: () => {},
    onProgress: (value) => progress.push({
      uploadedBytes: value.uploadedBytes,
      completedParts: value.completedParts,
    }),
  });
  assert.ok(maximumActivePuts <= 3);
  assert.deepEqual(sliceCalls, [
    { start: 0, end: RESOURCE_MULTIPART_PART_SIZE_BYTES },
    { start: RESOURCE_MULTIPART_PART_SIZE_BYTES, end: 2 * RESOURCE_MULTIPART_PART_SIZE_BYTES },
    { start: 2 * RESOURCE_MULTIPART_PART_SIZE_BYTES, end: 3 * RESOURCE_MULTIPART_PART_SIZE_BYTES },
    { start: 3 * RESOURCE_MULTIPART_PART_SIZE_BYTES, end: size },
  ]);
  assert.ok(progress.every((value) => value.uploadedBytes <= size));
  assert.deepEqual(progress.at(-1), { uploadedBytes: size, completedParts: 4 });
});

test("frontend retries only the failed part and refreshes its URL on an expiry-style response", async () => {
  resetScenario("retry");
  const size = SMALL_RESOURCE_UPLOAD_LIMIT_BYTES + 1;
  await uploadLargeResourcePdf({
    lectureId: "lecture-1",
    title: "Test title",
    file: fakeFile(size),
    signal: new AbortController().signal,
    onStage: () => {},
    onProgress: () => {},
  });
  assert.equal(attemptsByPart.get(1), 1);
  assert.equal(attemptsByPart.get(2), 2);
  assert.ok(controlRequests.filter((request) => request.path.endsWith("/parts")).length >= 2);
});

test("frontend resume schedules only missing parts from the persisted R2 status", async () => {
  resetScenario("resume");
  const size = 3 * RESOURCE_MULTIPART_PART_SIZE_BYTES + 5;
  stored.set(`resource-multipart-session:lecture-1:resource.pdf:${size}:123`, "resume-session");
  await uploadLargeResourcePdf({
    lectureId: "lecture-1",
    title: "Test title",
    file: fakeFile(size),
    signal: new AbortController().signal,
    onStage: () => {},
    onProgress: () => {},
  });
  assert.equal(startCalls, 0);
  assert.deepEqual(sliceCalls, [
    { start: RESOURCE_MULTIPART_PART_SIZE_BYTES, end: 2 * RESOURCE_MULTIPART_PART_SIZE_BYTES },
    { start: 2 * RESOURCE_MULTIPART_PART_SIZE_BYTES, end: 3 * RESOURCE_MULTIPART_PART_SIZE_BYTES },
    { start: 3 * RESOURCE_MULTIPART_PART_SIZE_BYTES, end: size },
  ]);
});

test("frontend cancel aborts active XHRs, calls control-plane abort, and never completes", async () => {
  resetScenario("cancel");
  const controller = new AbortController();
  const promise = uploadLargeResourcePdf({
    lectureId: "lecture-1",
    title: "Test title",
    file: fakeFile(3 * RESOURCE_MULTIPART_PART_SIZE_BYTES + 5),
    signal: controller.signal,
    onStage: () => {},
    onProgress: () => {},
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(promise, /cancelled|aborted/i);
  assert.equal(abortCalls, 1);
  assert.equal(completeCalls, 0);
  assert.equal(stored.size, 0);
});