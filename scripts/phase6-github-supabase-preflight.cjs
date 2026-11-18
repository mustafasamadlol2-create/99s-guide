#!/usr/bin/env node
"use strict";
/**
 * Safe, read-only database preflight for GitHub Actions.
 * Never prints URL, username, password, network address, SQL, or raw DB errors.
 * No production writes and no access to DIRECT_URL.
 */
const { lookup } = require('node:dns/promises');
const { createConnection } = require('node:net');

function stop(code, note) {
  console.error(`[Phase6 DB preflight] FAIL ${code}: ${note}`);
  process.exitCode = 1;
}
function chooseErrorCode(error) {
  for (const value of [error?.code, error?.errorCode, error?.meta?.code]) {
    if (typeof value === 'string' && /^P\d{4}$/.test(value)) return value;
  }
  return null;
}
function kind(error) {
  const pg = chooseErrorCode(error);
  const msg = String(error?.message ?? '');
  if (pg === 'P1000' || /authentication failed|password authentication failed|authentication credentials.*not valid/i.test(msg)) return 'DB_AUTH_FAILED';
  if (pg === 'P1010' || /permission denied|access denied/i.test(msg)) return 'DB_ACCESS_DENIED';
  if (pg === 'P1013' || /invalid database string|invalid connection string|invalid port/i.test(msg)) return 'DB_URL_INVALID';
  if (pg === 'P1011' || /tls handshake|ssl.*error|certificate.*verify/i.test(msg)) return 'DB_TLS_FAILED';
  if (pg === 'P1001' || /can't reach database server|could not connect/i.test(msg)) return 'DB_SERVER_UNREACHABLE';
  if (pg === 'P1002' || /timed out|timeout/i.test(msg)) return 'DB_TIMEOUT';
  if (pg === 'P1017' || /server has closed the connection|connection (?:closed|reset|terminated)/i.test(msg)) return 'DB_CONNECTION_CLOSED';
  if (pg === 'P2024') return 'DB_POOL_TIMEOUT';
  if (/query engine|binary|openssl.*not found|libssl|incompatible.*platform/i.test(msg)) return 'PRISMA_ENGINE_ERROR';
  return pg ? `PRISMA_${pg}` : 'DB_INITIALIZATION_UNKNOWN';
}
async function tcpProbe(host, port, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const socket = createConnection({host, port});
    let done = false;
    const finish = (error) => {
      if (done) return; done = true;
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.once('connect', () => finish());
    socket.once('error', finish);
    socket.setTimeout(timeoutMs, () => finish(Object.assign(new Error('timeout'), {code:'ETIMEDOUT'})));
  });
}
async function main() {
  const raw = process.env.SUPABASE_DATABASE_URL;
  if (!raw) return stop('MISSING_SUPABASE_DATABASE_URL', 'The repository secret is empty or unavailable to this run.');
  if (raw !== raw.trim()) return stop('URL_HAS_EXTRA_WHITESPACE', 'Copy the complete connection string without extra spaces/newlines.');
  let parsed;
  try { parsed = new URL(raw); } catch { return stop('DB_URL_MALFORMED', 'The secret is not a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return stop('DB_URL_WRONG_PROTOCOL', 'Expected postgresql:// or postgres://.');
  if (!parsed.hostname || !parsed.username || !parsed.password || !parsed.pathname || parsed.pathname === '/') {
    return stop('DB_URL_MISSING_COMPONENT', 'A PostgreSQL URL must include hostname, username, password, and database name.');
  }
  if (parsed.hash) return stop('DB_URL_FRAGMENT', 'A # in a raw password must be percent-encoded, not treated as URL fragment.');
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return stop('DB_URL_BAD_PORT', 'Invalid PostgreSQL port.');
  const endpoint = parsed.hostname.includes('pooler.supabase.com') ? 'Supabase pooler' : parsed.hostname.endsWith('.supabase.co') ? 'Supabase direct endpoint' : 'other host';
  console.log(`[Phase6 DB preflight] URL format OK; endpoint=${endpoint}; port=${port}; credentials=present (not printed).`);
  if (!parsed.hostname.includes('pooler.supabase.com')) {
    console.warn('[Phase6 DB preflight] NOTE: GitHub Linux runners may lack IPv6 connectivity; prefer the Supabase IPv4-compatible pooler connection string when direct access cannot connect.');
  }
  if (process.argv.includes('--validate-only')) {
    console.log('[Phase6 DB preflight] VALIDATION_ONLY PASS; network and authentication not tested.');
    return;
  }
  try {
    await lookup(parsed.hostname, {all: true});
    console.log('[Phase6 DB preflight] DNS PASS.');
  } catch {
    return stop('DB_DNS_FAILED', 'Hostname did not resolve on the GitHub runner; check the secret hostname.');
  }
  try {
    await tcpProbe(parsed.hostname, port, 10000);
    console.log('[Phase6 DB preflight] TCP PASS.');
  } catch (error) {
    const code = error?.code === 'ETIMEDOUT' ? 'DB_TCP_TIMEOUT' : 'DB_TCP_UNREACHABLE';
    return stop(code, 'Network connection failed; check Supabase Network Restrictions and whether the URL uses an IPv4-compatible pooler.');
  }
  // The diagnostic is a separate read-only process. Never wait indefinitely
  // when the database responds to TCP but stalls during Prisma negotiation.
  const watchdog = setTimeout(() => {
    stop('DB_PRISMA_TIMEOUT', 'Connection/authentication/read did not finish in 30 seconds.');
    process.exit(1);
  }, 30000);
  watchdog.unref();
  let prisma;
  try {
    // Use the identical URL supplied to the scheduled job. Explicit datasource
    // override avoids using a local .env or another DATABASE_URL accidentally.
    const {PrismaClient} = require('@prisma/client');
    prisma = new PrismaClient({datasources: {db: {url: raw}}});
    await prisma.$connect();
    await prisma.user.findFirst({select: {id: true}});
    console.log('[Phase6 DB preflight] PRISMA_CONNECT_AND_USER_READ PASS. No writes.');
  } catch (error) {
    stop(kind(error), `Database access failed (${chooseErrorCode(error) || 'no Prisma code'}). Never share credentials or the connection URL.`);
  } finally {
    clearTimeout(watchdog);
    if (prisma) {
      try { await prisma.$disconnect(); } catch { /* no secrets in logging */ }
    }
  }
}
main().catch(error => stop(kind(error), 'Unexpected database preflight failure; credentials and raw error deliberately hidden.'));
