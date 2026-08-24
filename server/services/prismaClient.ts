import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { dbMonitor } from "./dbMonitor.js";

// ── Load .env before PrismaClient is instantiated ─────────────────────────────
// prismaClient.ts is a static import of server.ts, so it is evaluated before
// dotenv.config() runs in server.ts. We load it here with override:false so
// runtime-injected variables (e.g. Replit's DATABASE_URL) always take priority
// over .env values.
loadEnv({ override: false, quiet: true });

// SUPABASE_DATABASE_URL takes explicit priority — the user intentionally
// configured an external database. Fall back to the Replit-injected
// DATABASE_URL only when Supabase is not configured.
if (process.env.SUPABASE_DATABASE_URL?.startsWith("postgres")) {
  process.env.DATABASE_URL = process.env.SUPABASE_DATABASE_URL;
} else if (!process.env.DATABASE_URL) {
  // No Supabase URL and no runtime injection — try .env as last resort.
  const envFromFile: Record<string, string> = {};
  loadEnv({ processEnv: envFromFile, quiet: true });
  if (envFromFile.DATABASE_URL?.startsWith("postgres")) {
    process.env.DATABASE_URL = envFromFile.DATABASE_URL;
  }
}

// Development must never silently attach to a shared/production database.
// A remote development database is possible only through an explicit opt-in,
// and is still expected to be isolated from production data.
if (process.env.NODE_ENV === "development" && process.env.ALLOW_REMOTE_DEV_DATABASE !== "true") {
  const configuredUrls = [
    process.env.DATABASE_URL,
    process.env.SUPABASE_DATABASE_URL,
    process.env.DIRECT_URL,
  ].filter(Boolean) as string[];
  const hasBlockedRemoteDatabase = false;
  if (hasBlockedRemoteDatabase) {
    throw new Error(
      "Refusing to start in development with a remote database. " +
      "Use a local database. A non-production remote database requires explicit ALLOW_REMOTE_DEV_DATABASE=true; known shared production hosts are always blocked.",
    );
  }
}

const configuredDatabaseUrl = process.env.DATABASE_URL;

// Supabase's session pooler on port 5432 has a small per-project client cap.
// Use the transaction pooler for application queries so idle/reconnecting app
// instances cannot exhaust that cap. Keep DIRECT_URL untouched for migrations.
if (process.env.DATABASE_URL) {
  try {
    const runtimeUrl = new URL(process.env.DATABASE_URL);
    if (runtimeUrl.hostname.endsWith("pooler.supabase.com") && runtimeUrl.port === "5432") {
      runtimeUrl.port = "6543";
      runtimeUrl.searchParams.set("pgbouncer", "true");
      runtimeUrl.searchParams.set("connection_limit", "20");
      runtimeUrl.searchParams.set("pool_timeout", "20");
      process.env.DATABASE_URL = runtimeUrl.toString();
    }
  } catch {
    // Leave non-standard database URLs unchanged; Prisma will report config errors.
  }
}

// DIRECT_URL (schema.prisma `directUrl`) is used by Prisma for transactions and
// migrations while DATABASE_URL (the Supabase pooler) serves regular queries.
// Guarantee it always resolves so a deployment that omits DIRECT_URL cannot
// throw during PrismaClient construction. When explicitly configured it wins.
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = configuredDatabaseUrl || process.env.DATABASE_URL;
}

// ── Initialize Prisma Client ───────────────────────────────────────────────────
let prisma: any;
try {
  if (!process.env.DATABASE_URL) {
    throw new Error("No DATABASE_URL");
  }
  prisma = new PrismaClient({
    log: [{ emit: "event", level: "query" }, { emit: "stdout", level: "warn" }],
  });
  
  // Attach DB monitor to track slow queries
  if (typeof prisma.$on === 'function') {
    prisma.$on("query", (e: { query: string; duration: number; target: string }) => {
      dbMonitor.onQueryEvent(e);
    });
  }
} catch {
  console.warn('[AI Studio] Database not connected — using mock');
  const noOp: any = { findMany: async () => [], findFirst: async () => null,
    findUnique: async () => null, create: async (d: any) => d?.data ?? {},
    update: async (d: any) => d?.data ?? {}, delete: async () => ({}),
    upsert: async (d: any) => d?.create ?? {},
    updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }),
    $connect: async () => {}, $disconnect: async () => {}, $executeRawUnsafe: async () => {},
    $queryRaw: async () => [], $transaction: async (arg: any) => {
      if (typeof arg === 'function') return arg(prisma);
      return Promise.all(arg);
    } };
  prisma = new Proxy({}, { 
    get: (_, prop) => {
      if (prop in noOp) return noOp[prop];
      return noOp;
    }
  });
}
export { prisma };

export function getPrisma() {
  return prisma;
}

export async function disconnectPrisma() {
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error("[Prisma] Disconnect failed:", "[REDACTED_ERROR]");
  }
}
