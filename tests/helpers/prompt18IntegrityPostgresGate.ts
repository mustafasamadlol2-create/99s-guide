const PROMPT18_SCHEMA = "prompt18_integrity_gate";

function readPrompt18Url(name: string, value: string | undefined): URL {
  if (!value) {
    throw new Error(`${name} is required for the Prompt 18 PostgreSQL gate.`);
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
    parsed.hostname !== "helium"
    || decodeURIComponent(parsed.pathname.replace(/^\//u, "")) !== "heliumdb"
    || parsed.searchParams.get("schema") !== PROMPT18_SCHEMA
  ) {
    throw new Error(
      `${name} must target heliumdb schema ${PROMPT18_SCHEMA}, never public or production.`,
    );
  }
  return parsed;
}

export function getPrompt18IntegrityPostgresGateUrl(): string | null {
  if (process.env.RUN_REAL_POSTGRES_TESTS !== "true") return null;
  if (process.env.NODE_ENV === "production") {
    throw new Error("The Prompt 18 PostgreSQL gate refuses to run in production.");
  }
  if (process.env.TEST_DATABASE_SAFETY_ACK !== PROMPT18_SCHEMA) {
    throw new Error(
      `The Prompt 18 PostgreSQL gate requires TEST_DATABASE_SAFETY_ACK=${PROMPT18_SCHEMA}.`,
    );
  }
  if (process.env.STUDY_EVENTS_ENABLED === "true") {
    throw new Error("Study Events must remain disabled during Prompt 18 tests.");
  }
  if (process.env.PRIVATE_D1_WRITE_MIRROR_ENABLED === "true") {
    throw new Error("Prompt 18 tests must not contact a remote Worker.");
  }

  const testUrl = readPrompt18Url(
    "TEST_DATABASE_URL",
    process.env.TEST_DATABASE_URL,
  );
  const expected = testUrl.toString();
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    if (readPrompt18Url(name, process.env[name]).toString() !== expected) {
      throw new Error(`${name} must exactly match the isolated test database URL.`);
    }
  }

  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (supabaseUrl?.startsWith("postgres")) {
    if (readPrompt18Url("SUPABASE_DATABASE_URL", supabaseUrl).toString() !== expected) {
      throw new Error("SUPABASE_DATABASE_URL points outside the isolated test database.");
    }
  }
  return expected;
}