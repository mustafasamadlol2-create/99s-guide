const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const server = read('server.ts');
const logger = read('server/services/logger.ts');
const authScreen = read('src/features/auth/components/AuthScreen.tsx');
const app = read('src/App.tsx');

test('production Google and Apple callbacks are pinned to the canonical Render origin', () => {
  assert.match(server, /provider === "google" \|\| provider === "apple"/);
  assert.match(server, /\? PRODUCTION_BACKEND_ORIGIN\s*:\s*backendOrigin\(req\)/);
});

test('Google PKCE exchange is serialized and emits safe provider diagnostics', () => {
  assert.match(server, /const googleOAuthExchangeInFlight = new Set<string>\(\)/);
  assert.match(server, /googleOAuthExchangeInFlight\.has\(token\)/);
  assert.match(server, /GOOGLE_TOKEN_EXCHANGE_FAILED/);
  assert.match(server, /parseOAuthProviderErrorCode\(providerBody\)/);
  assert.match(server, /providerError === "invalid_grant"/);
  assert.match(server, /authorizationCode === "google:server-exchanged"/);
});

test('Apple returning users use the stable provider subject and first login persists OAuthIdentity', () => {
  assert.match(server, /const appleSubject = typeof decodedToken\?\.sub === "string"/);
  assert.match(server, /providerSubject: appleSubject/);
  assert.match(server, /let finalUser = linkedUser/);
  assert.match(server, /APPLE_VERIFIED_EMAIL_REQUIRED/);
  assert.match(server, /prisma\.oAuthIdentity\.create\(/);
  assert.match(server, /setCookieToken\(res, finalUser\.id, finalUser\.email, finalUser\.sessionVersion\)/);
  assert.match(server, /userId: finalUser\.id,\s*email: finalUser\.email,/s);
});

test('structured logger preserves redacted Apple diagnostics', () => {
  assert.match(logger, /appleAuth: meta\.appleAuth/);
  assert.match(logger, /redactLogValue\(meta\.appleAuth\)/);
});

test('terminal OAuth 502 failures are not blindly retried forever', () => {
  const authMatches = authScreen.match(/status === 502 && err\?\.body\?\.retryable === true/g) || [];
  assert.ok(authMatches.length >= 2, `expected >=2 guarded 502 checks in AuthScreen, got ${authMatches.length}`);
  assert.match(app, /status === 502 && err\?\.body\?\.retryable === true/);
  assert.doesNotMatch(authScreen, /\[404, 429, 502, 503\]\.includes\(err\.status\)/);
  assert.doesNotMatch(app, /\[404, 429, 502, 503\]\.includes\(status\)/);
});
