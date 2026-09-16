
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const OUT_SQL = path.join(ROOT, "stage8b-private-d1-schema.sql");
const OUT_VERIFY = path.join(ROOT, "stage8b-private-d1-verify.sql");
const OUT_MANIFEST = path.join(ROOT, "stage8b-private-d1-manifest.json");

const EXISTING_D1_TABLES = new Set([
  "Lecture",
  "Material",
  "Mcq",
  "Flashcard",
  "DailyMotto",
  "CalendarEvent",
]);

const EXCLUDED_TABLES = new Set([
  "_prisma_migrations",
]);

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, ".env"));
loadEnv(path.join(ROOT, ".env.production"));

const dbUrl =
  process.env.AUDIT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.DIRECT_URL ||
  "";

if (!dbUrl) {
  console.error("No AUDIT_DATABASE_URL, DATABASE_URL, or DIRECT_URL found.");
  process.exit(2);
}

process.env.DATABASE_URL = dbUrl;

let PrismaClient;
try {
  ({ PrismaClient } = await import("@prisma/client"));
} catch (error) {
  console.error(`@prisma/client unavailable: ${error.message}`);
  process.exit(2);
}

const prisma = new PrismaClient();

function qi(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqliteType(column) {
  const dataType = String(column.data_type || "").toLowerCase();
  const udt = String(column.udt_name || "").toLowerCase();

  if (
    dataType.includes("character") ||
    dataType === "text" ||
    dataType.includes("timestamp") ||
    dataType === "date" ||
    dataType === "time" ||
    dataType === "uuid" ||
    dataType === "json" ||
    dataType === "jsonb" ||
    dataType === "inet" ||
    dataType === "citext" ||
    dataType === "user-defined"
  ) return "TEXT";

  if (
    dataType === "boolean" ||
    dataType.includes("integer") ||
    dataType === "smallint" ||
    dataType === "bigint"
  ) return "INTEGER";

  if (
    dataType === "numeric" ||
    dataType === "decimal" ||
    dataType === "real" ||
    dataType === "double precision" ||
    dataType === "money"
  ) return "REAL";

  if (dataType === "bytea") return "BLOB";

  if (dataType === "array" || udt.startsWith("_")) return "TEXT";

  // D1 / SQLite is dynamically typed. TEXT is the safest mirror fallback
  // for any PostgreSQL type not explicitly needed for arithmetic.
  return "TEXT";
}

function normalizeAction(action) {
  const v = String(action || "NO ACTION").toUpperCase();
  if (["CASCADE", "RESTRICT", "SET NULL", "SET DEFAULT", "NO ACTION"].includes(v)) {
    return v;
  }
  return "NO ACTION";
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

try {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT
      table_name,
      column_name,
      ordinal_position,
      is_nullable,
      data_type,
      udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  const constraints = await prisma.$queryRawUnsafe(`
    SELECT
      tc.table_name,
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
     AND tc.table_name = kcu.table_name
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
  `);

  const foreignKeys = await prisma.$queryRawUnsafe(`
    SELECT
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      kcu.ordinal_position,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule,
      rc.update_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.constraint_schema = ccu.constraint_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.constraint_schema = rc.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
    ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
  `);

  const indexes = await prisma.$queryRawUnsafe(`
    SELECT
      t.relname AS table_name,
      i.relname AS index_name,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary,
      string_agg(a.attname, ',' ORDER BY k.ord) AS columns
    FROM pg_class t
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE ns.nspname = 'public'
      AND t.relkind = 'r'
      AND ix.indpred IS NULL
      AND ix.indexprs IS NULL
    GROUP BY t.relname, i.relname, ix.indisunique, ix.indisprimary
    ORDER BY t.relname, i.relname
  `);

  const allTables = [...new Set(columns.map((x) => String(x.table_name)))];
  const targetTables = allTables.filter(
    (name) => !EXISTING_D1_TABLES.has(name) && !EXCLUDED_TABLES.has(name)
  );

  if (!targetTables.length) {
    console.error("No new private D1 tables were detected.");
    process.exit(3);
  }

  const columnsByTable = groupBy(
    columns.filter((x) => targetTables.includes(String(x.table_name))),
    (x) => String(x.table_name)
  );

  const constraintsByKey = groupBy(
    constraints.filter((x) => targetTables.includes(String(x.table_name))),
    (x) => `${x.table_name}::${x.constraint_name}`
  );

  const fksByKey = groupBy(
    foreignKeys.filter((x) => targetTables.includes(String(x.table_name))),
    (x) => `${x.table_name}::${x.constraint_name}`
  );

  const constraintsByTable = new Map();
  for (const [key, rows] of constraintsByKey) {
    const table = String(rows[0].table_name);
    if (!constraintsByTable.has(table)) constraintsByTable.set(table, []);
    constraintsByTable.get(table).push(rows);
  }

  const fksByTable = new Map();
  for (const [key, rows] of fksByKey) {
    const table = String(rows[0].table_name);
    if (!fksByTable.has(table)) fksByTable.set(table, []);
    fksByTable.get(table).push(rows);
  }

  const sql = [];
  sql.push("-- 99's Guide — Stage 8B Private D1 Runtime Schema");
  sql.push("-- GENERATED READ-ONLY from the current Supabase/PostgreSQL schema.");
  sql.push("-- This file creates NEW D1 mirror tables only.");
  sql.push("-- Existing shared D1 tables are not dropped or recreated.");
  sql.push("-- No application reads are switched in Stage 8B.");
  sql.push("");
  sql.push("PRAGMA foreign_keys = ON;");
  sql.push("");

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: "SCHEMA_ONLY",
    existingD1TablesSkipped: [...EXISTING_D1_TABLES],
    excludedTables: [...EXCLUDED_TABLES],
    targetTables: [],
  };

  for (const table of targetTables.sort()) {
    const tableColumns = columnsByTable.get(table) || [];
    const tableConstraints = constraintsByTable.get(table) || [];
    const tableFks = fksByTable.get(table) || [];

    const defs = tableColumns.map((col) => {
      const parts = [
        qi(col.column_name),
        sqliteType(col),
      ];

      if (String(col.is_nullable).toUpperCase() === "NO") {
        parts.push("NOT NULL");
      }

      // Booleans are represented as SQLite INTEGER 0/1.
      if (String(col.data_type).toLowerCase() === "boolean") {
        parts.push(`CHECK (${qi(col.column_name)} IN (0, 1))`);
      }

      return "  " + parts.join(" ");
    });

    for (const rows of tableConstraints) {
      const type = String(rows[0].constraint_type);
      const cols = [...rows]
        .sort((a,b) => Number(a.ordinal_position)-Number(b.ordinal_position))
        .map((x) => qi(x.column_name))
        .join(", ");

      if (type === "PRIMARY KEY") {
        defs.push(`  CONSTRAINT ${qi(rows[0].constraint_name)} PRIMARY KEY (${cols})`);
      } else if (type === "UNIQUE") {
        defs.push(`  CONSTRAINT ${qi(rows[0].constraint_name)} UNIQUE (${cols})`);
      }
    }

    for (const rows of tableFks) {
      const sorted = [...rows].sort(
        (a,b) => Number(a.ordinal_position)-Number(b.ordinal_position)
      );

      const localCols = sorted.map((x) => qi(x.column_name)).join(", ");
      const foreignTable = String(sorted[0].foreign_table_name);
      const foreignCols = sorted.map((x) => qi(x.foreign_column_name)).join(", ");

      defs.push(
        `  CONSTRAINT ${qi(sorted[0].constraint_name)} FOREIGN KEY (${localCols}) ` +
        `REFERENCES ${qi(foreignTable)} (${foreignCols}) ` +
        `ON DELETE ${normalizeAction(sorted[0].delete_rule)} ` +
        `ON UPDATE ${normalizeAction(sorted[0].update_rule)}`
      );
    }

    sql.push(`CREATE TABLE IF NOT EXISTS ${qi(table)} (`);
    sql.push(defs.join(",\n"));
    sql.push(");");
    sql.push("");

    const uniqueConstraintNames = new Set(
      tableConstraints.map((rows) => String(rows[0].constraint_name))
    );

    const tableIndexes = indexes.filter(
      (idx) =>
        String(idx.table_name) === table &&
        !Boolean(idx.is_primary) &&
        !uniqueConstraintNames.has(String(idx.index_name))
    );

    for (const idx of tableIndexes) {
      const cols = String(idx.columns || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      if (!cols.length) continue;

      sql.push(
        `CREATE ${idx.is_unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ` +
        `${qi(idx.index_name)} ON ${qi(table)} (` +
        cols.map(qi).join(", ") +
        ");"
      );
    }

    if (tableIndexes.length) sql.push("");

    manifest.targetTables.push({
      table,
      columns: tableColumns.map((c) => ({
        name: String(c.column_name),
        postgresType: String(c.data_type),
        sqliteType: sqliteType(c),
        nullable: String(c.is_nullable).toUpperCase() === "YES",
      })),
      constraints: tableConstraints.map((rows) => ({
        name: String(rows[0].constraint_name),
        type: String(rows[0].constraint_type),
        columns: [...rows]
          .sort((a,b) => Number(a.ordinal_position)-Number(b.ordinal_position))
          .map((x) => String(x.column_name)),
      })),
      foreignKeys: tableFks.map((rows) => ({
        name: String(rows[0].constraint_name),
        columns: [...rows]
          .sort((a,b) => Number(a.ordinal_position)-Number(b.ordinal_position))
          .map((x) => String(x.column_name)),
        foreignTable: String(rows[0].foreign_table_name),
        foreignColumns: [...rows]
          .sort((a,b) => Number(a.ordinal_position)-Number(b.ordinal_position))
          .map((x) => String(x.foreign_column_name)),
        onDelete: normalizeAction(rows[0].delete_rule),
        onUpdate: normalizeAction(rows[0].update_rule),
      })),
      indexes: tableIndexes.map((idx) => ({
        name: String(idx.index_name),
        unique: Boolean(idx.is_unique),
        columns: String(idx.columns || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      })),
    });
  }

  fs.writeFileSync(OUT_SQL, sql.join("\n"));
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2));

  const verify = [];
  verify.push("-- 99's Guide — Stage 8B D1 schema verification");
  verify.push("-- Expected: every target table appears exactly once and rowCount = 0.");
  verify.push("");

  verify.push(
    "SELECT name AS tableName FROM sqlite_master " +
    "WHERE type='table' AND name IN (" +
    manifest.targetTables.map((x) => `'${x.table.replaceAll("'", "''")}'`).join(", ") +
    ") ORDER BY name;"
  );
  verify.push("");

  const countSelects = manifest.targetTables.map(
    (x) => `SELECT '${x.table.replaceAll("'", "''")}' AS tableName, COUNT(*) AS rowCount FROM ${qi(x.table)}`
  );
  verify.push(countSelects.join("\nUNION ALL\n") + ";");
  verify.push("");

  verify.push(
    "SELECT tbl_name AS tableName, name AS indexName " +
    "FROM sqlite_master WHERE type='index' AND tbl_name IN (" +
    manifest.targetTables.map((x) => `'${x.table.replaceAll("'", "''")}'`).join(", ") +
    ") ORDER BY tbl_name, name;"
  );

  fs.writeFileSync(OUT_VERIFY, verify.join("\n"));

  console.log("99's Guide — Stage 8B Private D1 Schema Generator");
  console.log("-------------------------------------------------");
  console.log("Mode: READ-ONLY against Supabase; local files only.");
  console.log(`Target D1 tables generated: ${manifest.targetTables.length}`);
  for (const t of manifest.targetTables) {
    console.log(
      `${t.table}: ${t.columns.length} columns, ` +
      `${t.foreignKeys.length} FKs, ${t.indexes.length} explicit indexes`
    );
  }
  console.log("");
  console.log(`Saved: ${path.basename(OUT_SQL)}`);
  console.log(`Saved: ${path.basename(OUT_VERIFY)}`);
  console.log(`Saved: ${path.basename(OUT_MANIFEST)}`);
  console.log("");
  console.log("No Supabase data was modified.");
  console.log("No D1 data was modified.");
  console.log("STAGE 8B SCHEMA GENERATION PASS");
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
} finally {
  await prisma.$disconnect().catch(() => {});
}
