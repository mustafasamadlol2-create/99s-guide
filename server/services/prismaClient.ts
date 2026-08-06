import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { dbMonitor } from "./dbMonitor.js";

// ── Load .env before PrismaClient is instantiated ─────────────────────────────
// prismaClient.ts is a static import of server.ts, so it is evaluated before
// dotenv.config() runs in server.ts. We load it here with override:false so
// runtime-injected variables (e.g. Replit's DATABASE_URL) always take priority
// over .env values.
loadEnv({ override: false, quiet: true });

// Only fall back to SUPABASE_DATABASE_URL or the .env value when the runtime
// has not already provided DATABASE_URL (e.g. on a local machine without
// Replit's managed PostgreSQL injection).
if (!process.env.DATABASE_URL) {
  if (process.env.SUPABASE_DATABASE_URL?.startsWith("postgres")) {
    process.env.DATABASE_URL = process.env.SUPABASE_DATABASE_URL;
  } else {
    // Parse .env into a temp object so we don't clobber anything already set.
    const envFromFile: Record<string, string> = {};
    loadEnv({ processEnv: envFromFile, quiet: true });
    if (envFromFile.DATABASE_URL?.startsWith("postgres")) {
      process.env.DATABASE_URL = envFromFile.DATABASE_URL;
    }
  }
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
    updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }),
    $connect: async () => {}, $disconnect: async () => {}, $executeRawUnsafe: async () => {},
    $queryRaw: async () => [] };
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
