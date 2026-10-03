const DEVELOPMENT_PRISMA_CONNECTION_LIMIT = "2";

/**
 * Development preview and production may share a small Supavisor session pool.
 * Prisma's CPU-sized default can exhaust that pool before OAuth state is saved.
 * Keep the endpoint and existing URL options, but bound only the development
 * app's client pool. Production URLs remain exactly as configured.
 */
export function withDevelopmentPrismaConnectionLimit(
  databaseUrl: string,
  nodeEnv: string | undefined,
): string {
  if (nodeEnv !== "development") return databaseUrl;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new Error("DATABASE_URL must be a valid URL in development.", { cause: error });
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return databaseUrl;
  }

  parsed.searchParams.set("connection_limit", DEVELOPMENT_PRISMA_CONNECTION_LIMIT);
  return parsed.toString();
}