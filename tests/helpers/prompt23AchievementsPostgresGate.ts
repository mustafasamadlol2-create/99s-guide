const PROMPT23_SCHEMA = "prompt23_achievements_gate";

/**
 * Prompt 23 integration tests use only this explicit disposable-database
 * variable. They never fall back to DATABASE_URL or DIRECT_URL.
 */
export function getPrompt23AchievementsPostgresGateUrl(): string | null {
  const value = process.env.PROMPT23_ACHIEVEMENTS_POSTGRES_URL;
  if (!value) return null;
  if (
    process.env.NODE_ENV === "production"
    || process.env.REPLIT_DEPLOYMENT
  ) {
    throw new Error("Prompt 23 PostgreSQL gate is disabled in production.");
  }
  if (process.env.PROMPT23_ACHIEVEMENTS_POSTGRES_DISPOSABLE !== "YES") {
    throw new Error(
      "Set PROMPT23_ACHIEVEMENTS_POSTGRES_DISPOSABLE=YES only for a disposable test database.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Prompt 23 PostgreSQL gate URL is invalid.");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || url.searchParams.get("schema") !== PROMPT23_SCHEMA
  ) {
    throw new Error(
      `Prompt 23 PostgreSQL gate must target schema ${PROMPT23_SCHEMA}.`,
    );
  }
  return url.toString();
}