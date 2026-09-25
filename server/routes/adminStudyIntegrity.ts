import express, { type RequestHandler } from "express";
import {
  INTEGRITY_OBSERVATION_CATALOG,
  INTEGRITY_OBSERVATION_CATEGORIES,
  type IntegrityObservationCategory,
  type IntegrityObservationCode,
  type IntegrityObservationSeverity,
} from "../features/study-integrity/constants.js";
import {
  StudyIntegrityPersistenceError,
  StudyIntegrityService,
  type IntegrityReviewActionType,
  type IntegritySignalStatus,
} from "../features/study-integrity/persistence/index.js";

const BODY_LIMIT_BYTES = 16 * 1024;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const MAX_FILTER_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REVIEW_ACTIONS = new Set<IntegrityReviewActionType>([
  "ACKNOWLEDGE",
  "RESOLVE",
  "DISMISS",
  "REOPEN",
  "ADD_NOTE",
]);
const SIGNAL_STATUSES = new Set<IntegritySignalStatus>([
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
  "DISMISSED",
]);
const SEVERITIES = new Set<IntegrityObservationSeverity>([
  "INFO",
  "REVIEW",
  "BLOCK",
]);
const CATEGORIES = new Set<IntegrityObservationCategory>(
  INTEGRITY_OBSERVATION_CATEGORIES,
);
const OBSERVATION_CODES = new Set<IntegrityObservationCode>(
  Object.keys(INTEGRITY_OBSERVATION_CATALOG) as IntegrityObservationCode[],
);

type QueryValue = string | string[] | ParsedQsValue | ParsedQsValue[];
type ParsedQsValue = { [key: string]: unknown } | undefined;
type AdminRequest = express.Request & {
  user?: { id?: unknown; role?: unknown };
};

function sendInvalidQuery(res: express.Response, message: string) {
  return res.status(400).json({ error: message, code: "INVALID_QUERY" });
}

function queryString(
  query: Record<string, QueryValue>,
  key: string,
): string | undefined | null {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

function parseDate(value: string): Date | null {
  if (value.length > 40) return null;
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return null;
  const date = new Date(timestamp);
  return Number.isSafeInteger(date.getTime()) ? date : null;
}

function parseListFilters(
  req: express.Request,
): ReturnType<typeof parseListFiltersUnchecked> | null {
  return parseListFiltersUnchecked(req.query as Record<string, QueryValue>);
}

function parseListFiltersUnchecked(query: Record<string, QueryValue>) {
  const allowedKeys = new Set([
    "status",
    "severity",
    "category",
    "observationCode",
    "actionType",
    "userId",
    "ruleId",
    "from",
    "to",
    "limit",
    "cursor",
  ]);
  if (Object.keys(query).some((key) => !allowedKeys.has(key))) return null;

  const raw = Object.fromEntries(
    [...allowedKeys].map((key) => [key, queryString(query, key)]),
  ) as Record<string, string | undefined | null>;
  if (Object.values(raw).some((value) => value === null)) return null;

  const status = raw.status;
  const includeAllStatuses = status?.toLowerCase() === "all";
  if (status && !includeAllStatuses && !SIGNAL_STATUSES.has(status as IntegritySignalStatus)) {
    return null;
  }
  const severity = raw.severity;
  if (severity && !SEVERITIES.has(severity as IntegrityObservationSeverity)) return null;
  const category = raw.category;
  if (category && !CATEGORIES.has(category as IntegrityObservationCategory)) return null;
  const observationCode = raw.observationCode;
  if (
    observationCode
    && !OBSERVATION_CODES.has(observationCode as IntegrityObservationCode)
  ) {
    return null;
  }
  if (raw.actionType && raw.actionType.length > 96) return null;
  if (raw.userId && raw.userId.length > 128) return null;
  if (raw.ruleId && raw.ruleId.length > 128) return null;

  let from: Date | undefined;
  let to: Date | undefined;
  if (raw.from) {
    from = parseDate(raw.from) ?? undefined;
    if (!from) return null;
  }
  if (raw.to) {
    to = parseDate(raw.to) ?? undefined;
    if (!to) return null;
  }
  if (from || to) {
    const now = Date.now();
    const upperBound = to ?? new Date(now);
    const lowerBound = from ?? new Date(
      Math.max(0, upperBound.getTime() - MAX_FILTER_RANGE_MS),
    );
    if (
      upperBound.getTime() > now
      || upperBound.getTime() < lowerBound.getTime()
      || upperBound.getTime() - lowerBound.getTime() > MAX_FILTER_RANGE_MS
    ) {
      return null;
    }
    from = lowerBound;
    to = upperBound;
  }
  const limit = raw.limit === undefined ? DEFAULT_PAGE_SIZE : Number(raw.limit);
  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > MAX_PAGE_SIZE
    || (raw.limit !== undefined && !/^\d{1,3}$/u.test(raw.limit))
  ) {
    return null;
  }
  const cursor = raw.cursor;
  if (cursor && (cursor.length > 128 || !UUID.test(cursor))) return null;

  return {
    ...(!includeAllStatuses
      ? { status: (status ?? "OPEN") as IntegritySignalStatus }
      : {}),
    includeAllStatuses,
    ...(severity ? { severity: severity as IntegrityObservationSeverity } : {}),
    ...(category ? { category: category as IntegrityObservationCategory } : {}),
    ...(observationCode
      ? { observationCode: observationCode as IntegrityObservationCode }
      : {}),
    ...(raw.actionType ? { actionType: raw.actionType } : {}),
    ...(raw.userId ? { userId: raw.userId } : {}),
    ...(raw.ruleId ? { ruleId: raw.ruleId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit,
    ...(cursor ? { cursor } : {}),
  };
}

function parseReviewBody(body: unknown): {
  action: IntegrityReviewActionType;
  expectedReviewVersion: number;
  note?: string;
} | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).some((key) =>
      !["action", "expectedReviewVersion", "note"].includes(key)
    )
    || typeof record.action !== "string"
    || !REVIEW_ACTIONS.has(record.action as IntegrityReviewActionType)
    || !Number.isSafeInteger(record.expectedReviewVersion)
    || (record.expectedReviewVersion as number) < 0
    || (record.expectedReviewVersion as number) >= 2_147_483_647
    || (record.note !== undefined && typeof record.note !== "string")
  ) {
    return null;
  }
  const note = record.note as string | undefined;
  if (
    note !== undefined
    && (
      Array.from(note).length > 1000
      || /<\/?[A-Za-z][^>]*>/u.test(note)
    )
  ) {
    return null;
  }
  if (record.action === "ADD_NOTE" && !note?.trim()) return null;
  return {
    action: record.action as IntegrityReviewActionType,
    expectedReviewVersion: record.expectedReviewVersion as number,
    ...(note !== undefined ? { note } : {}),
  };
}

