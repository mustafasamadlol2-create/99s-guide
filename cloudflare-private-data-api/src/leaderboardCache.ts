type Db = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };
type Env = { DB: Db; LEADERBOARD_D1_SYNC_SECRET?: string };
type Manifest = {
  snapshotId: string; seasonId: string; scope: string; seasonKey: string;
  snapshotType: "LIVE" | "FINAL"; revision: number; seasonStatus: string;
  startsAt: string | null; endsAt: string | null; generatedAt: string;
  scoreThrough: string; entryCount: number; sourceFingerprint: string;
  projectionChecksum: string; chunkCount: number; rankingVersion: "leaderboard-ranking-v1";
  cacheSchemaVersion: 1;
};
type Entry = { userId: string; rank: number; tieSize: number; score: number; levelSnapshot: number | null };
const MAX_BODY = 512 * 1024, MAX_CHUNK = 100, MAX_ENTRIES = 20_000;
const SCHEMA = 1, RANKING = "leaderboard-ranking-v1";

const response = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, name: string, max = 300): string => {
  if (typeof v !== "string" || !v || v.length > max) throw new Error(`Invalid ${name}.`);
  return v;
};
const integer = (v: unknown, name: string, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) throw new Error(`Invalid ${name}.`);
  return v;
};
const optionalText = (v: unknown, name: string): string | null =>
  v === null || v === undefined ? null : text(v, name, 80);
