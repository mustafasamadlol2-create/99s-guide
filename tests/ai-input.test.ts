import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AIServiceError } from "../server/services/ai/errors.js";
import { AIInputService } from "../server/services/ai/input/AIInputService.js";
import { AI_INPUT_HARD_LIMITS, MEBIBYTE, resolveAIInputLimits } from "../server/services/ai/input/config.js";
import { sha256Bytes } from "../server/services/ai/input/hash.js";
import { normalizeAIText } from "../server/services/ai/input/normalizeText.js";
import { AITemporaryFileManager } from "../server/services/ai/input/temporaryFiles.js";
import { detectAIBinaryMimeType } from "../server/services/ai/input/validators.js";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF", "ascii");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.from("RIFF0000WEBP", "ascii");
function ftyp(majorBrand: string, compatibleBrands: string[] = []): Buffer {
  const size = 16 + compatibleBrands.length * 4;
  const value = Buffer.alloc(size);
  value.writeUInt32BE(size, 0);
  value.write("ftyp", 4, "ascii");
  value.write(majorBrand, 8, "ascii");
  for (const [index, brand] of compatibleBrands.entries()) {
    value.write(brand, 16 + index * 4, "ascii");
  }
  return value;
}

const HEIC = ftyp("heic");
const HEIF = ftyp("mif1");

