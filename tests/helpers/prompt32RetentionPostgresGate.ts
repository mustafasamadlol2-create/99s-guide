const PROMPT32_SCHEMA = "prompt32_retention_gate";
const PROMPT32_PORT = "55432";

function readPrompt32Url(name: string, value: string | undefined): URL {
  if (!value) {
    throw new Error(`${name} is required for the Prompt 32 PostgreSQL gate.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${name} must use PostgreSQL.`);
  }
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.port !== PROMPT32_PORT ||
    decodeURIComponent(parsed.pathname.replace(/^\//u, "")) !== PROMPT32_SCHEMA ||
    parsed.searchParams.get("schema") !== PROMPT32_SCHEMA
  ) {
    throw new Error(
      `${name} must target the isolated local database and schema ${PROMPT32_SCHEMA}.`,
    );
  }
  return parsed;
}

export function getPrompt32RetentionPostgresGateUrl(): string | null {
  if (process.env.RUN_PROMPT32_POSTGRES_TESTS !== "true") return null;
  if (process.env.NODE_ENV === "production") {
    throw new Error("The Prompt 32 PostgreSQL gate refuses to run in production.");
  }
  if (process.env.PROMPT32_POSTGRES_SAFETY_ACK !== PROMPT32_SCHEMA) {
    throw new Error(
      `The Prompt 32 PostgreSQL gate requires PROMPT32_POSTGRES_SAFETY_ACK=${PROMPT32_SCHEMA}.`,
    );
  }
  if (
    process.env.STUDY_EVENTS_ENABLED === "true" ||
    process.env.PRIVATE_D1_WRITE_MIRROR_ENABLED === "true" ||
    process.env.REPLIT_DEPLOYMENT === "true"
  ) {
    throw new Error(
      "Prompt 32 PostgreSQL tests require local-only execution with remote writes disabled.",
    );
  }

  const testUrl = readPrompt32Url(
    "PROMPT32_TEST_DATABASE_URL",
    process.env.PROMPT32_TEST_DATABASE_URL,
  );
  const expected = testUrl.toString();
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    if (readPrompt32Url(name, process.env[name]).toString() !== expected) {
      throw new Error(
        `${name} must exactly match the isolated Prompt 32 test database URL.`,
      );
    }
  }
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (supabaseUrl?.startsWith("postgres")) {
    if (readPrompt32Url("SUPABASE_DATABASE_URL", supabaseUrl).toString() !== expected) {
      throw new Error(
        "SUPABASE_DATABASE_URL points outside the isolated Prompt 32 test database.",
      );
    }
  }
  return expected;
}