const hex = (v: unknown, name: string): string => {
  const s = text(v, name, 128);
  if (!/^[a-f0-9]{64}$/u.test(s)) throw new Error(`Invalid ${name}.`);
  return s;
};
const validIso = (v: string, name: string): string => {
  if (!Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) throw new Error(`Invalid ${name}.`);
  return v;
};

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function equal(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let d = x.length ^ y.length; for (let i = 0; i < Math.min(x.length, y.length); i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
async function authenticate(request: Request, env: Env, raw: string): Promise<Response | null> {
  const secret = env.LEADERBOARD_D1_SYNC_SECRET || "";
  if (!secret) return response({ ok: false, code: "LEADERBOARD_CACHE_AUTH_UNAVAILABLE" }, 503);
  const timestamp = request.headers.get("X-Leaderboard-Timestamp") || "";
  const nonce = request.headers.get("X-Leaderboard-Nonce") || "";
  const signature = request.headers.get("X-Leaderboard-Signature") || "";
  const seconds = Number(timestamp);
  if (!/^\d{10,13}$/u.test(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/u.test(nonce) ||
      !/^[a-f0-9]{64}$/u.test(signature)) return response({ ok: false, code: "LEADERBOARD_CACHE_UNAUTHORIZED" }, 401);
  const now = Math.floor(Date.now() / 1000), sec = seconds > 1e12 ? Math.floor(seconds / 1000) : seconds;
  if (Math.abs(now - sec) > 300) return response({ ok: false, code: "LEADERBOARD_CACHE_AUTH_EXPIRED" }, 401);
  const bodyHash = await digest(raw);
  const url = new URL(request.url);
  const canonical = `${timestamp}.${nonce}.${request.method}.${url.pathname}.${url.search}.${bodyHash}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!(await equal(signature, sig))) return response({ ok: false, code: "LEADERBOARD_CACHE_UNAUTHORIZED" }, 401);
  try {
    await env.DB.prepare("DELETE FROM \"leaderboard_cache_nonces\" WHERE \"nonce\" IN (SELECT \"nonce\" FROM \"leaderboard_cache_nonces\" WHERE \"expires_at\" < ? ORDER BY \"expires_at\" ASC LIMIT 100)").bind(now).run();
    await env.DB.prepare("INSERT INTO \"leaderboard_cache_nonces\" (\"nonce\",\"expires_at\") VALUES (?,?)")
      .bind(nonce, sec + 600).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return response({ ok: false, code: message.includes("UNIQUE") ? "LEADERBOARD_CACHE_REPLAY" : "LEADERBOARD_CACHE_UNAVAILABLE" }, message.includes("UNIQUE") ? 409 : 503);
  }
  return null;
}

function parseManifest(v: unknown): Manifest {
  if (!record(v)) throw new Error("Manifest is required.");
  const m: Manifest = {
    snapshotId: text(v.snapshotId, "snapshotId"), seasonId: text(v.seasonId, "seasonId"),
    scope: text(v.scope, "scope", 16), seasonKey: text(v.seasonKey, "seasonKey", 64),
    snapshotType: v.snapshotType === "LIVE" || v.snapshotType === "FINAL" ? v.snapshotType : (() => { throw new Error("Invalid snapshotType."); })(),
    revision: integer(v.revision, "revision", 1, 2147483647), seasonStatus: text(v.seasonStatus, "seasonStatus", 16),
    startsAt: optionalText(v.startsAt, "startsAt"), endsAt: optionalText(v.endsAt, "endsAt"),
    generatedAt: validIso(text(v.generatedAt, "generatedAt", 40), "generatedAt"),
    scoreThrough: validIso(text(v.scoreThrough, "scoreThrough", 40), "scoreThrough"),
    entryCount: integer(v.entryCount, "entryCount", 0, MAX_ENTRIES),
    sourceFingerprint: hex(v.sourceFingerprint, "sourceFingerprint"),
    projectionChecksum: hex(v.projectionChecksum, "projectionChecksum"),
    chunkCount: integer(v.chunkCount, "chunkCount", 0, Math.ceil(MAX_ENTRIES / MAX_CHUNK)),
    rankingVersion: v.rankingVersion === RANKING ? RANKING : (() => { throw new Error("Invalid rankingVersion."); })(),
    cacheSchemaVersion: v.cacheSchemaVersion === SCHEMA ? SCHEMA : (() => { throw new Error("Unsupported cache schema."); })(),
  };
  if (!["WEEKLY", "MONTHLY", "SEMESTER", "ALL_TIME"].includes(m.scope)) throw new Error("Invalid scope.");
  if (!["UPCOMING", "ACTIVE", "CLOSED"].includes(m.seasonStatus)) throw new Error("Invalid seasonStatus.");
  for (const [value, name] of [[m.startsAt, "startsAt"], [m.endsAt, "endsAt"]] as const) {
    if (value !== null) validIso(value, name);
  }
  if (m.entryCount === 0 && m.chunkCount !== 0 || m.entryCount > 0 && m.chunkCount === 0) throw new Error("Manifest chunk count is inconsistent.");
  return m;
}
function manifestDto(row: any): Record<string, unknown> {
  if (!row) return row;
  return {
    snapshotId: row.snapshot_id, seasonId: row.season_id, scope: row.scope,
    seasonKey: row.season_key, snapshotType: row.snapshot_type, revision: Number(row.revision),
    seasonStatus: row.season_status, startsAt: row.starts_at, endsAt: row.ends_at,
    generatedAt: row.generated_at, scoreThrough: row.score_through, entryCount: Number(row.entry_count),
    sourceFingerprint: row.source_fingerprint, projectionChecksum: row.projection_checksum,
    chunkCount: Number(row.chunk_count), state: row.state, projectedAt: row.projected_at,
    rankingVersion: row.ranking_version, cacheSchemaVersion: Number(row.cache_schema_version),
  };
}
function parseEntry(v: unknown): Entry {
  if (!record(v)) throw new Error("Invalid entry.");
  return { userId: text(v.userId, "userId", 200), rank: integer(v.rank, "rank", 1, 2147483647),
    tieSize: integer(v.tieSize, "tieSize", 1, 2147483647), score: integer(v.score, "score", 1, 9007199254740991),
    levelSnapshot: v.levelSnapshot === null || v.levelSnapshot === undefined ? null : integer(v.levelSnapshot, "levelSnapshot", 0, 2147483647) };
}
function manifestArgs(m: Manifest): unknown[] {
  return [m.snapshotId,m.seasonId,m.scope,m.seasonKey,m.snapshotType,m.revision,m.seasonStatus,m.startsAt,m.endsAt,m.generatedAt,m.scoreThrough,m.entryCount,m.sourceFingerprint,m.projectionChecksum,m.chunkCount,"BUILDING",m.rankingVersion,m.cacheSchemaVersion];
}
function sameManifest(row: any, m: Manifest): boolean {
  if (!row) return false;
  const values = [row.snapshot_id,row.season_id,row.scope,row.season_key,row.snapshot_type,row.revision,
    row.season_status,row.starts_at,row.ends_at,row.generated_at,row.score_through,row.entry_count,
    row.source_fingerprint,row.projection_checksum,row.chunk_count,row.ranking_version,row.cache_schema_version];
  const expected = manifestArgs(m).filter((_, i) => i !== 15);
  return expected.every((v, i) => values[i] === v);
}
async function ensureManifest(env: Env, m: Manifest): Promise<any> {
  const current = await env.DB.prepare("SELECT * FROM \"leaderboard_cache_snapshots\" WHERE \"snapshot_id\" = ?").bind(m.snapshotId).first();
  if (current) { if (!sameManifest(current, m)) throw new Error("LEADERBOARD_CACHE_PROJECTION_CONFLICT"); return current; }
  try {
    await env.DB.prepare(`INSERT INTO "leaderboard_cache_snapshots" ("snapshot_id","season_id","scope","season_key","snapshot_type","revision","season_status","starts_at","ends_at","generated_at","score_through","entry_count","source_fingerprint","projection_checksum","chunk_count","state","ranking_version","cache_schema_version") VALUES (${Array(18).fill("?").join(",")})`).bind(...manifestArgs(m)).run();
  } catch (error) {
    const raced = await env.DB.prepare("SELECT * FROM \"leaderboard_cache_snapshots\" WHERE \"snapshot_id\" = ?").bind(m.snapshotId).first();
    if (raced) {
      if (!sameManifest(raced, m)) {
        throw new Error("LEADERBOARD_CACHE_PROJECTION_CONFLICT", { cause: error });
      }
      return raced;
    }
    throw error;
  }
  return m;
}
async function checksum(m: Manifest, entries: Entry[]): Promise<string> {
  const ordered = [...entries].sort((a,b) => a.rank-b.rank || b.score-a.score || a.userId.localeCompare(b.userId));
  return digest(JSON.stringify([m.snapshotId,m.revision,m.entryCount,m.rankingVersion,...ordered.map((e) => [e.userId,e.rank,e.tieSize,e.score,e.levelSnapshot])]));
}
async function begin(env: Env, m: Manifest): Promise<Response> {
  const row = await ensureManifest(env, m);
  return response({ok:true,state:row.state || "BUILDING",snapshotId:m.snapshotId});
}
async function chunk(env: Env, m: Manifest, index: number, entries: Entry[], hash: string): Promise<Response> {
  if (index >= m.chunkCount || entries.length > MAX_CHUNK) throw new Error("Invalid chunk.");
  const manifest = await ensureManifest(env,m);
  const actual = await digest(JSON.stringify([m.snapshotId,index,entries]));
  if (!await equal(actual,hash)) throw new Error("Chunk hash mismatch.");
  // Claim the receipt before writing any entries. A conflicting delivery can
  // therefore never overwrite rows accepted under another hash.
  const old = await env.DB.prepare("SELECT * FROM \"leaderboard_cache_chunks\" WHERE \"snapshot_id\"=? AND \"chunk_index\"=?").bind(m.snapshotId,index).first();
  if (old && (old.chunk_hash !== hash || Number(old.row_count) !== entries.length)) {
    throw new Error("LEADERBOARD_CACHE_PROJECTION_CONFLICT");
  }
  if (manifest.state === "READY") {
    if (old) return response({ok:true,result:"idempotent"});
    throw new Error("LEADERBOARD_CACHE_PROJECTION_CONFLICT");
  }
  try {
    await env.DB.prepare("INSERT INTO \"leaderboard_cache_chunks\" VALUES (?,?,?,?,?)")
      .bind(m.snapshotId,index,hash,entries.length,new Date().toISOString()).run();
  } catch {
    const claimed = await env.DB.prepare("SELECT * FROM \"leaderboard_cache_chunks\" WHERE \"snapshot_id\"=? AND \"chunk_index\"=?").bind(m.snapshotId,index).first();
    if (!claimed || claimed.chunk_hash !== hash || Number(claimed.row_count) !== entries.length) {
      throw new Error("LEADERBOARD_CACHE_PROJECTION_CONFLICT");
    }
  }
  const statements = entries.map((e) => env.DB.prepare(`INSERT INTO "leaderboard_cache_entries" ("snapshot_id","user_id","rank","tie_size","score","level_snapshot") VALUES (?,?,?,?,?,?) ON CONFLICT ("snapshot_id","user_id") DO UPDATE SET "rank"=excluded."rank","tie_size"=excluded."tie_size","score"=excluded."score","level_snapshot"=excluded."level_snapshot"`).bind(m.snapshotId,e.userId,e.rank,e.tieSize,e.score,e.levelSnapshot));
  if (statements.length) await env.DB.batch(statements);
  return response({ok:true,result:"applied"});
}
async function commit(env: Env, m: Manifest): Promise<Response> {
  await ensureManifest(env,m);
  const chunks = await env.DB.prepare("SELECT * FROM \"leaderboard_cache_chunks\" WHERE \"snapshot_id\"=? ORDER BY \"chunk_index\"").bind(m.snapshotId).all();
  const chunkRows = (chunks.results || []) as any[];
  if (chunkRows.length !== m.chunkCount ||
      chunkRows.some((row, index) => Number(row.chunk_index) !== index) ||
      chunkRows.some((row) => Number(row.row_count) < 0 || Number(row.row_count) > MAX_CHUNK) ||
      chunkRows.reduce((sum, row) => sum + Number(row.row_count), 0) !== m.entryCount) {
    return response({ok:false,code:"CACHE_INCOMPLETE"},409);
  }
  const rows = await env.DB.prepare(`SELECT "user_id" userId,"rank", "tie_size" tieSize,"score","level_snapshot" levelSnapshot FROM "leaderboard_cache_entries" WHERE "snapshot_id"=? ORDER BY "rank" ASC,"score" DESC,"user_id" ASC`).bind(m.snapshotId).all();
  if ((rows.results || []).length !== m.entryCount || await checksum(m,(rows.results || []).map((r:any)=>({userId:String(r.userId),rank:Number(r.rank),tieSize:Number(r.tieSize),score:Number(r.score),levelSnapshot:r.levelSnapshot === null ? null : Number(r.levelSnapshot)}))) !== m.projectionChecksum) throw new Error("Projection checksum mismatch.");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE \"leaderboard_cache_snapshots\" SET \"state\"='READY',\"projected_at\"=? WHERE \"snapshot_id\"=? AND \"state\"='BUILDING'").bind(now,m.snapshotId),
    env.DB.prepare(`INSERT INTO "leaderboard_cache_current" VALUES (?,?,?,?,?,?,?,?) ON CONFLICT ("scope","season_key") DO UPDATE SET "snapshot_id"=excluded."snapshot_id","snapshot_type"=excluded."snapshot_type","revision"=excluded."revision","generated_at"=excluded."generated_at","score_through"=excluded."score_through","updated_at"=excluded."updated_at" WHERE ("leaderboard_cache_current"."snapshot_type"='LIVE' AND excluded."snapshot_type"='FINAL') OR ("leaderboard_cache_current"."snapshot_type"='FINAL' AND excluded."snapshot_type"='FINAL' AND excluded."revision">"leaderboard_cache_current"."revision") OR ("leaderboard_cache_current"."snapshot_type"='LIVE' AND excluded."snapshot_type"='LIVE' AND (excluded."generated_at">"leaderboard_cache_current"."generated_at" OR (excluded."generated_at"="leaderboard_cache_current"."generated_at" AND excluded."snapshot_id">"leaderboard_cache_current"."snapshot_id")))`).bind(m.scope,m.seasonKey,m.snapshotId,m.snapshotType,m.revision,m.generatedAt,m.scoreThrough,now),
  ]);
  if (m.snapshotType === "LIVE") {
    const expired = await env.DB.prepare(`SELECT "snapshot_id" FROM "leaderboard_cache_snapshots" WHERE "snapshot_type"='LIVE' AND "state"='READY' AND "snapshot_id" NOT IN (SELECT "snapshot_id" FROM "leaderboard_cache_current") AND "generated_at" < ? LIMIT 25`).bind(new Date(Date.now()-30*60*1000).toISOString()).all();
    for (const row of (expired.results || []) as any[]) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM \"leaderboard_cache_entries\" WHERE \"snapshot_id\"=?").bind(row.snapshot_id),
        env.DB.prepare("DELETE FROM \"leaderboard_cache_chunks\" WHERE \"snapshot_id\"=?").bind(row.snapshot_id),
        env.DB.prepare("DELETE FROM \"leaderboard_cache_snapshots\" WHERE \"snapshot_id\"=?").bind(row.snapshot_id),
      ]);
    }
  }
  return response({ok:true,state:"READY",snapshotId:m.snapshotId});
}
async function reset(env: Env, snapshotId: string): Promise<Response> {
  const current = await env.DB.prepare("SELECT 1 FROM \"leaderboard_cache_current\" WHERE \"snapshot_id\"=? LIMIT 1").bind(snapshotId).first();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM \"leaderboard_cache_entries\" WHERE \"snapshot_id\"=?").bind(snapshotId),
    env.DB.prepare("DELETE FROM \"leaderboard_cache_chunks\" WHERE \"snapshot_id\"=?").bind(snapshotId),
    env.DB.prepare("DELETE FROM \"leaderboard_cache_snapshots\" WHERE \"snapshot_id\"=?").bind(snapshotId),
    ...(current ? [env.DB.prepare("DELETE FROM \"leaderboard_cache_current\" WHERE \"snapshot_id\"=?").bind(snapshotId)] : []),
  ]);
  return response({ ok: true, snapshotId, reset: true });
}
function queryText(url: URL, key: string, max = 300): string { return text(url.searchParams.get(key), key, max); }
async function read(env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (!["/internal/leaderboard-cache/current", "/internal/leaderboard-cache/page",
    "/internal/leaderboard-cache/rank", "/internal/leaderboard-cache/metadata"].includes(path)) {
    return response({ ok: false, error: "Unknown leaderboard cache endpoint." }, 404);
  }
  if (path.endsWith("/current")) {
    const row = await env.DB.prepare("SELECT s.* FROM \"leaderboard_cache_current\" c JOIN \"leaderboard_cache_snapshots\" s ON s.snapshot_id=c.snapshot_id WHERE c.scope=? AND c.season_key=? AND s.state='READY'").bind(queryText(url,"scope",16),queryText(url,"seasonKey",64)).first();
    return response({ok:true,manifest:manifestDto(row)});
  }
  const snapshotId = queryText(url,"snapshotId");
  const includeBuilding = path.endsWith("/metadata") && url.searchParams.get("includeBuilding") === "true";
  const snapshot = await env.DB.prepare(`SELECT * FROM "leaderboard_cache_snapshots" WHERE "snapshot_id"=? ${includeBuilding ? "" : "AND \"state\"='READY'"}`).bind(snapshotId).first();
  if (!snapshot) return response({ok:false,code:"CACHE_MISSING"},404);
  if (path.endsWith("/metadata")) {
    const [entries, chunks] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) count FROM \"leaderboard_cache_entries\" WHERE \"snapshot_id\"=?").bind(snapshotId).first(),
      env.DB.prepare("SELECT \"chunk_index\" FROM \"leaderboard_cache_chunks\" WHERE \"snapshot_id\"=? ORDER BY \"chunk_index\" ASC").bind(snapshotId).all(),
    ]);
    const actualEntryCount = Number(entries?.count || 0);
    const chunkRows = (chunks.results || []) as any[];
    let actualProjectionChecksum: string | null = null;
    if (Number.isSafeInteger(actualEntryCount) && actualEntryCount >= 0 && actualEntryCount <= MAX_ENTRIES) {
      try {
        const cached = await env.DB.prepare(`SELECT "user_id" userId,"rank","tie_size" tieSize,"score","level_snapshot" levelSnapshot
          FROM "leaderboard_cache_entries" WHERE "snapshot_id"=?
          ORDER BY "rank" ASC,"score" DESC,"user_id" ASC`).bind(snapshotId).all();
        const rows = (cached.results || []) as any[];
        if (rows.length === actualEntryCount && rows.length <= MAX_ENTRIES) {
          const m: Manifest = {
            snapshotId: String(snapshot.snapshot_id), seasonId: String(snapshot.season_id),
            scope: String(snapshot.scope), seasonKey: String(snapshot.season_key),
            snapshotType: snapshot.snapshot_type, revision: Number(snapshot.revision),
            seasonStatus: String(snapshot.season_status), startsAt: snapshot.starts_at ?? null,
            endsAt: snapshot.ends_at ?? null, generatedAt: String(snapshot.generated_at),
            scoreThrough: String(snapshot.score_through), entryCount: Number(snapshot.entry_count),
            sourceFingerprint: String(snapshot.source_fingerprint),
            projectionChecksum: String(snapshot.projection_checksum),
            chunkCount: Number(snapshot.chunk_count), rankingVersion: RANKING,
            cacheSchemaVersion: SCHEMA,
          };
          actualProjectionChecksum = await checksum(m, rows.map((r: any) => ({
            userId: String(r.userId), rank: Number(r.rank), tieSize: Number(r.tieSize),
            score: Number(r.score), levelSnapshot: r.levelSnapshot === null ? null : Number(r.levelSnapshot),
          })));
        }
      } catch {
        actualProjectionChecksum = null;
      }
    }
    return response({
      ok:true, manifest:manifestDto(snapshot), actualEntryCount,
      actualChunkCount:chunkRows.length,
      chunkIndexes:chunkRows.map((row) => Number(row.chunk_index)),
      actualProjectionChecksum,
    });
  }
  if (path.endsWith("/rank")) {
    const userId=queryText(url,"userId",200); const row=await env.DB.prepare("SELECT * FROM \"leaderboard_cache_entries\" WHERE snapshot_id=? AND user_id=?").bind(snapshotId,userId).first();
    return response({ok:true,manifest:manifestDto(snapshot),entry:row || null});
  }
  const limit=Math.min(integer(Number(url.searchParams.get("limit")||50),"limit",1,100),100);
  const rank=url.searchParams.get("afterRank"), score=url.searchParams.get("afterScore"), user=url.searchParams.get("afterUserId");
  let sql=`SELECT user_id userId,rank,tie_size tieSize,score,level_snapshot levelSnapshot FROM "leaderboard_cache_entries" WHERE snapshot_id=?`;
  const args:any[]=[snapshotId];
  if (rank !== null || score !== null || user !== null) { if (!rank || !score || !user) throw new Error("Cursor is incomplete."); integer(Number(rank),"afterRank",1,2147483647); integer(Number(score),"afterScore",-9007199254740991,9007199254740991); sql += ` AND (rank>? OR (rank=? AND score<?) OR (rank=? AND score=? AND user_id>?))`; args.push(Number(rank),Number(rank),Number(score),Number(rank),Number(score),user); }
  sql += ` ORDER BY rank ASC,score DESC,user_id ASC LIMIT ?`; args.push(limit+1);
  const result=await env.DB.prepare(sql).bind(...args).all(); const rows=result.results||[]; const entries=rows.slice(0,limit);
  return response({ok:true,manifest:manifestDto(snapshot),entries,nextCursor:rows.length>limit?{afterRank:entries[entries.length-1].rank,afterScore:entries[entries.length-1].score,afterUserId:entries[entries.length-1].userId}:null});
}
export async function handleLeaderboardCache(request: Request, env: Env): Promise<Response> {
  const url=new URL(request.url); const raw=request.method==="GET"?"":await request.text();
  if(raw.length>MAX_BODY)return response({ok:false,code:"PAYLOAD_TOO_LARGE"},413);
  const auth=await authenticate(request,env,raw); if(auth)return auth;
  try {
    if(request.method==="GET") return await read(env,url);
    if (url.pathname === "/internal/leaderboard-cache/reset") {
      const payload = JSON.parse(raw);
      if (!record(payload) || typeof payload.snapshotId !== "string" || !payload.snapshotId || payload.snapshotId.length > 300) throw new Error("Invalid snapshotId.");
      return await reset(env, payload.snapshotId);
    }
    const payload=JSON.parse(raw); if(!record(payload))throw new Error("Invalid JSON.");
    const m=parseManifest(payload.manifest);
    if(url.pathname.endsWith("/begin")) return await begin(env,m);
    if(url.pathname.endsWith("/chunk")) return await chunk(env,m,integer(payload.chunkIndex,"chunkIndex",0,m.chunkCount-1),Array.isArray(payload.entries)?payload.entries.map(parseEntry):[],hex(payload.chunkHash,"chunkHash"));
    if(url.pathname.endsWith("/commit")) return await commit(env,m);
    return response({ok:false,error:"Unknown leaderboard cache endpoint."},404);
  } catch(error) {
    const message=error instanceof Error?error.message:"Leaderboard cache failed.";
    const schemaIncompatible=/no such (?:table|column)|schema.{0,20}(?:version|incompatib|missing)|unsupported.{0,20}(?:version|schema)/iu.test(message);
    const conflict=message.includes("CONFLICT")||message.includes("checksum")||message.includes("hash");
    const invalid=message.startsWith("Invalid")||message.includes("required")||message.includes("Unsupported")||message.includes("inconsistent")||message.includes("Cursor");
    const status=schemaIncompatible?500:conflict?409:invalid?400:500;
    const code=schemaIncompatible
      ?"LEADERBOARD_CACHE_SCHEMA_INCOMPATIBLE"
      :conflict
        ?"LEADERBOARD_CACHE_DETERMINISTIC_CONFLICT"
        :"LEADERBOARD_CACHE_"+(invalid?"INVALID":"UNAVAILABLE");
    return response({ok:false,code,error:invalid?message.slice(0,160):"Leaderboard cache unavailable."},status);
  }
}