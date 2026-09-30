import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAuthEndpoint } from "../src/core/api/publicAuthEndpoint.js";

test("public authentication routes never depend on an existing bearer session", () => {
  for (const url of [
    "/api/auth/login",
    "https://api.example.test/api/auth/oauth-url?provider=google",
    "/api/auth/oauth-session/state-token",
    "/api/auth/register",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
  ]) {
    assert.equal(isPublicAuthEndpoint(url), true, url);
  }

  for (const url of [
    "/api/auth/me",
    "/api/users/me",
    "/api/authenticated",
  ]) {
    assert.equal(isPublicAuthEndpoint(url), false, url);
  }
});