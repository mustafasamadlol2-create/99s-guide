'use strict';
/**
 * predev.cjs — runs automatically before `npm run dev`
 *
 * First run (fresh download / clone):
 *   Detects placeholder or missing credentials, launches an interactive
 *   setup wizard that writes local database settings only, then continues normally.
 *
 * Subsequent runs:
 *   Loads .env and starts the server. Prisma schema synchronization is opt-in.
 *

 */

const fs            = require('fs');
const path          = require('path');
const readline      = require('readline');
const { execFileSync }  = require('child_process');

const ROOT       = path.join(__dirname, '..');
const ENV_PATH   = path.join(ROOT, '.env');
const PRISMA_BIN = path.join(ROOT, 'node_modules', '.bin', 'prisma');

// ── helpers ────────────────────────────────────────────────────────────────
function isPlaceholder(url) {
  if (!url) return true;
  return (
    url.includes('USER:PASSWORD') ||
    url.includes('HOST/DATABASE') ||
    url.includes('PROJECT_REF') ||
    url === 'postgresql://' ||
    url === 'replace_with_a_secure_random_string' ||
    url === 'replace_with_another_secure_random_string'
  );
}

function parseEnv(text) {
  const map = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?\s*$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

function patchEnvFile(patches) {
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  for (const [key, value] of Object.entries(patches)) {
    const escaped = value.replace(/"/g, '\\"');
    const re = new RegExp(`^(${key}=).*$`, 'm');
    if (re.test(text)) {
      text = text.replace(re, `$1"${escaped}"`);
    } else {
      text += `\n${key}="${escaped}"`;
    }
  }
  fs.writeFileSync(ENV_PATH, text, 'utf8');
}

function runPrisma() {
  // Safety guard: prisma db push should never run in a production environment
  // because it applies schema changes instantly without migration history or rollback.
  // Production deployments use `npm start` which bypasses this script entirely,
  // but guard here in case `npm run dev` is accidentally invoked with NODE_ENV=production.
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '\n⚠️  Skipping prisma db push — NODE_ENV is "production".\n' +
      '   Schema changes in production must be applied via prisma migrate deploy.\n'
    );
    return;
  }
  if (process.env.PRISMA_DB_PUSH !== 'true') {
    console.log(
      '\nℹ️  Skipping prisma db push. Set PRISMA_DB_PUSH=true for an explicit local schema sync.\n'
    );
    return;
  }

  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';
  const isLikelySharedDatabase = /supabase|pooler|neon\.tech|render\.com/i.test(dbUrl);
  if (isLikelySharedDatabase && process.env.ALLOW_SHARED_DB_PUSH !== 'true') {
    console.warn(
      '\n⚠️  Refusing prisma db push against a likely shared database.\n' +
      '   Set ALLOW_SHARED_DB_PUSH=true only when this is intentional.\n'
    );
    return;
  }
  try {
    execFileSync(PRISMA_BIN, ['db', 'push'], { stdio: 'inherit', cwd: ROOT, timeout: 60_000, windowsHide: true });
  } catch {
    console.error('\n⚠️  prisma db push failed — check DATABASE_URL in .env\n');
    process.exit(1);
  }
}

// ── Step 1: ensure .env exists ─────────────────────────────────────────────
if (!fs.existsSync(ENV_PATH)) {
  const example = path.join(ROOT, '.env.example');
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, ENV_PATH);
  } else {
    fs.writeFileSync(ENV_PATH, '', 'utf8');
  }
}


// preserved. DATABASE_URL is handled explicitly in Step 3.
try { require('dotenv').config({ path: ENV_PATH, override: false }); } catch (_) {}


// SUPABASE_DATABASE_URL takes explicit priority — the user intentionally
// configured an external database. Fall back to the Replit-injected
// DATABASE_URL only when Supabase is not configured.
const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
const isValidSupabase = supabaseUrl && (supabaseUrl.startsWith('postgresql://') || supabaseUrl.startsWith('postgres://'));
if (isValidSupabase) {
  process.env.DATABASE_URL = supabaseUrl;
} else if (!process.env.DATABASE_URL) {
  // No Supabase URL and no runtime injection — try .env as last resort.
  try {
    const envFromFile = {};
    require('dotenv').config({ path: ENV_PATH, processEnv: envFromFile });
    const dbUrl = envFromFile.DATABASE_URL || '';
    if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
      process.env.DATABASE_URL = dbUrl;
    }
  } catch (_) {}
}

// ── Step 4: check whether setup is needed ─────────────────────────────────
const dbUrlNow  = process.env.DATABASE_URL || '';
const jwtNow    = process.env.JWT_SECRET   || '';

const needsDb  = isPlaceholder(dbUrlNow);
const needsJwt = isPlaceholder(jwtNow);

if (!needsDb && !needsJwt) {
  // Already fully configured — skip Prisma unless explicitly opted in.
  runPrisma();
  process.exit(0);
}

// ── Step 5: non-interactive fallback ──────────────────────────────────────
if (!process.stdin.isTTY) {
  if (needsDb) {
    console.log('\n⚠️  DATABASE_URL is not configured.');
    console.log('   Edit .env and set DATABASE_URL to your PostgreSQL connection string,');
    console.log('   then re-run: npm run dev\n');
  }
  // Development server.ts creates ephemeral in-memory secrets when these are
  // absent. Never write generated secrets into a project environment file.
  if (!needsDb) runPrisma();
  process.exit(0);
}

// ── Step 6: interactive first-run setup wizard ────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function runSetup() {
  console.log('\n' + '─'.repeat(60));
  console.log("  🏥  99's Guide — first-run setup");
  console.log('─'.repeat(60));
  console.log('  This wizard writes database settings only; development secrets');
  console.log('  remain ephemeral and are never persisted to the project.\n');

  const patches = {};

  // ── Database URL ──────────────────────────────────────────────────────
  if (needsDb) {
    console.log('  Paste your PostgreSQL connection string.');
    console.log('  Supabase example:');
    console.log('    postgresql://postgres.REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require\n');
    let dbInput = '';
    while (!dbInput.startsWith('postgresql://') && !dbInput.startsWith('postgres://')) {
      dbInput = (await ask('  DATABASE_URL: ')).trim();
      if (!dbInput.startsWith('postgresql://') && !dbInput.startsWith('postgres://')) {
        console.log('  ⚠️  Must start with postgresql:// — please try again.\n');
      }
    }
    patches.DATABASE_URL = dbInput;
    patches.DIRECT_URL   = dbInput;
    process.env.DATABASE_URL = dbInput;
    process.env.DIRECT_URL   = dbInput;
    console.log('  ✅  Database URL saved.\n');
  }

  // ── JWT + Session secrets ─────────────────────────────────────────────
  if (needsJwt) {
    console.log('  ℹ️  Development will use ephemeral JWT/session secrets; none will be saved.\n');
  }

  // ── Write to .env ─────────────────────────────────────────────────────
  patchEnvFile(patches);
  console.log('  ✅  .env updated.\n');
  rl.close();

  // ── Run Prisma ────────────────────────────────────────────────────────
  console.log('─'.repeat(60));
  console.log('  Running prisma db push …');
  console.log('─'.repeat(60) + '\n');
  runPrisma();
  process.exit(0);
}

runSetup().catch((err) => {
  console.error('\n⚠️  Setup failed:', err.message);
  rl.close();
  process.exit(1);
});
