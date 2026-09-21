import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import express from "express";
import test from "node:test";
import { AIServiceError } from "../server/services/ai/errors.js";
import { AIInputService } from "../server/services/ai/input/AIInputService.js";
import { AITemporaryFileManager } from "../server/services/ai/input/temporaryFiles.js";
import type { PreparedAIInput } from "../server/services/ai/input/contracts.js";
import type { AIAdminEngines } from "../server/services/ai/http/createAIAdminRouter.js";
import { createAIAdminRouter } from "../server/services/ai/http/createAIAdminRouter.js";
import { bindAIRequestAbort } from "../server/services/ai/http/createAIAdminRouter.js";
import { AIAdminConcurrencyGate, AIAdminRateLimiter } from "../server/services/ai/http/rateLimit.js";
import type { MCQOperationResult } from "../server/services/ai/mcq/contracts.js";
import type { FlashcardOperationResult } from "../server/services/ai/flashcard/contracts.js";

const CANDIDATE_ID = "00000000-0000-4000-8000-000000000011";

function mcqResult(operation: MCQOperationResult["operation"] = "generate"): MCQOperationResult {
  return {
    operation,
    promptVersion: "mcq-v1",
    items: [{
      candidateId: CANDIDATE_ID,
      question: "What does the left ventricle pump?",
      optionA: "Oxygenated blood",
      optionB: "Deoxygenated blood",
      optionC: "Lymph",
      optionD: "Bile",
      correctAnswer: "A",
      hint: null,
      explanation: "It pumps oxygenated blood into systemic circulation.",
      category: "AI_GENERATED",
      difficulty: "Easy",
      provenance: operation === "extract" ? "extracted" : operation === "enhance" ? "enhanced" : "generated",
      source: { inputType: "text", section: "Cardiology" },
      confidence: 0.95,
      importReady: true,
      needsReview: false,
      requiresHumanApproval: true,
      warnings: [],
    }],
    skippedItems: [],
    truncated: false,
    warnings: [],
    requiresHumanApproval: true,
    counts: { returnedCount: 1, readyCount: 1, reviewCount: 0, skippedCount: 0 },
    provider: { provider: "fake", model: "test-model" },
    processing: { durationMs: 1 },
  };
}

function flashcardResult(operation: FlashcardOperationResult["operation"] = "generate"): FlashcardOperationResult {
  return {
    operation,
    promptVersion: "flashcard-v1",
    items: [{
      candidateId: CANDIDATE_ID,
      clinicalConcept: "Left ventricular function",
      explanation: "It pumps oxygenated blood into systemic circulation.",
      provenance: operation === "extract" ? "extracted" : operation === "enhance" ? "enhanced" : "generated",
      source: { inputType: "text", section: "Cardiology" },
      confidence: 0.95,
      importReady: true,
      needsReview: false,
      requiresHumanApproval: true,
      warnings: [],
    }],
    skippedItems: [],
    truncated: false,
    warnings: [],
    requiresHumanApproval: true,
    counts: { returnedCount: 1, readyCount: 1, reviewCount: 0, skippedCount: 0 },
    provider: { provider: "fake", model: "test-model" },
    processing: { durationMs: 1 },
  };
}

interface TestServer {
  server: Server;
  baseUrl: string;
  root: string;
  calls: Array<{ target: string; operation: string; inputKind: string; signal: AbortSignal }>;
  close(): Promise<void>;
}

