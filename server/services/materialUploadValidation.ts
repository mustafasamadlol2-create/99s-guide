import { buildMaterialStoragePath } from "./supabaseStorage.js";

const PDF_SIGNATURE = "%PDF-";

/**
 * Resource uploads currently support PDF-backed materials. This deliberately
 * validates the binary signature rather than trusting the browser MIME type.
 */
export function isValidResourcePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_SIGNATURE.length) return false;
  return Buffer.from(bytes.subarray(0, PDF_SIGNATURE.length)).toString("ascii") === PDF_SIGNATURE;
}

export class InvalidResourcePdfError extends Error {
  constructor() {
    super("The uploaded file is not a valid PDF.");
    this.name = "InvalidResourcePdfError";
  }
}

export async function uploadValidatedResourcePdf(options: {
  lectureId: string;
  materialId: string;
  bytes: Buffer;
  upload: (storagePath: string, bytes: Buffer) => Promise<void>;
}): Promise<{ storagePath: string; fileUrlOrLink: string }> {
  if (!isValidResourcePdf(options.bytes)) throw new InvalidResourcePdfError();
  const storagePath = buildMaterialStoragePath(options.lectureId, options.materialId);
  await options.upload(storagePath, options.bytes);
  return {
    storagePath,
    fileUrlOrLink: `/api/materials/pdf/${options.materialId}`,
  };
}