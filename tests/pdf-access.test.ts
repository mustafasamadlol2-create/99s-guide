import assert from "node:assert/strict";
import test from "node:test";

import {
  createPdfDownloadToken,
  verifyPdfDownloadToken,
} from "../server/services/pdfAccess.ts";

const secret = "pdf-test-secret";
const claims = {
  userId: "user-1",
  email: "student@example.com",
  sessionVersion: 3,
  materialId: "material-1",
};

test("accepts a scoped PDF token for its intended material", () => {
  const token = createPdfDownloadToken(claims, secret);

  assert.deepEqual(verifyPdfDownloadToken(token, claims.materialId, secret), {
    ...claims,
    scope: "pdf-download",
  });
});

test("rejects a scoped PDF token for a different material", () => {
  const token = createPdfDownloadToken(claims, secret);

  assert.equal(verifyPdfDownloadToken(token, "material-2", secret), null);
});

test("rejects a tampered or expired scoped PDF token", () => {
  const token = createPdfDownloadToken(claims, secret, -1);

  assert.equal(verifyPdfDownloadToken(token, claims.materialId, secret), null);
  assert.equal(
    verifyPdfDownloadToken(`${token}tampered`, claims.materialId, secret),
    null,
  );
});