async function withInputService<T>(
  run: (service: AIInputService, root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "ai-input-test-"));
  const service = new AIInputService({}, new AITemporaryFileManager(root));
  try {
    return await run(service, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(access(path), (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

test("normalizes English, Arabic, mixed Unicode, and line endings without flattening", () => {
  const source = "  1. What is القلب؟\r\nA. Heart\rB. Lung\r\n\r\nشرحٌ عربي  ";
  const normalized = normalizeAIText(source, MEBIBYTE);
  assert.equal(
    normalized.text,
    "1. What is القلب؟\nA. Heart\nB. Lung\n\nشرحٌ عربي",
  );
  assert.equal(normalized.sizeBytes, Buffer.byteLength(normalized.text, "utf8"));
  assert.equal(normalized.sha256, sha256Bytes(Buffer.from(normalized.text, "utf8")));
});

test("rejects empty, whitespace-only, non-string, over-limit, and UTF-8 byte overflow text", () => {
  for (const value of ["", " \r\n ", 42]) {
    assert.throws(
      () => normalizeAIText(value, 100),
      (error: unknown) =>
        error instanceof AIServiceError && error.code === "AI_INPUT_INVALID",
    );
  }
  assert.throws(
    () => normalizeAIText("abc", 2),
    (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_TOO_LARGE",
  );
  assert.throws(
    () => normalizeAIText("ق", 1),
    (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_TOO_LARGE",
  );
});

test("prepares text in memory with a genuine text content part and no staged file", async () => {
  await withInputService(async (service, root) => {
    const prepared = await service.prepare({
      kind: "text",
      text: "  سؤال طبي\nA. نعم\nB. لا  ",
    });
    assert.equal(prepared.input.kind, "text");
    assert.equal(prepared.contents[0]?.kind, "text");
    assert.equal(prepared.contents[0]?.source.inputType, "text");
    await prepared.dispose();
    await assert.rejects(readFile(root));
  });
});

test("accepts a signed PDF, sanitizes its display name, hashes, stages, and disposes idempotently", async () => {
  await withInputService(async (service, root) => {
    const prepared = await service.prepare({
      kind: "pdf",
      file: {
        bytes: PDF,
        claimedMimeType: "application/pdf",
        originalFilename: "../../محاضرة\u0000.pdf",
      },
    });
    assert.equal(prepared.input.kind, "pdf");
    if (prepared.input.kind !== "pdf") assert.fail("Expected PDF input.");
    const pdf = prepared.input.pdf;
    assert.equal(pdf.displayName, "محاضرة.pdf");
    assert.equal(pdf.mimeType, "application/pdf");
    assert.equal(pdf.sha256, sha256Bytes(PDF));
    assert.equal(pdf.source.page, undefined);
    assert.equal(pdf.fileSource.kind, "staged_file");
    if (pdf.fileSource.kind !== "staged_file") assert.fail("Expected staged PDF.");
    const stagedBytes = await pdf.fileSource.capability.readBytes();
    assert.deepEqual(Buffer.from(stagedBytes), PDF);
    await pdf.fileSource.capability.withPath(async (path) => {
      assert.equal(path.startsWith(`${root}/`), true);
      assert.equal(path.includes("محاضرة"), false);
      assert.deepEqual(await readFile(path), PDF);
    });
    await prepared.dispose();
    await assert.rejects(pdf.fileSource.capability.readBytes);
    await prepared.dispose();
  });
});

test("rejects fake PDF bytes, wrong PDF MIME, and oversized PDF before use", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-input-test-"));
  const service = new AIInputService(
    { maxPdfBytes: PDF.byteLength - 1 },
    new AITemporaryFileManager(root),
  );
  try {
    await assert.rejects(service.prepare({
      kind: "pdf",
      file: { bytes: PDF, claimedMimeType: "application/pdf", originalFilename: "x.pdf" },
    }), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_TOO_LARGE"
    );
    await assert.rejects(service.prepare({
      kind: "pdf",
      file: { bytes: Buffer.from("MZ fake"), claimedMimeType: "application/pdf" },
    }), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_INVALID"
    );
    await assert.rejects(service.prepare({
      kind: "pdf",
      file: { bytes: PDF, claimedMimeType: "image/jpeg" },
    }), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_INVALID"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects JPEG, PNG, and WebP signatures", () => {
  assert.equal(detectAIBinaryMimeType(JPEG), "image/jpeg");
  assert.equal(detectAIBinaryMimeType(PNG), "image/png");
  assert.equal(detectAIBinaryMimeType(WEBP), "image/webp");
  assert.equal(detectAIBinaryMimeType(HEIC), null);
  assert.equal(detectAIBinaryMimeType(HEIF), null);
  assert.equal(detectAIBinaryMimeType(ftyp("mif1", ["heic"])), null);
  assert.equal(detectAIBinaryMimeType(Buffer.from([0, 0, 0, 40, ...HEIC.subarray(4)])), null);
  assert.equal(detectAIBinaryMimeType(Buffer.from("MZ executable")), null);
});

test("multiple images preserve order, receive indexes, use unique names, and clean up", async () => {
  await withInputService(async (service, root) => {
    const prepared = await service.prepare({
      kind: "image",
      files: [
        { bytes: JPEG, claimedMimeType: "image/jpg", originalFilename: "../one.jpg" },
        { bytes: PNG, claimedMimeType: "image/png", originalFilename: "/tmp/two.png" },
        { bytes: WEBP, claimedMimeType: "image/webp", originalFilename: "three.webp" },
      ],
    });
    assert.equal(prepared.input.kind, "image");
    if (prepared.input.kind !== "image") assert.fail("Expected image input.");
    assert.deepEqual(prepared.input.images.map((image) => image.imageIndex), [0, 1, 2]);
    assert.deepEqual(
      prepared.input.images.map((image) => image.displayName),
      ["one.jpg", "two.png", "three.webp"],
    );
    assert.deepEqual(
      prepared.input.images.map((image) => image.mimeType),
      ["image/jpeg", "image/png", "image/webp"],
    );
    const paths = prepared.input.images.map((image) => {
      if (image.fileSource.kind !== "staged_file") assert.fail("Expected staged image.");
      return image.fileSource.capability;
    });
    assert.equal(new Set(paths).size, 3);
    await Promise.all(paths.map((capability) => capability.withPath(async (path) => {
      assert.equal(path.startsWith(`${root}/`), true);
    })));
    await prepared.dispose();
    await Promise.all(paths.map((capability) => assert.rejects(capability.readBytes)));
    await prepared.dispose();
  });
});

test("rejects HEIC and HEIF because this runtime cannot decode them reliably", async () => {
  await withInputService(async (service) => {
    await assert.rejects(
      service.prepare({
        kind: "image",
        files: [{ bytes: HEIC, claimedMimeType: "image/heic", originalFilename: "phone.heic" }],
      }),
      (error: unknown) => error instanceof AIServiceError && error.code === "AI_INPUT_UNSUPPORTED",
    );
  });
});

test("rejects zero images, too many images, oversized images, fake images, unsupported files, and local paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-input-test-"));
  const service = new AIInputService(
    { maxImageCount: 1, maxImageBytes: JPEG.byteLength - 1 },
    new AITemporaryFileManager(root),
  );
  try {
    await assert.rejects(service.prepare({ kind: "image", files: [] }));
    await assert.rejects(service.prepare({
      kind: "image",
      files: [
        { bytes: PNG, claimedMimeType: "image/png" },
        { bytes: PNG, claimedMimeType: "image/png" },
      ],
    }), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_TOO_LARGE"
    );
    await assert.rejects(service.prepare({
      kind: "image",
      files: [{ bytes: JPEG, claimedMimeType: "image/jpeg" }],
    }), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_TOO_LARGE"
    );

    const normalLimits = new AIInputService({}, new AITemporaryFileManager(root));
    await assert.rejects(normalLimits.prepare({
      kind: "image",
      files: [{ bytes: Buffer.from("MZ executable"), claimedMimeType: "image/jpeg" }],
    }), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_INVALID"
    );
    await assert.rejects(normalLimits.prepare({
      kind: "image",
      files: [{ bytes: PNG, claimedMimeType: "application/zip" }],
    }), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_UNSUPPORTED"
    );
    await assert.rejects(normalLimits.prepare({
      kind: "pdf",
      file: {
        path: "/etc/passwd",
        claimedMimeType: "application/pdf",
      },
    } as never), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_INVALID"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("guarantees cleanup when prepared work throws or is cancelled", async () => {
  await withInputService(async (service) => {
    let stagedPath = "";
    await assert.rejects(service.withPreparedInput({
      kind: "pdf",
      file: { bytes: PDF, claimedMimeType: "application/pdf" },
    }, async (prepared) => {
      if (prepared.input.kind !== "pdf") assert.fail("Expected PDF input.");
      if (prepared.input.pdf.fileSource.kind !== "staged_file") {
        assert.fail("Expected staged PDF.");
      }
      await prepared.input.pdf.fileSource.capability.withPath(async (path) => {
        stagedPath = path;
      });
      throw new Error("provider failed");
    }), /provider failed/);
    await assertMissing(stagedPath);
  });
});

test("staging identifiers do not collide across concurrent inputs", async () => {
  await withInputService(async (service) => {
    const [first, second] = await Promise.all([
      service.prepare({
        kind: "pdf",
        file: { bytes: PDF, claimedMimeType: "application/pdf", originalFilename: "same.pdf" },
      }),
      service.prepare({
        kind: "pdf",
        file: { bytes: PDF, claimedMimeType: "application/pdf", originalFilename: "same.pdf" },
      }),
    ]);
    if (first.input.kind !== "pdf" || second.input.kind !== "pdf") {
      assert.fail("Expected PDF inputs.");
    }
    if (
      first.input.pdf.fileSource.kind !== "staged_file" ||
      second.input.pdf.fileSource.kind !== "staged_file"
    ) {
      assert.fail("Expected staged PDFs.");
    }
    const firstPath = await first.input.pdf.fileSource.capability.withPath(async (path) => path);
    const secondPath = await second.input.pdf.fileSource.capability.withPath(async (path) => path);
    assert.notEqual(firstPath, secondPath);
    await Promise.all([first.dispose(), second.dispose()]);
  });
});

test("configured limits cannot exceed hard ceilings", () => {
  assert.deepEqual(resolveAIInputLimits({
    maxPdfBytes: Number.MAX_SAFE_INTEGER,
    maxImageBytes: Number.MAX_SAFE_INTEGER,
    maxImageCount: Number.MAX_SAFE_INTEGER,
    maxTextBytes: Number.MAX_SAFE_INTEGER,
  }), AI_INPUT_HARD_LIMITS);
});

test("strict runtime intake rejects mixed modes and malformed MIME metadata", async () => {
  await withInputService(async (service) => {
    await assert.rejects(service.prepare({
      kind: "text",
      text: "valid",
      file: { bytes: PDF, claimedMimeType: "application/pdf" },
    } as never), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_INVALID"
    );
    await assert.rejects(service.prepare({
      kind: "pdf",
      file: { bytes: PDF, claimedMimeType: 42 },
    } as never), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_INVALID"
    );
    await assert.rejects(service.prepare({
      kind: "image",
      files: [{ bytes: JPEG, claimedMimeType: "image/png" }],
    }), (error: unknown) =>
      error instanceof AIServiceError && error.code === "AI_INPUT_INVALID"
    );
  });
});

test("partial multi-image validation failure cleans every staged file", async () => {
  await withInputService(async (service, root) => {
    await assert.rejects(service.prepare({
      kind: "image",
      files: [
        { bytes: JPEG, claimedMimeType: "image/jpeg" },
        { bytes: Buffer.from("not png"), claimedMimeType: "image/png" },
      ],
    }));
    assert.deepEqual(await readdir(root), []);
  });
});

test("cleanup failures use the AI error model without exposing local paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-input-test-"));
  class FailingCleanupManager extends AITemporaryFileManager {
    override async stage(bytes: Uint8Array) {
      const staged = await super.stage(bytes);
      return {
        ...staged,
        dispose: async () => {
          await staged.dispose();
          throw new AIServiceError("AI_INPUT_CLEANUP_FAILED", {
            publicMessage: "Temporary AI input cleanup failed.",
            diagnosticMessage: "Injected cleanup failure.",
          });
        },
      };
    }
  }
  const service = new AIInputService({}, new FailingCleanupManager(root));
  try {
    await assert.rejects(service.withPreparedInput({
      kind: "pdf",
      file: { bytes: PDF, claimedMimeType: "application/pdf" },
    }, async () => "valid result"), (error: unknown) =>
      error instanceof AIServiceError &&
      error.code === "AI_INPUT_CLEANUP_FAILED" &&
      !error.publicMessage.includes(root)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("consumer mutation cannot redirect cleanup outside the temporary root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "ai-input-test-"));
  const root = join(parent, "root");
  const sentinel = join(parent, "sentinel");
  await writeFile(sentinel, "keep");
  const manager = new AITemporaryFileManager(root);
  try {
    const staged = await manager.stage(PDF);
    const actualPath = staged.path;
    (staged as { path: string }).path = sentinel;
    await staged.dispose();
    await assertMissing(actualPath);
    assert.equal(await readFile(sentinel, "utf8"), "keep");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});