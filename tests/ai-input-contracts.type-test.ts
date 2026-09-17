import type { AIContentPart } from "../server/services/ai/input/contracts.js";

const validPdf: AIContentPart = {
  kind: "file",
  inputType: "pdf",
  mimeType: "application/pdf",
  fileSource: {
    kind: "existing_resource",
    resourceId: "lecture",
    ownership: "borrowed",
  },
  source: { inputType: "pdf", page: 1 },
  sizeBytes: 1,
  sha256: "a".repeat(64),
};

const validImage: AIContentPart = {
  kind: "file",
  inputType: "image",
  mimeType: "image/png",
  fileSource: {
    kind: "staged_file",
    capability: {
      sizeBytes: 1,
      readBytes: async () => new Uint8Array([1]),
      withPath: async (operation) => operation("/controlled/temp/id"),
    },
    ownership: "owned_transient",
  },
  source: { inputType: "image", imageIndex: 0 },
  sizeBytes: 1,
  sha256: "b".repeat(64),
};

// @ts-expect-error A PDF part cannot use an image MIME type.
const invalidPdfMime: AIContentPart = { ...validPdf, mimeType: "image/png" };
// @ts-expect-error An image part must carry image source metadata.
const invalidImageSource: AIContentPart = {
  ...validImage,
  source: { inputType: "pdf" },
};
const invalidTextSource: AIContentPart = {
  kind: "text",
  text: "source",
  // @ts-expect-error A text part cannot carry image source metadata.
  source: { inputType: "image", imageIndex: 0 },
  sizeBytes: 1,
  sha256: "c".repeat(64),
};

void [validPdf, validImage, invalidPdfMime, invalidImageSource, invalidTextSource];