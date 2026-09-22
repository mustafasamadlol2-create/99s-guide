import assert from "node:assert/strict";
import test from "node:test";
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
  abortResourceMultipartUpload,
  completeResourceMultipartUpload,
  createResourceMultipartUpload,
  createResourcePartUrl,
  deleteResourceObject,
  listResourceMultipartParts,
  verifyResourceObject,
} from "../server/services/resourceMultipartStorage.js";
import {
  RESOURCE_MULTIPART_PART_SIZE_BYTES,
  RESOURCE_MULTIPART_URL_TTL_SECONDS,
} from "../shared/resourceMultipart.js";

process.env.R2_ENDPOINT ||= "https://r2.prompt31b.test";
process.env.R2_ACCESS_KEY_ID ||= "prompt31b-test-access";
process.env.R2_SECRET_ACCESS_KEY ||= "prompt31b-test-secret";
process.env.R2_BUCKET_NAME ||= "prompt31b-test-bucket";

type MockState = {
  createInput?: Record<string, unknown>;
  completeInput?: Record<string, unknown>;
  abortInput?: Record<string, unknown>;
  deleteInput?: Record<string, unknown>;
  listInputs: Record<string, unknown>[];
  pages: Array<{
    Parts: Array<{ PartNumber: number; ETag: string; Size: number }>;
    IsTruncated?: boolean;
    NextPartNumberMarker?: string;
  }>;
  headSize: number;
  headContentType: string;
  headerBytes: Uint8Array;
};

function createMockState(): MockState {
  return {
    listInputs: [],
    pages: [],
    headSize: 0,
    headContentType: "application/pdf",
    headerBytes: new TextEncoder().encode("%PDF-1.7\n"),
  };
}

const originalSend = S3Client.prototype.send;
let state = createMockState();

function installMock(): void {
  (S3Client.prototype as any).send = async function send(command: any) {
    const input = command.input as Record<string, unknown>;
    if (command instanceof CreateMultipartUploadCommand) {
      state.createInput = input;
      return { UploadId: "upload-1" };
    }
    if (command instanceof ListPartsCommand) {
      state.listInputs.push(input);
      const pageIndex = input.PartNumberMarker === "marker-1" ? 1 : 0;
      return state.pages[pageIndex] ?? { Parts: [], IsTruncated: false };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      state.completeInput = input;
      return {};
    }
    if (command instanceof AbortMultipartUploadCommand) {
      state.abortInput = input;
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      state.deleteInput = input;
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      return {
        ContentLength: state.headSize,
        ContentType: state.headContentType,
      };
    }
    if (command instanceof GetObjectCommand) {
      assert.equal(input.Range, "bytes=0-1023");
      return {
        Body: {
          transformToByteArray: async () => state.headerBytes,
        },
      };
    }
    throw new Error(`Unexpected S3 command ${command.constructor.name}`);
  };
}

test.beforeEach(() => {
  state = createMockState();
  installMock();
});

test.after(() => {
  S3Client.prototype.send = originalSend;
});

test("creates multipart uploads with a server-owned PDF object contract", async () => {
  const uploadId = await createResourceMultipartUpload("materials/lecture-1/session-1.pdf");
  assert.equal(uploadId, "upload-1");
  assert.deepEqual(state.createInput, {
    Bucket: "prompt31b-test-bucket",
    Key: "materials/lecture-1/session-1.pdf",
    ContentType: "application/pdf",
    ContentDisposition: "inline",
    CacheControl: "private, max-age=3600",
  });
  await assert.rejects(
    () => createResourceMultipartUpload("../../other-user/file.pdf"),
    /Invalid storage path/,
  );
});

test("presigns only the requested server-owned part with the bounded TTL", async () => {
  const signed = await createResourcePartUrl(
    "materials/lecture-1/session-1.pdf",
    "upload-1",
    7,
  );
  const parsed = new URL(signed);
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), String(RESOURCE_MULTIPART_URL_TTL_SECONDS));
  assert.equal(parsed.searchParams.get("partNumber"), "7");
  assert.equal(parsed.searchParams.get("uploadId"), "upload-1");
  assert.match(parsed.pathname, /materials%2Flecture-1%2Fsession-1\.pdf|materials\/lecture-1\/session-1\.pdf/);
});

test("follows paginated ListParts responses and preserves provider ETags and sizes", async () => {
  state.pages = [
    {
      Parts: [
        { PartNumber: 1, ETag: "\"etag-1\"", Size: RESOURCE_MULTIPART_PART_SIZE_BYTES },
      ],
      IsTruncated: true,
      NextPartNumberMarker: "marker-1",
    },
    {
      Parts: [{ PartNumber: 2, ETag: "\"etag-2\"", Size: 123 }],
      IsTruncated: false,
    },
  ];
  const parts = await listResourceMultipartParts("materials/lecture-1/session-1.pdf", "upload-1");
  assert.deepEqual(parts, [
    { partNumber: 1, etag: "\"etag-1\"", sizeBytes: RESOURCE_MULTIPART_PART_SIZE_BYTES },
    { partNumber: 2, etag: "\"etag-2\"", sizeBytes: 123 },
  ]);
  assert.deepEqual(state.listInputs.map((input) => input.PartNumberMarker), [undefined, "marker-1"]);
});

test("rejects a truncated ListParts response without a continuation marker", async () => {
  state.pages = [{ Parts: [], IsTruncated: true }];
  await assert.rejects(
    () => listResourceMultipartParts("materials/lecture-1/session-1.pdf", "upload-1"),
    /continuation marker/,
  );
});

test("completion sends the provider part list and never invents client metadata", async () => {
  const providerParts = [
    { partNumber: 1, etag: "\"provider-one\"", sizeBytes: 32 },
    { partNumber: 2, etag: "\"provider-two\"", sizeBytes: 8 },
  ];
  await completeResourceMultipartUpload("materials/lecture-1/session-1.pdf", "upload-1", providerParts);
  assert.deepEqual(state.completeInput, {
    Bucket: "prompt31b-test-bucket",
    Key: "materials/lecture-1/session-1.pdf",
    UploadId: "upload-1",
    MultipartUpload: {
      Parts: [
        { PartNumber: 1, ETag: "\"provider-one\"" },
        { PartNumber: 2, ETag: "\"provider-two\"" },
      ],
    },
  });
});

test("verification performs exact HeadObject and bounded PDF range validation", async () => {
  state.headSize = 17;
  const verified = await verifyResourceObject("materials/lecture-1/session-1.pdf", 17);
  assert.equal(verified.sizeBytes, 17);
  assert.equal(verified.contentType, "application/pdf");
  assert.equal(new TextDecoder().decode(verified.headerBytes), "%PDF-1.7\n");

  state.headSize = 16;
  await assert.rejects(
    () => verifyResourceObject("materials/lecture-1/session-1.pdf", 17),
    /size does not match/,
  );
});

test("abort and cleanup use the same server-owned bucket and key", async () => {
  await abortResourceMultipartUpload("materials/lecture-1/session-1.pdf", "upload-1");
  await deleteResourceObject("materials/lecture-1/session-1.pdf");
  assert.deepEqual(state.abortInput, {
    Bucket: "prompt31b-test-bucket",
    Key: "materials/lecture-1/session-1.pdf",
    UploadId: "upload-1",
  });
  assert.deepEqual(state.deleteInput, {
    Bucket: "prompt31b-test-bucket",
    Key: "materials/lecture-1/session-1.pdf",
  });
});