async function createTestServer(
  lecture: { id: string; name: string } | null = { id: "lecture-1", name: "Cardiology" },
  behavior: { mcq?: MCQOperationResult; flashcard?: FlashcardOperationResult; fail?: AIServiceError } = {},
  inspectInput?: (input: PreparedAIInput) => void,
): Promise<TestServer> {
  const root = await mkdtemp(join(tmpdir(), "99-guide-ai-http-"));
  const temporaryFiles = new AITemporaryFileManager(root);
  const inputService = new AIInputService({}, temporaryFiles);
  const calls: TestServer["calls"] = [];
  const engines: AIAdminEngines = {
    mcq: {
      extractExistingMCQs: async (input: PreparedAIInput, signal?: AbortSignal) => {
        inspectInput?.(input);
        calls.push({ target: "mcq", operation: "extract", inputKind: input.input.kind, signal: signal! });
        if (behavior.fail) throw behavior.fail;
        return behavior.mcq ?? mcqResult("extract");
      },
      generateMCQs: async (input: PreparedAIInput, _options, signal?: AbortSignal) => {
        inspectInput?.(input);
        calls.push({ target: "mcq", operation: "generate", inputKind: input.input.kind, signal: signal! });
        if (behavior.fail) throw behavior.fail;
        return behavior.mcq ?? mcqResult();
      },
      enhanceExistingMCQs: async (input: PreparedAIInput, _options, signal?: AbortSignal) => {
        inspectInput?.(input);
        calls.push({ target: "mcq", operation: "enhance", inputKind: input.input.kind, signal: signal! });
        if (behavior.fail) throw behavior.fail;
        return behavior.mcq ?? mcqResult("enhance");
      },
    },
    flashcard: {
      extractExistingFlashcards: async (input: PreparedAIInput, signal?: AbortSignal) => {
        inspectInput?.(input);
        calls.push({ target: "flashcard", operation: "extract", inputKind: input.input.kind, signal: signal! });
        if (behavior.fail) throw behavior.fail;
        return behavior.flashcard ?? flashcardResult("extract");
      },
      generateFlashcards: async (input: PreparedAIInput, _options, signal?: AbortSignal) => {
        inspectInput?.(input);
        calls.push({ target: "flashcard", operation: "generate", inputKind: input.input.kind, signal: signal! });
        if (behavior.fail) throw behavior.fail;
        return behavior.flashcard ?? flashcardResult();
      },
      enhanceExistingFlashcards: async (input: PreparedAIInput, _options, signal?: AbortSignal) => {
        inspectInput?.(input);
        calls.push({ target: "flashcard", operation: "enhance", inputKind: input.input.kind, signal: signal! });
        if (behavior.fail) throw behavior.fail;
        return behavior.flashcard ?? flashcardResult("enhance");
      },
    },
  };

  const app = express();
  app.use(express.json({ limit: "3mb" }));
  app.use("/api/admin/ai", createAIAdminRouter({
    requireAdmin: (req, res, next) => {
      const role = req.headers["x-test-role"];
      if (!role) return res.status(401).json({ error: "Authentication required." });
      if (role !== "admin" && role !== "owner") return res.status(403).json({ error: "Administrative role required." });
      const userId = typeof req.headers["x-test-user"] === "string"
        ? req.headers["x-test-user"]
        : "admin-1";
      (req as { user?: unknown }).user = { id: userId, role };
      next();
    },
    lectureResolver: { findLecture: async () => lecture },
    inputService,
    temporaryFiles,
    engineFactory: () => engines,
  }));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not open a TCP port.");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    root,
    calls,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function jsonRequest(baseUrl: string, path: string, body: unknown, role?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(role ? { "x-test-role": role } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("AI preview routes enforce admin authorization and lecture context before engines", async () => {
  const server = await createTestServer(null);
  try {
    const unauthenticated = await jsonRequest(server.baseUrl, "/api/admin/ai/mcq/preview", {
      lectureId: "lecture-1", operation: "extract", inputKind: "text", text: "source",
    });
    assert.equal(unauthenticated.status, 401);

    const student = await jsonRequest(server.baseUrl, "/api/admin/ai/mcq/preview", {
      lectureId: "lecture-1", operation: "extract", inputKind: "text", text: "source",
    }, "student");
    assert.equal(student.status, 403);

    const missingLecture = await jsonRequest(server.baseUrl, "/api/admin/ai/mcq/preview", {
      lectureId: "lecture-1", operation: "extract", inputKind: "text", text: "source",
    }, "admin");
    assert.equal(missingLecture.status, 404);
    assert.equal(server.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("AI preview job HTTP access is authenticated and owner-bound", async () => {
  const server = await createTestServer();
  try {
    const body = {
      lectureId: "lecture-1",
      operation: "extract",
      inputKind: "text",
      text: "source",
    };
    const anonymous = await jsonRequest(server.baseUrl, "/api/admin/ai/mcq/preview-jobs", body);
    assert.equal(anonymous.status, 401);
    const ordinaryUser = await jsonRequest(server.baseUrl, "/api/admin/ai/mcq/preview-jobs", body, "student");
    assert.equal(ordinaryUser.status, 403);

    const accepted = await jsonRequest(server.baseUrl, "/api/admin/ai/mcq/preview-jobs", body, "admin");
    assert.equal(accepted.status, 202);
    const { jobId } = await accepted.json() as { jobId: string };

    const ownerRead = await fetch(`${server.baseUrl}/api/admin/ai/mcq/preview-jobs/${jobId}`, {
      headers: { "x-test-role": "admin", "x-test-user": "admin-1" },
    });
    assert.equal(ownerRead.status, 200);

    const otherRead = await fetch(`${server.baseUrl}/api/admin/ai/mcq/preview-jobs/${jobId}`, {
      headers: { "x-test-role": "admin", "x-test-user": "admin-2" },
    });
    assert.equal(otherRead.status, 404);

    const otherCancel = await fetch(`${server.baseUrl}/api/admin/ai/mcq/preview-jobs/${jobId}`, {
      method: "DELETE",
      headers: { "x-test-role": "admin", "x-test-user": "admin-2" },
    });
    assert.equal(otherCancel.status, 404);
  } finally {
    await server.close();
  }
});

test("text MCQ preview dispatches safely and returns a projected response", async () => {
  const server = await createTestServer();
  try {
    const response = await jsonRequest(server.baseUrl, "/api/admin/ai/mcq/preview", {
      lectureId: "lecture-1",
      operation: "generate",
      inputKind: "text",
      text: "Ventricular systole ejects blood.",
      options: {
        count: 1,
        difficulty: "Easy",
        questionStyle: "direct",
        includeHints: false,
        includeExplanations: true,
      },
    }, "admin");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.target, "mcq");
    assert.equal((body.result as Record<string, unknown>).requiresHumanApproval, true);
    assert.equal(server.calls[0]?.inputKind, "text");
    assert.equal(server.calls[0]?.signal.aborted, false);
    assert.ok(!JSON.stringify(body).includes(server.root));
    assert.ok(!JSON.stringify(body).includes("capability"));
  } finally {
    await server.close();
  }
});

test("Flashcard extract, generate, and enhance operations dispatch through the same route", async () => {
  const server = await createTestServer();
  try {
    for (const operation of ["extract", "generate", "enhance"] as const) {
      const options = operation === "generate" ? { count: 1, focus: "cardiology" } : operation === "enhance" ? { explanation: true } : undefined;
      const response = await jsonRequest(server.baseUrl, "/api/admin/ai/flashcards/preview", {
        lectureId: "lecture-1", operation, inputKind: "text", text: "Left ventricular function.", ...(options ? { options } : {}),
      }, "owner");
      assert.equal(response.status, 200);
    }
    assert.deepEqual(server.calls.map((call) => call.operation), ["extract", "generate", "enhance"]);
    assert.ok(server.calls.every((call) => call.target === "flashcard"));
  } finally {
    await server.close();
  }
});

test("PDF multipart intake is disk-backed, validated, and cleaned", async () => {
  const server = await createTestServer();
  try {
    const form = new FormData();
    form.set("lectureId", "lecture-1");
    form.set("operation", "extract");
    form.set("inputKind", "pdf");
    form.set("file", new Blob([Buffer.from("%PDF-1.7\nvalid test")], { type: "application/pdf" }), "../lecture.pdf");
    const response = await fetch(`${server.baseUrl}/api/admin/ai/mcq/preview`, {
      method: "POST",
      headers: { "x-test-role": "admin" },
      body: form,
    });
    assert.equal(response.status, 200);
    assert.equal(server.calls[0]?.inputKind, "pdf");
    assert.deepEqual(await readdir(server.root), []);
  } finally {
    await server.close();
  }
});

test("ordered multi-image multipart intake preserves indexes and cleans all files", async () => {
  const seenIndexes: number[] = [];
  const server = await createTestServer(undefined, {}, (input) => {
    if (input.input.kind === "image") {
      seenIndexes.push(...input.input.images.map((image) => image.imageIndex));
    }
  });
  try {
    const form = new FormData();
    form.set("lectureId", "lecture-1");
    form.set("operation", "generate");
    form.set("inputKind", "image");
    form.set("options", JSON.stringify({
      count: 1, difficulty: "mixed", questionStyle: "direct", includeHints: false, includeExplanations: true,
    }));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    form.append("files", new Blob([png], { type: "image/png" }), "first.png");
    form.append("files", new Blob([png], { type: "image/png" }), "second.png");
    const response = await fetch(`${server.baseUrl}/api/admin/ai/mcq/preview`, {
      method: "POST",
      headers: { "x-test-role": "admin" },
      body: form,
    });
    assert.equal(response.status, 200);
    assert.equal(server.calls[0]?.inputKind, "image");
    assert.deepEqual(seenIndexes, [0, 1]);
    assert.deepEqual(await readdir(server.root), []);
  } finally {
    await server.close();
  }
});

test("request abort wiring propagates disconnects and removes listeners", () => {
  const request = new EventEmitter() as unknown as import("express").Request;
  const response = new EventEmitter() as unknown as import("express").Response & { writableEnded: boolean };
  response.writableEnded = false;
  const abort = bindAIRequestAbort(request, response);
  assert.equal(abort.signal.aborted, false);
  request.emit("aborted");
  assert.equal(abort.signal.aborted, true);
  abort.cleanup();
  assert.equal(request.listenerCount("aborted"), 0);
  assert.equal(response.listenerCount("close"), 0);
});

test("invalid media and invalid option combinations do not invoke an engine", async () => {
  const server = await createTestServer();
  try {
    const invalidOptions = await jsonRequest(server.baseUrl, "/api/admin/ai/flashcards/preview", {
      lectureId: "lecture-1", operation: "generate", inputKind: "text", text: "source", options: { count: 1, includeHints: true },
    }, "admin");
    assert.equal(invalidOptions.status, 400);

    const form = new FormData();
    form.set("lectureId", "lecture-1");
    form.set("operation", "extract");
    form.set("inputKind", "pdf");
    form.set("file", new Blob(["not a PDF"], { type: "application/pdf" }), "fake.pdf");
    const invalidMedia = await fetch(`${server.baseUrl}/api/admin/ai/mcq/preview`, {
      method: "POST", headers: { "x-test-role": "admin" }, body: form,
    });
    assert.equal(invalidMedia.status, 400);
    assert.equal(server.calls.length, 0);
    assert.deepEqual(await readdir(server.root), []);
  } finally {
    await server.close();
  }
});

test("multipart parser failures return safe errors and remove partial intake files", async () => {
  const server = await createTestServer();
  try {
    const form = new FormData();
    form.set("lectureId", "lecture-1");
    form.set("operation", "extract");
    form.set("inputKind", "pdf");
    form.append("file", new Blob([Buffer.from("%PDF-1.7\nfirst")], { type: "application/pdf" }), "first.pdf");
    form.append("file", new Blob([Buffer.from("%PDF-1.7\nsecond")], { type: "application/pdf" }), "second.pdf");
    const response = await fetch(`${server.baseUrl}/api/admin/ai/mcq/preview`, {
      method: "POST", headers: { "x-test-role": "admin" }, body: form,
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, "AI_MULTIPART_INVALID");
    assert.doesNotMatch(body.error.message, /Multer|path|stack/i);
    assert.deepEqual(await readdir(server.root), []);
    assert.equal(server.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("AI errors map safely and always release concurrency slots", async () => {
  const server = await createTestServer({ id: "lecture-1", name: "Cardiology" }, {
    fail: new AIServiceError("AI_TIMEOUT", { publicMessage: "The AI request timed out.", retryable: true }),
  });
  try {
    const response = await jsonRequest(server.baseUrl, "/api/admin/ai/mcq/preview", {
      lectureId: "lecture-1", operation: "extract", inputKind: "text", text: "source",
    }, "admin");
    assert.equal(response.status, 504);
    const body = await response.json() as { requestId: string; error: { code: string; message: string } };
    assert.match(body.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(body.error.code, "AI_TIMEOUT");
    assert.doesNotMatch(body.error.message, /stack|\/tmp|source/i);
  } finally {
    await server.close();
  }
});

test("rate limiter and concurrency gate are bounded, isolated, and releasable", () => {
  let now = 0;
  const limiter = new AIAdminRateLimiter(2, 1000, () => now);
  assert.equal(limiter.check("admin-a").allowed, true);
  assert.equal(limiter.check("admin-a").allowed, true);
  assert.equal(limiter.check("admin-a").allowed, false);
  assert.equal(limiter.check("admin-b").allowed, true);
  now = 1001;
  assert.equal(limiter.check("admin-a").allowed, true);

  const gate = new AIAdminConcurrencyGate(1, 2);
  const first = gate.tryAcquire("admin-a");
  assert.ok(first);
  assert.equal(gate.tryAcquire("admin-a"), null);
  const second = gate.tryAcquire("admin-b");
  assert.ok(second);
  assert.equal(gate.tryAcquire("admin-c"), null);
  first?.release();
  second?.release();
  assert.equal(gate.activeCount, 0);
});