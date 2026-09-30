import assert from "node:assert/strict";
import test from "node:test";
import { buildOAuthRedirectUri } from "../server/services/oauthRedirect.js";

const PRODUCTION_BACKEND_ORIGIN = "https://nine9s-guide.onrender.com";

test("Google development callback uses the Replit preview domain", () => {
  let backendOriginResolved = false;
  const redirectUri = buildOAuthRedirectUri({
    provider: "google",
    nodeEnv: "development",
    replitDevDomain: "test-repl.pike.replit.dev",
    productionBackendOrigin: PRODUCTION_BACKEND_ORIGIN,
    resolveBackendOrigin: () => {
      backendOriginResolved = true;
      return PRODUCTION_BACKEND_ORIGIN;
    },
  });

  assert.equal(
    redirectUri,
    "https://test-repl.pike.replit.dev/auth/callback/google",
  );
  assert.equal(backendOriginResolved, false);
});

test("Google production callback remains pinned to the Render backend", () => {
  const redirectUri = buildOAuthRedirectUri({
    provider: "google",
    nodeEnv: "production",
    replitDevDomain: "test-repl.pike.replit.dev",
    productionBackendOrigin: PRODUCTION_BACKEND_ORIGIN,
    resolveBackendOrigin: () => "https://unexpected.example.test",
  });

  assert.equal(
    redirectUri,
    `${PRODUCTION_BACKEND_ORIGIN}/auth/callback/google`,
  );
});

test("non-Google provider callbacks keep using the configured backend origin", () => {
  const redirectUri = buildOAuthRedirectUri({
    provider: "apple",
    nodeEnv: "development",
    replitDevDomain: "test-repl.pike.replit.dev",
    productionBackendOrigin: PRODUCTION_BACKEND_ORIGIN,
    resolveBackendOrigin: () => "https://dev-backend.example.test/",
  });

  assert.equal(
    redirectUri,
    "https://dev-backend.example.test/auth/callback/apple",
  );
});

test("invalid Replit domains fail instead of generating an unsafe callback", () => {
  assert.throws(
    () =>
      buildOAuthRedirectUri({
        provider: "google",
        nodeEnv: "development",
        replitDevDomain: "http://test-repl.pike.replit.dev/path",
        productionBackendOrigin: PRODUCTION_BACKEND_ORIGIN,
        resolveBackendOrigin: () => PRODUCTION_BACKEND_ORIGIN,
      }),
    /valid HTTPS origin/u,
  );
});