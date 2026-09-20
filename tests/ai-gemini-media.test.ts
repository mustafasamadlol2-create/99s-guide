import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { aiMcqDraftSchema } from "../server/services/ai/schemas.js";
import { AIServiceError } from "../server/services/ai/errors.js";
import { GeminiProvider, type GeminiClient } from "../server/services/ai/GeminiProvider.js";
import { AIContentService } from "../server/services/ai/AIContentService.js";
import { GeminiFilesManager, type GeminiFilesClient } from "../server/services/ai/gemini/GeminiFilesManager.js";
import { GeminiMediaTransport } from "../server/services/ai/gemini/GeminiMediaTransport.js";
import { getGeminiMediaConfig } from "../server/services/ai/gemini/config.js";
import { AITemporaryFileManager } from "../server/services/ai/input/temporaryFiles.js";
import { AIInputService } from "../server/services/ai/input/AIInputService.js";
import type { AIContentPart } from "../server/services/ai/input/contracts.js";

const output = {
  question: "Which chamber pumps systemic circulation?",
  optionA: "Right atrium",
  optionB: "Right ventricle",
  optionC: "Left atrium",
  optionD: "Left ventricle",
  correctAnswer: "D",
  hint: null,
  explanation: "The left ventricle pumps into the aorta.",
  difficulty: "Medium",
  provenance: "extracted",
  confidence: 0.9,
  needsReview: true,
  warnings: [],
};

const testStager = new AITemporaryFileManager(join(tmpdir(), "gemini-media-staged"));
const SCANNED_PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
  + "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n"
  + "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 0 R >> >> "
  + "/MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n"
  + "4 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB "
  + "/BitsPerComponent 8 /Length 3 >>\nstream\n\u0000\u0000\u0000\nendstream\nendobj\n"
  + "5 0 obj\n<< /Length 12 >>\nstream\nq /Im0 Do Q\nendstream\nendobj\n%%EOF",
  "ascii",
);

async function imagePart(path: string, index: number, _sizeBytes = 3, mimeType = "image/png"): Promise<AIContentPart> {
  const staged = await testStager.stage(new Uint8Array(await readFile(path)));
  return {
    kind: "file",
    inputType: "image",
    mimeType: mimeType as "image/png",
    fileSource: { kind: "staged_file", capability: staged.capability, ownership: "owned_transient" },
    source: { inputType: "image", imageIndex: index, label: `image-${index}` },
    sizeBytes: staged.sizeBytes,
    sha256: `${index}`.repeat(64),
  };
}

async function pdfPart(path: string): Promise<AIContentPart> {
  const staged = await testStager.stage(new Uint8Array(await readFile(path)));
  return {
    kind: "file",
    inputType: "pdf",
    mimeType: "application/pdf",
    fileSource: { kind: "staged_file", capability: staged.capability, ownership: "owned_transient" },
    source: { inputType: "pdf", label: "lecture" },
    sizeBytes: staged.sizeBytes,
    sha256: "a".repeat(64),
  };
}

async function testPdfPart(): Promise<AIContentPart> {
  const staged = await testStager.stage(new Uint8Array([37, 80, 68, 70]));
  return {
    kind: "file",
    inputType: "pdf",
    mimeType: "application/pdf",
    fileSource: { kind: "staged_file", capability: staged.capability, ownership: "owned_transient" },
    source: { inputType: "pdf", label: "test" },
    sizeBytes: staged.sizeBytes,
    sha256: "a".repeat(64),
  };
}

class FakeFiles implements GeminiFilesClient {
  uploads: string[] = [];
  deleted: string[] = [];
  statuses: string[] = ["ACTIVE"];
  failUploadAt?: number;
  failDelete = false;
  async upload({ file, config }: { file: string; config?: { mimeType?: string } }): Promise<any> {
    if (this.failUploadAt !== undefined && this.uploads.length === this.failUploadAt) {
      throw new Error("upload failed");
    }
    this.uploads.push(file);
    return {
      name: `files/${this.uploads.length}`,
      uri: `https://provider/${this.uploads.length}`,
      mimeType: config?.mimeType ?? (file.endsWith(".pdf") ? "application/pdf" : "image/png"),
      state: this.statuses[0],
    };
  }
  async get({ name }: { name: string }): Promise<any> {
    const state = this.statuses.shift() ?? "ACTIVE";
    return { name, uri: `https://provider/${name}`, mimeType: "image/png", state };
  }
  async delete({ name }: { name: string }): Promise<void> {
    this.deleted.push(name);
    if (this.failDelete) throw new Error("delete failed");
  }
}

