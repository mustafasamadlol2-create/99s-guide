import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOAuthPendingQuery,
  isValidPkceCodeChallenge,
  isOAuthStateBound,
  parseOAuthState,
} from "../server/services/oauthState.js";

test("parses popup, redirect, and native OAuth state markers", () => {
  assert.deepEqual(parseOAuthState("state-1"), { token: "state-1", mode: "popup" });
  assert.deepEqual(parseOAuthState("r:state-2"), { token: "state-2", mode: "redirect" });
  assert.deepEqual(parseOAuthState("i:state-3"), { token: "state-3", mode: "inapp" });
  assert.equal(parseOAuthState("r:"), null);
  assert.equal(parseOAuthState(null), null);
});

test("requires the state cookie unless the server issued a PKCE challenge", () => {
  assert.equal(isOAuthStateBound("state", "state"), true);
  assert.equal(isOAuthStateBound("state", undefined), false);
  assert.equal(isOAuthStateBound("state", undefined, "challenge"), true);
  assert.equal(isOAuthStateBound("state", "other", "challenge"), true);
  assert.equal(isOAuthStateBound("state", undefined, ""), false);
});

test("encodes the state token for redirect recovery", () => {
  assert.equal(
    buildOAuthPendingQuery("state/with?reserved=value"),
    "oauth_pending=1&oauth_state=state%2Fwith%3Freserved%3Dvalue",
  );
});

test("accepts only correctly shaped PKCE code challenges", () => {
  assert.equal(isValidPkceCodeChallenge("a".repeat(43)), true);
  assert.equal(isValidPkceCodeChallenge("a".repeat(128)), true);
  assert.equal(isValidPkceCodeChallenge("a".repeat(42)), false);
  assert.equal(isValidPkceCodeChallenge("a".repeat(43) + "+"), false);
  assert.equal(isValidPkceCodeChallenge(undefined), false);
});
