const PROMPT24_SCHEMA = "prompt24_levels_gate";

/**
 * Prompt 24 PostgreSQL tests require an explicit disposable database URL and
 * fixed isolated schema. They never fall back to DATABASE_URL or DIRECT_URL.
 */
export function getPrompt24LevelsPostgresGateUrl(): string | null {
  const value = process.env.PROMPT24_LEVELS_POSTGRES_URL;
  if (!value) return null;
  if (
    process.env.NODE_ENV === "production"
    || process.env.REPLIT_DEPLOYMENT
  ) {
    throw new Error("Prompt 24 PostgreSQL gate is disabled in production.");
  }
  if (process.env.PROMPT24_LEVELS_POSTGRES_DISPOSABLE !== "YES") {
    throw new Error(
      "Set PROMPT24_LEVELS_POSTGRES_DISPOSABLE=YES only for a disposable test database.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Prompt 24 PostgreSQL gate URL is invalid.");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || url.searchParams.get("schema") !== PROMPT24_SCHEMA
  ) {
    throw new Error(
      `Prompt 24 PostgreSQL gate must target schema ${PROMPT24_SCHEMA}.`,
    );
  }
  return url.toString();
}