function sendPersistenceError(
  res: express.Response,
  error: StudyIntegrityPersistenceError,
) {
  return res.status(error.status).json({
    error: error.message,
    code: error.code,
  });
}

export function createAdminStudyIntegrityJsonParser(): RequestHandler {
  const parser = express.json({
    limit: BODY_LIMIT_BYTES,
    type: "application/json",
  });
  return (req, res, next) => {
    parser(req, res, (error: unknown) => {
      if (!error) return next();
      const candidate = error as { status?: unknown; type?: unknown };
      if (candidate.status === 413 || candidate.type === "entity.too.large") {
        return res.status(413).json({
          error: "Review request body is too large.",
          code: "BODY_TOO_LARGE",
        });
      }
      if (error instanceof SyntaxError) {
        return res.status(400).json({
          error: "Request JSON is invalid.",
          code: "INVALID_JSON",
        });
      }
      return next(error);
    });
  };
}

export function createAdminStudyIntegrityRouter(dependencies: {
  requireAdmin: RequestHandler;
  service?: StudyIntegrityService;
}): express.Router {
  const router = express.Router();
  const service = dependencies.service ?? new StudyIntegrityService();
  router.use(dependencies.requireAdmin);

  router.get("/signals", async (req, res) => {
    const filters = parseListFilters(req);
    if (!filters) {
      return sendInvalidQuery(res, "Integrity signal filters are invalid.");
    }
    try {
      const result = await service.listSignals(filters);
      return res
        .set("Cache-Control", "no-store, private")
        .json(result);
    } catch {
      console.error("[StudyIntegrityAdmin] Signal list query failed.");
      return res.status(500).json({
        error: "Integrity signal list is unavailable.",
        code: "SIGNAL_LIST_FAILED",
      });
    }
  });

  router.get("/signals/:signalId", async (req, res) => {
    if (!UUID.test(req.params.signalId)) {
      return res.status(400).json({
        error: "Signal ID is invalid.",
        code: "INVALID_SIGNAL_ID",
      });
    }
    try {
      const result = await service.getSignalDetail(req.params.signalId);
      if (!result) {
        return res.status(404).json({
          error: "Integrity signal was not found.",
          code: "SIGNAL_NOT_FOUND",
        });
      }
      return res
        .set("Cache-Control", "no-store, private")
        .json(result);
    } catch {
      console.error("[StudyIntegrityAdmin] Signal detail query failed.");
      return res.status(500).json({
        error: "Integrity signal detail is unavailable.",
        code: "SIGNAL_DETAIL_FAILED",
      });
    }
  });

  router.post("/signals/:signalId/review", async (req, res) => {
    if (!UUID.test(req.params.signalId)) {
      return res.status(400).json({
        error: "Signal ID is invalid.",
        code: "INVALID_SIGNAL_ID",
      });
    }
    const body = parseReviewBody(req.body);
    if (!body) {
      return res.status(400).json({
        error: "Review request is invalid.",
        code: "INVALID_REVIEW_REQUEST",
      });
    }
    const userId = (req as AdminRequest).user?.id;
    if (typeof userId !== "string" || userId.length < 1 || userId.length > 128) {
      return res.status(401).json({
        error: "Authenticated reviewer context is missing.",
        code: "REVIEWER_CONTEXT_MISSING",
      });
    }
    try {
      const result = await service.reviewSignal({
        signalId: req.params.signalId,
        reviewerUserId: userId,
        ...body,
      });
      return res
        .set("Cache-Control", "no-store, private")
        .json(result);
    } catch (error) {
      if (error instanceof StudyIntegrityPersistenceError) {
        return sendPersistenceError(res, error);
      }
      console.error("[StudyIntegrityAdmin] Signal review transaction failed.");
      return res.status(500).json({
        error: "Integrity signal review is unavailable.",
        code: "SIGNAL_REVIEW_FAILED",
      });
    }
  });

  return router;
}