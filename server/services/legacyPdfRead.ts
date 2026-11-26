import type { Prisma, PrismaClient } from "@prisma/client";

type PdfMetadata = {
  type: string;
  title: string;
  storagePath: string | null;
  fileUrlOrLink: string;
  createdAt: Date;
  byteLength: number | null;
  validSignature: boolean | null;
};

type PdfReadOptions = {
  ifNoneMatch?: string;
  range?: string;
  headOnly?: boolean;
};

function parseRange(range: string, total: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(total - suffixLength, 0), end: total - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? total - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= total || end < start) {
    return null;
  }
  return { start, end: Math.min(end, total - 1) };
}

async function readPdfBody(tx: Prisma.TransactionClient, id: string, start: number, length: number) {
  const [row] = await tx.$queryRaw<Array<{ bytes: Uint8Array }>>`
    SELECT substring("fileData" FROM ${start + 1}::int FOR ${length}::int) AS "bytes"
    FROM "Material"
    WHERE "id" = ${id}
  `;
  if (row?.bytes?.byteLength !== length) throw new Error("Incomplete legacy PDF read.");
  return Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
}

export function readLegacyPdf(
  database: Pick<PrismaClient, "$transaction">,
  id: string,
  options: PdfReadOptions,
) {
  // The size, signature and range body must refer to the same row version.
  return database.$transaction(async (tx) => {
    const [material] = await tx.$queryRaw<PdfMetadata[]>`
      SELECT "type", "title", "storagePath", "fileUrlOrLink", "createdAt",
             octet_length("fileData") AS "byteLength",
             substring("fileData" FROM 1 FOR 5) = decode('255044462d', 'hex') AS "validSignature"
      FROM "Material"
      WHERE "id" = ${id}
    `;
    if (!material || !["PDF", "NOTE"].includes(material.type.toUpperCase())) {
      return { kind: "notFound" } as const;
    }
    if (material.byteLength === null) {
      return material.storagePath
        ? { kind: "r2", storagePath: material.storagePath } as const
        : { kind: "local", url: material.fileUrlOrLink } as const;
    }
    if (!material.validSignature) return { kind: "invalidPdf" } as const;

    const total = material.byteLength;
    const etag = `W/"${total}-${material.createdAt?.getTime() || 0}"`;
    if (options.ifNoneMatch === etag) return { kind: "notModified", etag } as const;

    const range = options.range ? parseRange(options.range, total) : undefined;
    const headers = { etag, total, title: material.title };
    if (range === null) return { kind: "invalidRange", ...headers } as const;

    const length = range ? range.end - range.start + 1 : total;
    const body = options.headOnly ? undefined : await readPdfBody(tx, id, range?.start ?? 0, length);
    return { kind: "pdf", ...headers, range, length, body } as const;
  }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 30_000 });
}
