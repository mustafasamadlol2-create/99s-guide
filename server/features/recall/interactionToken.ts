import { createHmac, timingSafeEqual } from "node:crypto";
import { RECALL_PROTECTED_ATTEMPT_TTL_MS } from "./constants.js";
import { RecallError } from "./errors.js";

const PURPOSE = "recall_interaction";
const POLICY = "recall-policy-v1";
const TTL_SECONDS = RECALL_PROTECTED_ATTEMPT_TTL_MS / 1000;
const MAX_KEY_COUNT = 4;

type Claims = {
  typ: "RECALL-INTERACTION";
  version: 1;
  purpose: typeof PURPOSE;
  sub: string;
  userId: string;
  attemptId: string;
  policyVersion: typeof POLICY;
  iat: number;
  exp: number;
};

function config(): { activeKid: string; keys: Map<string, Buffer> } {
  const raw = process.env.RECALL_INTERACTION_TOKEN_KEYS_JSON;
  const activeKid = process.env.RECALL_INTERACTION_TOKEN_ACTIVE_KID?.trim();
  if (!raw || !activeKid || raw.length > 16_384) throw new RecallError("RECALL_TOKEN_CONFIG_INVALID", "Recall interaction signing is unavailable.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new RecallError("RECALL_TOKEN_CONFIG_INVALID", "Recall interaction signing is unavailable."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RecallError("RECALL_TOKEN_CONFIG_INVALID", "Recall interaction signing is unavailable.");
  const keys = new Map<string, Buffer>();
  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > MAX_KEY_COUNT) throw new RecallError("RECALL_TOKEN_CONFIG_INVALID", "Recall interaction signing is unavailable.");
  for (const [kid, value] of entries) {
    if (!/^[A-Za-z0-9._-]{1,32}$/u.test(kid) || typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new RecallError("RECALL_TOKEN_CONFIG_INVALID", "Recall interaction signing is unavailable.");
    const key = Buffer.from(value, "base64url");
    if (key.length < 32 || key.length > 128 || key.toString("base64url") !== value) throw new RecallError("RECALL_TOKEN_CONFIG_INVALID", "Recall interaction signing is unavailable.");
    keys.set(kid, key);
  }
  if (!keys.has(activeKid)) throw new RecallError("RECALL_TOKEN_CONFIG_INVALID", "Recall interaction signing is unavailable.");
  return { activeKid, keys };
}

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(input: string, key: Buffer): string {
  return createHmac("sha256", key).update(input).digest("base64url");
}

export function mintRecallInteractionToken(userId: string, attemptId: string, expiresAt: Date, now: Date): string {
  if (
    !userId ||
    !attemptId ||
    !(expiresAt instanceof Date) ||
    !Number.isFinite(expiresAt.getTime()) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    expiresAt.getTime() <= now.getTime()
  ) {
    throw new RecallError("RECALL_TOKEN_INVALID", "Recall interaction token cannot be issued.");
  }
  const { activeKid, keys } = config();
  const exp = Math.min(Math.floor(expiresAt.getTime() / 1000), Math.floor(now.getTime() / 1000) + TTL_SECONDS);
  const iat = Math.floor(now.getTime() / 1000);
  if (exp <= iat) throw new RecallError("RECALL_TOKEN_INVALID", "Recall interaction token cannot be issued.");
  const claims: Claims = { typ: "RECALL-INTERACTION", version: 1, purpose: PURPOSE, sub: userId, userId, attemptId, policyVersion: POLICY, iat, exp };
  const header = segment({ alg: "HS256", typ: "RECALL-INTERACTION", kid: activeKid });
  const payload = segment(claims);
  return `${header}.${payload}.${sign(`${header}.${payload}`, keys.get(activeKid)!)}`;
}

export function verifyRecallInteractionToken(token: string | undefined, userId: string, attemptId: string, now: Date): void {
  if (!token || token.length > 4096) throw new RecallError("RECALL_TOKEN_INVALID", "Recall interaction token is invalid.");
  const pieces = token.split(".");
  if (pieces.length !== 3) throw new RecallError("RECALL_TOKEN_INVALID", "Recall interaction token is invalid.");
  let header: unknown;
  let claims: unknown;
  try { header = JSON.parse(Buffer.from(pieces[0], "base64url").toString()); claims = JSON.parse(Buffer.from(pieces[1], "base64url").toString()); } catch { throw new RecallError("RECALL_TOKEN_INVALID", "Recall interaction token is invalid."); }
  if (!isRecord(header) || !isRecord(claims)) throw new RecallError("RECALL_TOKEN_INVALID", "Recall interaction token is invalid.");
  const { keys } = config();
  const key = typeof header.kid === "string" ? keys.get(header.kid) : undefined;
  if (!key || header.alg !== "HS256" || header.typ !== "RECALL-INTERACTION") throw new RecallError("RECALL_TOKEN_INVALID", "Recall interaction token is invalid.");
  const expected = Buffer.from(sign(`${pieces[0]}.${pieces[1]}`, key));
  const actual = Buffer.from(pieces[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new RecallError("RECALL_TOKEN_INVALID", "Recall interaction token is invalid.");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    header.alg !== "HS256" ||
    header.typ !== "RECALL-INTERACTION" ||
    claims.typ !== "RECALL-INTERACTION" ||
    claims.version !== 1 ||
    claims.purpose !== PURPOSE ||
    claims.policyVersion !== POLICY ||
    claims.sub !== userId ||
    claims.userId !== userId ||
    claims.attemptId !== attemptId ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    (claims.exp as number) <= (claims.iat as number) ||
    (claims.exp as number) - (claims.iat as number) > TTL_SECONDS ||
    (claims.iat as number) > nowSeconds + 30 ||
    (claims.exp as number) < nowSeconds - 30
  ) {
    throw new RecallError("RECALL_TOKEN_INVALID", "Recall interaction token is invalid.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}