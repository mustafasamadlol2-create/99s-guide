'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.ts');
const schema = read('prisma/schema.prisma');
const worker = read('public/sw.js');

const checks = [
  ['email is not an owner role source', !server.includes('PRIMARY_OWNER_EMAIL')],
  ['public registration assigns regular users', server.includes('const assignedRole = "user" as const')],
  ['native OAuth uses a POST exchange', server.includes('app.post("/api/auth/oauth-session/:token"')],
  ['Google and Apple OAuth require PKCE', server.includes('(provider === "google" || provider === "apple") && !codeChallenge')],
  ['Google profile requires verified email', server.includes('profile.email_verified !== true') && server.includes('googleProfile.email_verified !== true')],
  ['Google handoff retries without reusing the code', server.includes('authorizationCode === "google:server-exchanged"')],
  ['OAuth polling is browser-bound', server.includes('req.cookies?.oauth_state !== token')],
  ['Apple callback accepts only PKCE-bound cookie-less handoffs', server.includes('isOAuthStateBound(appleState, req.cookies?.oauth_state, appleStateRecord.codeChallenge)')],
  ['Apple redirect returns through the PKCE session handoff', server.includes('isRedirectFlow && appleStateRecord.codeChallenge') && server.includes('buildOAuthPendingQuery(appleState)')],
  ['Q&A votes have a unique user target key', schema.includes('@@unique([userId, targetType, targetId])')],
  ['lecture material responses select metadata', server.includes('materials: { select: { id: true, title: true, type: true, fileUrlOrLink: true')],
  ['service worker bypasses auth routes', worker.includes("url.pathname.startsWith('/auth/')")],
  ['PDF range errors return 416', server.includes('return res.status(416).end()')],
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length > 0) {
  for (const [name] of failures) console.error(`FAIL: ${name}`);
  process.exit(1);
}

console.log(`Security contract checks passed (${checks.length}).`);
