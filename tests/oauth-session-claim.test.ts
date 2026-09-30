import assert from "node:assert/strict";
import test from "node:test";
import { claimOAuthSessionRecord } from "../server/services/oauthSessionClaim.js";

function makeStore(initial: Record<string, unknown>) {
  let storedValue = JSON.stringify(initial);
  return {
    get storedValue() {
      return storedValue;
    },
    systemSetting: {
      async updateMany(args: {
        where: { key: string; value: string };
        data: { value: string; updatedAt: Date };
      }) {
        if (storedValue !== args.where.value) return { count: 0 };
        storedValue = args.data.value;
        return { count: 1 };
      },
    },
  };
}

test("only one concurrent request can claim the same OAuth authorization code", async () => {
  const session = {
    provider: "google",
    authorizationCode: "one-time-code",
    codeChallenge: "challenge",
    expiresAt: 20_000,
  };
  const store = makeStore(session);
  const args = {
    systemSetting: store.systemSetting,
    key: "__oauth_session__:state",
    session,
    storedValue: store.storedValue,
    now: 10_000,
  };

  const claims = await Promise.all([
    claimOAuthSessionRecord(args),
    claimOAuthSessionRecord(args),
  ]);

  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(JSON.parse(store.storedValue).processing, true);
});

test("an expired processing lease can be reclaimed, but an expired session cannot", async () => {
  const staleSession = {
    provider: "google",
    authorizationCode: "one-time-code",
    expiresAt: 30_000,
    processing: true,
    processingUntil: 9_000,
  };
  const store = makeStore(staleSession);
  const reclaimed = await claimOAuthSessionRecord({
    systemSetting: store.systemSetting,
    key: "__oauth_session__:state",
    session: staleSession,
    storedValue: store.storedValue,
    now: 10_000,
  });
  assert.equal(reclaimed?.processingUntil, 70_000);

  const expired = await claimOAuthSessionRecord({
    systemSetting: store.systemSetting,
    key: "__oauth_session__:expired",
    session: { expiresAt: 9_999 },
    storedValue: JSON.stringify({ expiresAt: 9_999 }),
    now: 10_000,
  });
  assert.equal(expired, null);
});