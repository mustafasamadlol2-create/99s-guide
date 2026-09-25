const GATE_SCHEMAS = new Set(["prompt8_outbox_gate", "prompt12_focus_gate"]);

function readUrl(name: string, value: string | undefined, gateSchema: string): URL {
  if (!value) throw new Error(`${name} is required for the real PostgreSQL gate.`);
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
    parsed.hostname !== "helium" ||
    decodeURIComponent(parsed.pathname.replace(/^\//u, "")) !== "heliumdb" ||
    parsed.searchParams.get("schema") !== gateSchema
  ) {
    throw new Error(`${name} must target heliumdb schema ${gateSchema}, never public or production.`);
  }
  return parsed;
}

export function getPrompt8PostgresGateUrl(): string | null {
  if (process.env.RUN_REAL_POSTGRES_TESTS !== "true") return null;
  if (process.env.NODE_ENV === "production") {
    throw new Error("The real PostgreSQL gate refuses to run in production.");
  }
  const gateSchema = process.env.TEST_DATABASE_SAFETY_ACK;
  if (!gateSchema || !GATE_SCHEMAS.has(gateSchema)) {
    throw new Error("The real PostgreSQL gate requires an approved disposable-schema safety marker.");
  }
  if (process.env.STUDY_EVENTS_ENABLED !== "true") {
    throw new Error("Study Events must be enabled only in the isolated test process.");
  }
  if (process.env.PRIVATE_D1_WRITE_MIRROR_ENABLED === "true") {
    throw new Error("The real PostgreSQL gate must not contact a remote Worker.");
  }

  const testUrl = readUrl("TEST_DATABASE_URL", process.env.TEST_DATABASE_URL, gateSchema);
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const configured = readUrl(name, process.env[name], gateSchema);
    if (
      configured.hostname !== testUrl.hostname ||
      configured.pathname !== testUrl.pathname ||
      configured.searchParams.get("schema") !== gateSchema
    ) {
      throw new Error(`${name} does not match the isolated test database.`);
    }
  }

  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (supabaseUrl?.startsWith("postgres")) {
    const configured = readUrl("SUPABASE_DATABASE_URL", supabaseUrl, gateSchema);
    if (
      configured.hostname !== testUrl.hostname ||
      configured.pathname !== testUrl.pathname ||
      configured.searchParams.get("schema") !== gateSchema
    ) {
      throw new Error("SUPABASE_DATABASE_URL points outside the isolated test schema.");
    }
  }

  return testUrl.toString();
}