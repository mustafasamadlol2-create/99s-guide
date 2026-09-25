const PROMPT13_SCHEMA = "prompt13_group_focus_gate";

function readPrompt13Url(name: string, value: string | undefined): URL {
  if (!value) {
    throw new Error(`${name} is required for the Prompt 13 PostgreSQL test gate.`);
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
    || parsed.searchParams.get("schema") !== PROMPT13_SCHEMA
  ) {
    throw new Error(
      `${name} must target heliumdb schema ${PROMPT13_SCHEMA}, never public or production.`,
    );
  }
  return parsed;
}

export function getPrompt13GroupFocusPostgresGateUrl(): string | null {
  if (process.env.RUN_REAL_POSTGRES_TESTS !== "true") return null;
  if (process.env.NODE_ENV === "production") {
    throw new Error("The Prompt 13 PostgreSQL gate refuses to run in production.");
  }
  if (process.env.TEST_DATABASE_SAFETY_ACK !== PROMPT13_SCHEMA) {
    throw new Error(
      `The Prompt 13 PostgreSQL gate requires TEST_DATABASE_SAFETY_ACK=${PROMPT13_SCHEMA}.`,
    );
  }
  if (process.env.GROUP_FOCUS_ENABLED === "true") {
    throw new Error("Keep the Group Focus feature flag disabled during Prompt 13 tests.");
  }
  if (process.env.STUDY_EVENTS_ENABLED === "true") {
    throw new Error("Study Events must remain disabled during Prompt 13 tests.");
  }
  if (process.env.PRIVATE_D1_WRITE_MIRROR_ENABLED === "true") {
    throw new Error("Prompt 13 tests must not contact a remote Worker.");
  }

  const testUrl = readPrompt13Url("TEST_DATABASE_URL", process.env.TEST_DATABASE_URL);
  const testUrlText = testUrl.toString();
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const configured = readPrompt13Url(name, process.env[name]);
    if (configured.toString() !== testUrlText) {
      throw new Error(`${name} must exactly match the isolated test database URL.`);
    }
  }

  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (supabaseUrl?.startsWith("postgres")) {
    const configured = readPrompt13Url("SUPABASE_DATABASE_URL", supabaseUrl);
    if (configured.toString() !== testUrlText) {
      throw new Error("SUPABASE_DATABASE_URL points outside the isolated test database.");
    }
  }
  return testUrlText;
}