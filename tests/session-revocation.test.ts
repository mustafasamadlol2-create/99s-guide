import assert from "node:assert/strict";
import test from "node:test";

import {
  getRevokedSessionKey,
  isRevocationActive,
} from "../server/services/sessionRevocation.ts";

test("hashes revoked sessions into a stable non-secret storage key", () => {
  assert.equal(
    getRevokedSessionKey("test-token"),
    "__revoked_session__:4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e",
  );
});

test("only active revocation records reject a session", () => {
  const now = 1_000;
  assert.equal(isRevocationActive({ expiresAt: 2_000 }, now), true);
  assert.equal(isRevocationActive({ expiresAt: 1_000 }, now), false);
  assert.equal(isRevocationActive(null, now), false);
});
