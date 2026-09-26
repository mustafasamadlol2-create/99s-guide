const PROMPT30_SCHEMA = "prompt30_recall_policy_gate";

function checkedUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required for the Prompt 30 PostgreSQL gate.`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} is not a valid PostgreSQL URL.`); }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error(`${name} must use PostgreSQL.`);
  if (parsed.hostname !== "helium" || decodeURIComponent(parsed.pathname.replace(/^\//u, "")) !== "heliumdb" || parsed.searchParams.get("schema") !== PROMPT30_SCHEMA) {
    throw new Error(`${name} must target heliumdb schema ${PROMPT30_SCHEMA}, never public or production.`);
  }
  return parsed.toString();
}

export function getPrompt30RecallPostgresGateUrl(): string | null {
  if (process.env.RUN_REAL_PROMPT30_POSTGRES_TESTS !== "true") return null;
  if (process.env.NODE_ENV === "production") throw new Error("The Prompt 30 PostgreSQL gate refuses to run in production.");
  if (process.env.TEST_DATABASE_SAFETY_ACK !== PROMPT30_SCHEMA) throw new Error(`The Prompt 30 PostgreSQL gate requires TEST_DATABASE_SAFETY_ACK=${PROMPT30_SCHEMA}.`);
  const expected = checkedUrl("TEST_DATABASE_URL", process.env.TEST_DATABASE_URL);
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    if (checkedUrl(name, process.env[name]) !== expected) throw new Error(`${name} must exactly match the isolated test database URL.`);
  }
  const truthy = new Set(["1", "true", "yes", "on"]);
  if (
    [process.env.STUDY_EVENTS_ENABLED, process.env.PRIVATE_D1_WRITE_MIRROR_ENABLED]
      .some((value) => typeof value === "string" && truthy.has(value.trim().toLowerCase()))
  ) {
    throw new Error("Prompt 30 tests require Study Events and remote D1 mirror writes to remain disabled.");
  }
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (supabaseUrl?.startsWith("postgres")) {
    if (checkedUrl("SUPABASE_DATABASE_URL", supabaseUrl) !== expected) {
      throw new Error("SUPABASE_DATABASE_URL points outside the isolated test database.");
    }
  }
  return expected;
}