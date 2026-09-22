const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function fail(message, details) {
  console.error(`[STARTUP] ${message}`);
  if (details) console.error(details);
  process.exit(1);
}

if (!process.env.DATABASE_URL || !String(process.env.DATABASE_URL).trim()) {
  fail('DATABASE_URL is required before production can start.');
}

// Supabase projects commonly expose a pooled DATABASE_URL plus a direct URL.
// Prisma migrate deploy needs a usable directUrl because schema.prisma declares
// one. If Render only has DATABASE_URL, using it as the migration directUrl is a
// safe fallback and avoids leaving newly added tables unapplied.
if (!process.env.DIRECT_URL || !String(process.env.DIRECT_URL).trim()) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  console.warn('[STARTUP] DIRECT_URL is not set; using DATABASE_URL for Prisma migrations.');
}

const prismaCli = path.resolve(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');
if (!fs.existsSync(prismaCli)) {
  fail('The local Prisma CLI is unavailable. Run npm install before starting production.');
}

console.log('[STARTUP] Applying pending Prisma migrations...');
const migration = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});

if (migration.error) fail('Prisma migration process could not start.', migration.error);
if (migration.status !== 0) {
  fail(`Prisma migrations failed with exit code ${migration.status ?? 'unknown'}. The API was not started against an outdated schema.`);
}

console.log('[STARTUP] Prisma schema is ready. Starting API server...');
require(path.resolve(__dirname, '..', 'dist', 'server.cjs'));
