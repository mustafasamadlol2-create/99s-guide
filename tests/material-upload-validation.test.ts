import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidResourcePdf,
  uploadValidatedResourcePdf,
} from "../server/services/materialUploadValidation.js";

test("resource PDF validation accepts signed PDF bytes without trusting MIME metadata", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF", "ascii");
  assert.equal(isValidResourcePdf(pdf), true);
});

test("resource PDF validation rejects malformed or non-PDF binary", () => {
  assert.equal(isValidResourcePdf(Buffer.from("not a PDF", "ascii")), false);
  assert.equal(isValidResourcePdf(Buffer.from("%PDF", "ascii")), false);
  assert.equal(isValidResourcePdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
});

test("resource upload handoff preserves bytes and calls the backend storage adapter", async () => {
  const pdf = Buffer.from("%PDF-1.7\nresource bytes", "ascii");
  const calls: Array<{ path: string; bytes: Buffer }> = [];
  const result = await uploadValidatedResourcePdf({
    lectureId: "lecture/1",
    materialId: "material-1",
    bytes: pdf,
    upload: async (storagePath, bytes) => {
      calls.push({ path: storagePath, bytes });
    },
  });
  assert.deepEqual(calls, [{
    path: "materials/lecture_1/material-1.pdf",
    bytes: pdf,
  }]);
  assert.deepEqual(result, {
    storagePath: "materials/lecture_1/material-1.pdf",
    fileUrlOrLink: "/api/materials/pdf/material-1",
  });
});

test("invalid resource PDF bytes never reach the storage adapter", async () => {
  let calls = 0;
  await assert.rejects(
    uploadValidatedResourcePdf({
      lectureId: "lecture-1",
      materialId: "material-1",
      bytes: Buffer.from("not a PDF", "ascii"),
      upload: async () => { calls += 1; },
    }),
    /valid PDF/,
  );
  assert.equal(calls, 0);
});