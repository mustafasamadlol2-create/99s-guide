import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RESOURCE_PDF_BYTES,
  RESOURCE_MULTIPART_PART_SIZE_BYTES,
  SMALL_RESOURCE_UPLOAD_LIMIT_BYTES,
  expectedResourceMultipartPartCount,
  planResourceMultipartParts,
  shouldUseResourceMultipart,
} from "../shared/resourceMultipart.ts";

test("plans the 5 GiB Resource boundary numerically without allocating file bytes", () => {
  const parts = planResourceMultipartParts(MAX_RESOURCE_PDF_BYTES);
  assert.equal(parts.length, 160);
  assert.equal(parts[0]?.offsetBytes, 0);
  assert.equal(parts[0]?.lengthBytes, RESOURCE_MULTIPART_PART_SIZE_BYTES);
  assert.equal(parts.at(-1)?.lengthBytes, RESOURCE_MULTIPART_PART_SIZE_BYTES);
  assert.equal(parts.at(-1)?.offsetBytes, MAX_RESOURCE_PDF_BYTES - RESOURCE_MULTIPART_PART_SIZE_BYTES);
});

test("plans a 3 GiB Resource boundary with the configured bounded part size", () => {
  const size = 3 * 1024 * 1024 * 1024;
  const parts = planResourceMultipartParts(size);
  assert.equal(expectedResourceMultipartPartCount(size), 96);
  assert.equal(parts.length, 96);
  assert.equal(parts.reduce((sum, part) => sum + part.lengthBytes, 0), size);
});

test("keeps the final multipart part at the exact numeric remainder", () => {
  const size = RESOURCE_MULTIPART_PART_SIZE_BYTES * 2 + 7;
  const parts = planResourceMultipartParts(size);
  assert.deepEqual(parts.map((part) => part.lengthBytes), [
    RESOURCE_MULTIPART_PART_SIZE_BYTES,
    RESOURCE_MULTIPART_PART_SIZE_BYTES,
    7,
  ]);
});

test("keeps normal Resource uploads on the existing path at the threshold", () => {
  assert.equal(SMALL_RESOURCE_UPLOAD_LIMIT_BYTES, 50 * 1024 * 1024);
  assert.equal(expectedResourceMultipartPartCount(0), 0);
  assert.equal(shouldUseResourceMultipart(SMALL_RESOURCE_UPLOAD_LIMIT_BYTES), false);
  assert.equal(shouldUseResourceMultipart(SMALL_RESOURCE_UPLOAD_LIMIT_BYTES + 1), true);
  assert.equal(shouldUseResourceMultipart(MAX_RESOURCE_PDF_BYTES), true);
  assert.equal(shouldUseResourceMultipart(MAX_RESOURCE_PDF_BYTES + 1), false);
});