class Deferred<T> {
  readonly promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;
}

test("transport strategy selects text inline, image inline, and PDF/files modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-media-test-"));
  try {
    const first = join(root, "one.png");
    const second = join(root, "two.png");
    const pdf = join(root, "lecture.pdf");
    await Promise.all([writeFile(first, Buffer.from([1, 2])), writeFile(second, Buffer.from([3, 4])), writeFile(pdf, "%PDF")]);
    const files = new FakeFiles();
    const manager = new GeminiFilesManager(files, { processingTimeoutMs: 100, pollIntervalMs: 0 });
    const transport = new GeminiMediaTransport(manager, {
      inlineImageMaxTotalBytes: 10,
      fileProcessingTimeoutMs: 100,
      filePollIntervalMs: 0,
    });

    const inline = await transport.prepare([await imagePart(first, 0, 2), await imagePart(second, 1, 2)]);
    assert.equal(inline.transport, "inline");
    assert.equal(files.uploads.length, 0);
    assert.deepEqual(inline.contents[0].parts.map((part: any) => part.inlineData.mimeType), ["image/png", "image/png"]);

    const fileMode = await transport.prepare([await pdfPart(pdf)]);
    assert.equal(fileMode.transport, "files_api");
    assert.equal(files.uploads.length, 1);
    await fileMode.cleanup();
    assert.deepEqual(files.deleted, ["files/1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("large image batches upload all files in order and clean up partial failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-media-test-"));
  try {
    const paths = await Promise.all([0, 1, 2].map(async (index) => {
      const path = join(root, `${index}.png`);
      await writeFile(path, Buffer.from([index]));
      return path;
    }));
    const files = new FakeFiles();
    const transport = new GeminiMediaTransport(
      new GeminiFilesManager(files, { processingTimeoutMs: 100, pollIntervalMs: 0 }),
      { inlineImageMaxTotalBytes: 1, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
    );
    const prepared = await transport.prepare(await Promise.all(paths.map((path, index) => imagePart(path, index))));
    assert.equal(prepared.transport, "files_api");
    assert.equal(files.uploads.length, paths.length);
    await prepared.cleanup();
    assert.deepEqual(files.deleted, ["files/1", "files/2", "files/3"]);

    const partial = new FakeFiles();
    partial.failUploadAt = 1;
    const failing = new GeminiMediaTransport(
      new GeminiFilesManager(partial, { processingTimeoutMs: 100, pollIntervalMs: 0 }),
      { inlineImageMaxTotalBytes: 1, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
    );
    await assert.rejects(failing.prepare(await Promise.all(paths.map((path, index) => imagePart(path, index)))));
    assert.deepEqual(partial.deleted, ["files/1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Files API polling handles processing, failed, timeout, and abort", async () => {
  const files = new FakeFiles();
  files.statuses = ["PROCESSING", "ACTIVE"];
  const manager = new GeminiFilesManager(files, { processingTimeoutMs: 100, pollIntervalMs: 0 });
  const active = await manager.uploadAndActivate((await testStager.stage(new Uint8Array([1]))).capability, "application/pdf");
  assert.equal(active.name, "files/1");

  const failedFiles = new FakeFiles();
  failedFiles.statuses = ["FAILED"];
  await assert.rejects(
    new GeminiFilesManager(failedFiles, { processingTimeoutMs: 100, pollIntervalMs: 0 })
      .uploadAndActivate((await testStager.stage(new Uint8Array([1]))).capability, "application/pdf"),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_MEDIA_PROCESSING_FAILED",
  );

  const timeoutFiles = new FakeFiles();
  timeoutFiles.statuses = ["PROCESSING"];
  await assert.rejects(
    new GeminiFilesManager(timeoutFiles, { processingTimeoutMs: 1, pollIntervalMs: 5 })
      .uploadAndActivate((await testStager.stage(new Uint8Array([1]))).capability, "application/pdf"),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_MEDIA_PROCESSING_TIMEOUT",
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    manager.uploadAndActivate((await testStager.stage(new Uint8Array([1]))).capability, "application/pdf", controller.signal),
    (error: unknown) => error instanceof AIServiceError,
  );
});

test("GeminiProvider sends inline image media and preserves structured validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-media-test-"));
  try {
    const path = join(root, "image.png");
    await writeFile(path, Buffer.from([1, 2, 3]));
    let request: any;
    const client: GeminiClient = {
      models: {
        async generateContent(parameters) {
          request = parameters;
          return { text: JSON.stringify(output) };
        },
      },
    };
    const provider = new GeminiProvider(
      { apiKey: "test", model: "test-model", timeoutMs: 500 },
      client,
      { inlineImageMaxTotalBytes: 100, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
    );
    const result = await provider.generateStructured({
      contents: [await imagePart(path, 0, 3)],
      responseSchema: aiMcqDraftSchema,
    });
    assert.equal(result.data.correctAnswer, "D");
    assert.equal(result.meta.transport, "inline");
    assert.equal(request.contents[0].parts[0].inlineData.data, Buffer.from([1, 2, 3]).toString("base64"));
    assert.equal(request.contents[0].parts[0].inlineData.mimeType, "image/png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GeminiProvider sends PDFs through Files API and deletes provider files", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-media-test-"));
  try {
    const path = join(root, "lecture.pdf");
    await writeFile(path, "%PDF");
    const files = new FakeFiles();
    const client: GeminiClient = {
      files,
      models: {
        async generateContent(parameters) {
          assert.equal((parameters.contents as any)[0].parts[0].fileData.mimeType, "application/pdf");
          return { text: JSON.stringify(output) };
        },
      },
    };
    const provider = new GeminiProvider(
      { apiKey: "test", model: "test-model", timeoutMs: 500 },
      client,
      { inlineImageMaxTotalBytes: 100, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
    );
    const result = await provider.generateStructured({ contents: [await pdfPart(path)], responseSchema: aiMcqDraftSchema });
    assert.equal(result.meta.transport, "files_api");
    assert.deepEqual(files.deleted, ["files/1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("image-only PDFs remain valid media and reach Gemini Files API with original bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-scanned-pdf-"));
  try {
    const files = new FakeFiles();
    const uploadedBytes: Buffer[] = [];
    const originalUpload = files.upload.bind(files);
    files.upload = async (params) => {
      uploadedBytes.push(await readFile(params.file));
      return originalUpload(params);
    };
    const client: GeminiClient = {
      files,
      models: {
        async generateContent(parameters) {
          assert.equal((parameters.contents as any)[0].parts[0].fileData.mimeType, "application/pdf");
          return { text: JSON.stringify(output) };
        },
      },
    };
    const provider = new GeminiProvider(
      { apiKey: "test", model: "test-model", timeoutMs: 500 },
      client,
      { inlineImageMaxTotalBytes: 100, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
    );
    const input = new AIInputService({}, new AITemporaryFileManager(root));
    let preparedTransport: string | undefined;
    await input.withPreparedInput(
      {
        kind: "pdf",
        file: {
          bytes: SCANNED_PDF,
          claimedMimeType: "application/pdf",
          originalFilename: "scan.pdf",
        },
      },
      async (prepared) => {
        const result = await provider.generateStructured({
          contents: prepared.contents,
          responseSchema: aiMcqDraftSchema,
        });
        preparedTransport = result.meta.transport;
      },
    );
    assert.equal(preparedTransport, "files_api");
    assert.deepEqual(uploadedBytes, [SCANNED_PDF]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scanned-PDF polling can pass the old 30-second threshold under the production budget", async () => {
  const mediaConfig = getGeminiMediaConfig({});
  assert.equal(mediaConfig.fileProcessingTimeoutMs, 180_000);
  assert.ok(mediaConfig.fileProcessingTimeoutMs > 30_000);

  let currentTime = 0;
  const files = new FakeFiles();
  files.statuses = ["PROCESSING", "ACTIVE"];
  const manager = new GeminiFilesManager(files, {
    processingTimeoutMs: mediaConfig.fileProcessingTimeoutMs,
    pollIntervalMs: 30_001,
    now: () => currentTime,
    sleep: async (milliseconds) => {
      currentTime += milliseconds;
    },
  });
  const staged = await testStager.stage(SCANNED_PDF);
  const active = await manager.uploadAndActivate(staged.capability, "application/pdf");
  assert.equal(active.name, "files/1");
  assert.ok(currentTime > 30_000);
});

test("borrowed resources require a trusted resolver and never treat IDs as paths", async () => {
  const files = new FakeFiles();
  const manager = new GeminiFilesManager(files, { processingTimeoutMs: 100, pollIntervalMs: 0 });
  const borrowed: AIContentPart = {
    kind: "file",
    inputType: "image",
    mimeType: "image/png",
    fileSource: { kind: "existing_resource", resourceId: "lecture-42", ownership: "borrowed" },
    source: { inputType: "image", imageIndex: 0 },
    sizeBytes: 1,
    sha256: "f".repeat(64),
  };
  const noResolver = new GeminiMediaTransport(manager, {
    inlineImageMaxTotalBytes: 10,
    fileProcessingTimeoutMs: 100,
    filePollIntervalMs: 0,
  });
  await assert.rejects(noResolver.prepare([borrowed]), (error: unknown) =>
    error instanceof AIServiceError && error.code === "AI_MEDIA_RESOLUTION_FAILED");

  const trustedPath = join(tmpdir(), "trusted-resource.png");
  await writeFile(trustedPath, Buffer.from([1]));
  const resolver = new GeminiMediaTransport(
    manager,
    { inlineImageMaxTotalBytes: 10, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
    { resolve: async (resourceId) => {
      assert.equal(resourceId, "lecture-42");
      return {
        capability: (await testStager.stage(new Uint8Array(await readFile(trustedPath)))).capability,
        mimeType: "image/png",
        sizeBytes: 1,
      };
    } },
  );
  const prepared = await resolver.prepare([borrowed]);
  assert.equal(prepared.transport, "inline");
  await rm(trustedPath, { force: true });
});

test("transport rejects forged capabilities before any read and does not leak identifiers", async () => {
  let readCalled = false;
  const forged: AIContentPart = {
    kind: "file",
    inputType: "image",
    mimeType: "image/png",
    fileSource: {
      kind: "staged_file",
      capability: {
        sizeBytes: 1,
        readBytes: async () => { readCalled = true; return new Uint8Array([1]); },
        withPath: async (operation) => operation("/attacker/path"),
      },
      ownership: "owned_transient",
    },
    source: { inputType: "image", imageIndex: 0 },
    sizeBytes: 1,
    sha256: "b".repeat(64),
  };
  const transport = new GeminiMediaTransport(undefined, {
    inlineImageMaxTotalBytes: 10,
    fileProcessingTimeoutMs: 100,
    filePollIntervalMs: 0,
  });
  await assert.rejects(transport.prepare([forged]), (error: unknown) => {
    assert.equal(error instanceof AIServiceError, true);
    assert.equal((error as AIServiceError).publicMessage.includes("/attacker/path"), false);
    return error instanceof AIServiceError && error.code === "AI_MEDIA_RESOLUTION_FAILED";
  });
  assert.equal(readCalled, false);
});

test("Phase 3A local disposal and provider-file cleanup are independent and ordered", async () => {
  const files = new FakeFiles();
  const provider = new GeminiProvider(
    { apiKey: "test", model: "test-model", timeoutMs: 500 },
    { files, models: { async generateContent() { return { text: JSON.stringify(output) }; } } },
    { inlineImageMaxTotalBytes: 1, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
  );
  const service = new AIInputService();
  let capability: { readBytes(): Promise<Uint8Array> } | undefined;
  await service.withPreparedInput(
    { kind: "pdf", file: { bytes: new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"), claimedMimeType: "application/pdf" } },
    async (prepared) => {
      const part = prepared.contents[0];
      if (part.kind !== "file" || part.fileSource.kind !== "staged_file") assert.fail("Expected staged PDF.");
      capability = part.fileSource.capability;
      await provider.generateStructured({ contents: prepared.contents, responseSchema: aiMcqDraftSchema });
      assert.deepEqual(files.deleted, ["files/1"]);
    },
  );
  await assert.rejects(capability!.readBytes);
});

test("AIInputService -> AIContentService -> GeminiProvider preserves PDF and inline-image cleanup", async () => {
  const files = new FakeFiles();
  const client: GeminiClient = {
    files,
    models: { async generateContent() { return { text: JSON.stringify({ items: [output], warnings: [] }) }; } },
  };
  const provider = new GeminiProvider(
    { apiKey: "test", model: "test-model", timeoutMs: 500 },
    client,
    { inlineImageMaxTotalBytes: 100, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
  );
  const service = new AIContentService(provider);
  const input = new AIInputService();
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
  let pdfCapability: { readBytes(): Promise<Uint8Array> } | undefined;
  await input.withPreparedInput(
    { kind: "pdf", file: { bytes: pdfBytes, claimedMimeType: "application/pdf" } },
    async (prepared) => {
      const part = prepared.contents[0];
      if (part.kind !== "file" || part.fileSource.kind !== "staged_file") assert.fail("Expected PDF part.");
      pdfCapability = part.fileSource.capability;
      const response = await service.processContent({
        target: "mcq",
        operation: "extract",
        inputKind: "pdf",
        contents: prepared.contents,
      });
      assert.equal(response.provider.transport, "files_api");
    },
  );
  assert.deepEqual(files.deleted, ["files/1"]);
  await assert.rejects(pdfCapability!.readBytes);

  const imageBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  let imageCapability: { readBytes(): Promise<Uint8Array> } | undefined;
  await input.withPreparedInput(
    { kind: "image", files: [{ bytes: imageBytes, claimedMimeType: "image/png" }] },
    async (prepared) => {
      const part = prepared.contents[0];
      if (part.kind !== "file" || part.fileSource.kind !== "staged_file") assert.fail("Expected image part.");
      imageCapability = part.fileSource.capability;
      const response = await service.processContent({
        target: "mcq",
        operation: "extract",
        inputKind: "image",
        contents: prepared.contents,
      });
      assert.equal(response.provider.transport, "inline");
    },
  );
  await assert.rejects(imageCapability!.readBytes);
});

test("provider cleanup failure is a warning after success, while generation failure stays primary", async () => {
  const files = new FakeFiles();
  files.failDelete = true;
  const diagnostics: AIServiceError[] = [];
  const client: GeminiClient = {
    files,
    models: {
      async generateContent() { return { text: JSON.stringify(output) }; },
    },
  };
  const provider = new GeminiProvider(
    { apiKey: "test", model: "test-model", timeoutMs: 500 },
    client,
    { inlineImageMaxTotalBytes: 1, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
    (error) => { diagnostics.push(error); throw new Error("sink failed"); },
  );
  const result = await provider.generateStructured({
    contents: [await testPdfPart()],
    responseSchema: aiMcqDraftSchema,
  });
  assert.equal(result.data.correctAnswer, "D");
  assert.equal(result.meta.cleanupWarning, "provider_media_cleanup_failed");
  assert.equal(diagnostics[0]?.code, "AI_MEDIA_CLEANUP_FAILED");
  const asyncSinkProvider = new GeminiProvider(
    { apiKey: "test", model: "test-model", timeoutMs: 500 },
    {
      files,
      models: { async generateContent() { return { text: JSON.stringify(output) }; } },
    },
    { inlineImageMaxTotalBytes: 1, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
    async () => { throw new Error("async sink failed"); },
  );
  const asyncSinkResult = await asyncSinkProvider.generateStructured({
    contents: [await testPdfPart()],
    responseSchema: aiMcqDraftSchema,
  });
  assert.equal(asyncSinkResult.meta.cleanupWarning, "provider_media_cleanup_failed");

  const generationFailureFiles = new FakeFiles();
  const failingProvider = new GeminiProvider(
    { apiKey: "test", model: "test-model", timeoutMs: 500 },
    {
      files: generationFailureFiles,
      models: { async generateContent() { throw new Error("generation failed"); } },
    },
    { inlineImageMaxTotalBytes: 1, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
  );
  await assert.rejects(
    failingProvider.generateStructured({ contents: [await testPdfPart()], responseSchema: aiMcqDraftSchema }),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_PROVIDER_ERROR",
  );
  assert.deepEqual(generationFailureFiles.deleted, ["files/1"]);
});

test("upload references are registered and malformed/unknown states fail safely", async () => {
  class MalformedFiles extends FakeFiles {
    async upload(): Promise<any> {
      this.uploads.push("malformed");
      return { name: "files/malformed", state: "ACTIVE" };
    }
  }
  const malformed = new MalformedFiles();
  await assert.rejects(
    new GeminiFilesManager(malformed, { processingTimeoutMs: 100, pollIntervalMs: 0 })
      .uploadAndActivate((await testStager.stage(new Uint8Array([1]))).capability, "application/pdf"),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_MEDIA_UPLOAD_FAILED",
  );
  assert.deepEqual(malformed.deleted, ["files/malformed"]);

  const unknown = new FakeFiles();
  unknown.statuses = ["MYSTERY"];
  await assert.rejects(
    new GeminiFilesManager(unknown, { processingTimeoutMs: 100, pollIntervalMs: 0 })
      .uploadAndActivate((await testStager.stage(new Uint8Array([1]))).capability, "application/pdf"),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_MEDIA_PROCESSING_FAILED",
  );

  class GetFailureFiles extends FakeFiles {
    async get(): Promise<any> {
      throw new Error("status read failed");
    }
  }
  const getFailure = new GetFailureFiles();
  getFailure.statuses = ["PROCESSING"];
  await assert.rejects(
    new GeminiFilesManager(getFailure, { processingTimeoutMs: 100, pollIntervalMs: 0 })
      .uploadAndActivate((await testStager.stage(new Uint8Array([1]))).capability, "application/pdf"),
    (error: unknown) => error instanceof AIServiceError && error.code === "AI_MEDIA_PROCESSING_FAILED",
  );
  assert.deepEqual(getFailure.deleted, ["files/1"]);
});

test("inline media preserves JPEG, WebP, HEIC, and HEIF MIME and order", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-media-mime-"));
  try {
    const mimes = ["image/jpeg", "image/webp", "image/heic", "image/heif"] as const;
    const parts = await Promise.all(mimes.map(async (mime, index) => {
      const path = join(root, `${index}`);
      await writeFile(path, Buffer.from([index + 1]));
      return imagePart(path, index, 1, mime);
    }));
    const transport = new GeminiMediaTransport(undefined, {
      inlineImageMaxTotalBytes: 100,
      fileProcessingTimeoutMs: 100,
      filePollIntervalMs: 0,
    });
    const result = await transport.prepare(parts);
    assert.deepEqual(
      (result.contents as any)[0].parts.map((part: any) => part.inlineData.mimeType),
      mimes,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deferred aborts and outer deadlines preserve primary classification and cleanup", async () => {
  const processing = new Deferred<any>();
  const processingFiles = new FakeFiles();
  processingFiles.upload = async () => ({
    name: "files/processing",
    uri: "https://provider/processing",
    mimeType: "application/pdf",
    state: "PROCESSING",
  });
  processingFiles.get = async () => processing.promise;
  const abortController = new AbortController();
  const aborting = new GeminiFilesManager(processingFiles, { processingTimeoutMs: 1_000, pollIntervalMs: 0 });
  const aborted = aborting.uploadAndActivate(
    (await testStager.stage(new Uint8Array([1]))).capability,
    "application/pdf",
    abortController.signal,
  );
  setTimeout(() => abortController.abort(), 5);
  await assert.rejects(aborted, (error: unknown) =>
    error instanceof AIServiceError && error.code === "AI_MEDIA_PROCESSING_FAILED");
  assert.deepEqual(processingFiles.deleted, ["files/processing"]);

  const activatedFiles = new FakeFiles();
  const generation = new Deferred<any>();
  const activatedProvider = new GeminiProvider(
    { apiKey: "test", model: "test-model", timeoutMs: 1_000 },
    {
      files: activatedFiles,
      models: {
        async generateContent(parameters) {
          parameters.config?.abortSignal?.addEventListener("abort", () => generation.reject(new Error("cancelled")), { once: true });
          return generation.promise;
        },
      },
    },
    { inlineImageMaxTotalBytes: 1, fileProcessingTimeoutMs: 100, filePollIntervalMs: 0 },
  );
  const generationAbort = new AbortController();
  const generationRequest = activatedProvider.generateStructured({
    contents: [await testPdfPart()],
    responseSchema: aiMcqDraftSchema,
    signal: generationAbort.signal,
  });
  setTimeout(() => generationAbort.abort(), 5);
  await assert.rejects(generationRequest);
  assert.deepEqual(activatedFiles.deleted, ["files/1"]);

  const lateUpload = new Deferred<any>();
  const lateFiles = new FakeFiles();
  lateFiles.upload = async () => lateUpload.promise;
  const timeoutProvider = new GeminiProvider(
    { apiKey: "test", model: "test-model", timeoutMs: 5 },
    { files: lateFiles, models: { async generateContent() { return { text: JSON.stringify(output) }; } } },
    { inlineImageMaxTotalBytes: 1, fileProcessingTimeoutMs: 1_000, filePollIntervalMs: 0 },
  );
  const timedOut = timeoutProvider.generateStructured({
    contents: [await testPdfPart()],
    responseSchema: aiMcqDraftSchema,
  });
  await assert.rejects(timedOut, (error: unknown) => error instanceof AIServiceError && error.code === "AI_TIMEOUT");
  lateUpload.resolve({
    name: "files/late",
    uri: "https://provider/late",
    mimeType: "application/pdf",
    state: "ACTIVE",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(lateFiles.deleted, ["files/late"]);
});