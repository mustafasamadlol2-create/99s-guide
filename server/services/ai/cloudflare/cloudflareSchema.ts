import { toJSONSchema } from "zod";
import type { ZodType } from "zod";

const CLOUDFLARE_JSON_SCHEMA_KEYS = new Set([
  "$defs",
  "$ref",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
]);

function sanitizeMap(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, projectCloudflareJsonSchema(child)]),
  );
}

export function projectCloudflareJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectCloudflareJsonSchema);
  if (!value || typeof value !== "object") return value;
  const projected: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!CLOUDFLARE_JSON_SCHEMA_KEYS.has(key)) continue;
    projected[key] = key === "properties" || key === "$defs"
      ? sanitizeMap(child)
      : projectCloudflareJsonSchema(child);
  }
  return projected;
}

export function createCloudflareJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  return projectCloudflareJsonSchema(
    toJSONSchema(schema, { target: "draft-07" }),
  ) as Record<string, unknown>;
}