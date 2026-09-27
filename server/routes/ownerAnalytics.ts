import express, { type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  applyOwnerAnalyticsPrivacy,
  MIN_OWNER_ANALYTICS_CONTRIBUTORS,
  MIN_OWNER_ANALYTICS_INTERACTIONS,
  OWNER_ANALYTICS_PRIVACY_VERSION,
  type OwnerAnalyticsScopeStatus,
} from "../features/owner-analytics/privacy.js";
import { getOwnerAcademicAggregates } from "../features/owner-analytics/aggregateService.js";
import type {
  OwnerAcademicAggregateInput,
  OwnerAcademicAggregates,
} from "../features/owner-analytics/types.js";
import {
  decodeOwnerAnalyticsLectureCursor,
  encodeOwnerAnalyticsLectureCursor,
  isCanonicalLectureId,
  OwnerAnalyticsCursorError,
  type OwnerAnalyticsLectureCursor,
} from "../features/owner-analytics/cursor.js";
import {
  isOwnerAnalyticsWindowPreset,
  OwnerAnalyticsWindowError,
  resolveOwnerAnalyticsWindow,
  type OwnerAnalyticsWindowPreset,
} from "../features/owner-analytics/windows.js";
import { logger } from "../services/logger.js";
import { getPrisma } from "../services/prismaClient.js";

export const OWNER_ANALYTICS_DEFAULT_LECTURE_LIMIT = 25;
export const OWNER_ANALYTICS_MAX_LECTURE_LIMIT = 100;
export const OWNER_ANALYTICS_RATE_LIMIT_PER_MINUTE = 60;

type OwnerAnalyticsRequest = express.Request & {
  user?: { id?: string; role?: string };
};

type OwnerAnalyticsContentDatabase = Pick<PrismaClient, "lecture">;

type OwnerAnalyticsAccessLog = {
  actorUserId: string | null;
  route: string;
  windowPreset: OwnerAnalyticsWindowPreset | null;
  subjectId?: string;
  lectureId?: string;
  httpStatus: number;
  privacyResultClass: string;
  requestTimestamp: string;
};

export type OwnerAnalyticsRouterDependencies = {
  requireOwner: RequestHandler;
  database?: OwnerAnalyticsContentDatabase;
  getAggregates?: (input: OwnerAcademicAggregateInput) => Promise<OwnerAcademicAggregates>;
  now?: () => Date;
  onAccessLog?: (entry: OwnerAnalyticsAccessLog) => void;
  rateLimiter?: RequestHandler;
};

type RouteContext = {
  preset: OwnerAnalyticsWindowPreset | null;
  subjectId?: string;
  lectureId?: string;
};

const OWNER_ANALYTICS_ROUTE_PREFIX = "/api/admin/owner-analytics";

export const ownerAnalyticsNoStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  res.vary("Authorization");
  next();
};

function createOwnerAnalyticsRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: OWNER_ANALYTICS_RATE_LIMIT_PER_MINUTE,
    keyGenerator: (req) => {
      const ownerId = (req as OwnerAnalyticsRequest).user?.id;
      return typeof ownerId === "string" && ownerId.length > 0 ? `owner:${ownerId}` : "missing-owner";
    },
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({
      error: "Owner analytics request limit exceeded.",
      code: "OWNER_ANALYTICS_RATE_LIMITED",
    }),
  });
}

function validSubjectId(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 255
    || value.trim() !== value
  ) {
    return false;
  }
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function requestHasUnsupportedBody(req: express.Request): boolean {
  const body = req.body as unknown;
  const hasBody = body !== undefined && body !== null;
  const hasStructuredFields = hasBody && typeof body === "object"
    ? Array.isArray(body) || Object.keys(body).length > 0
    : hasBody;
  const hasUnparsedBody = Number(req.get("content-length") ?? "0") > 0
    || req.headers["transfer-encoding"] !== undefined;
  return hasStructuredFields || hasUnparsedBody;
}

function queryHasOnly(
  req: express.Request,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(req.query).every((key) => allowedKeys.has(key));
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePreset(value: unknown): OwnerAnalyticsWindowPreset | null {
  if (value === undefined) return "LAST_7_DAYS";
  return isOwnerAnalyticsWindowPreset(value) ? value : null;
}

function parseLimit(value: unknown): number | null {
  if (value === undefined) return OWNER_ANALYTICS_DEFAULT_LECTURE_LIMIT;
  if (typeof value !== "string" || !/^[0-9]{1,3}$/u.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= OWNER_ANALYTICS_MAX_LECTURE_LIMIT ? limit : null;
}

function routePath(req: express.Request): string {
  const route = req.route?.path;
  return typeof route === "string" ? `${OWNER_ANALYTICS_ROUTE_PREFIX}${route}` : req.path;
}

function logAccess(
  req: express.Request,
  context: RouteContext,
  status: number,
  privacyResultClass: string,
  customLogger?: OwnerAnalyticsRouterDependencies["onAccessLog"],
): void {
  const actorUserId = (req as OwnerAnalyticsRequest).user?.id ?? null;
  const entry: OwnerAnalyticsAccessLog = {
    actorUserId,
    route: routePath(req),
    windowPreset: context.preset,
    ...(context.subjectId ? { subjectId: context.subjectId } : {}),
    ...(context.lectureId ? { lectureId: context.lectureId } : {}),
    httpStatus: status,
    privacyResultClass,
    requestTimestamp: new Date().toISOString(),
  };
  if (customLogger) {
    customLogger(entry);
    return;
  }
  logger.info("OWNER_ANALYTICS_ACCESS", "Owner analytics request completed.", {
    userId: actorUserId,
    endpoint: entry.route,
    method: req.method,
    statusCode: status,
    details: {
      windowPreset: entry.windowPreset,
      ...(entry.subjectId ? { subjectId: entry.subjectId } : {}),
      ...(entry.lectureId ? { lectureId: entry.lectureId } : {}),
      privacyResultClass,
      requestTimestamp: entry.requestTimestamp,
    },
  });
}

function sendFailure(
  req: express.Request,
  res: express.Response,
  context: RouteContext,
  status: number,
  code: string,
  error: string,
  customLogger?: OwnerAnalyticsRouterDependencies["onAccessLog"],
): express.Response {
  logAccess(req, context, status, code, customLogger);
  return res.status(status).json({ error, code });
}

function sendUnexpectedFailure(
  req: express.Request,
  res: express.Response,
  context: RouteContext,
  customLogger?: OwnerAnalyticsRouterDependencies["onAccessLog"],
): express.Response {
  return sendFailure(
    req,
    res,
    context,
    503,
    "OWNER_ANALYTICS_UNAVAILABLE",
    "Owner analytics are temporarily unavailable.",
    customLogger,
  );
}

function resolveRouteWindow(
  preset: OwnerAnalyticsWindowPreset,
  now: () => Date,
) {
  return resolveOwnerAnalyticsWindow(preset, now());
}

function privacyEnvelope() {
  return {
    policyVersion: OWNER_ANALYTICS_PRIVACY_VERSION,
    minimumContributors: MIN_OWNER_ANALYTICS_CONTRIBUTORS,
    minimumRateInteractions: MIN_OWNER_ANALYTICS_INTERACTIONS,
  };
}

function toResponseWindow(
  preset: OwnerAnalyticsWindowPreset,
  window: { from: Date; to: Date; asOf: Date },
) {
  return {
    preset,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    asOf: window.asOf.toISOString(),
  };
}

function getScopeStatus(statuses: readonly OwnerAnalyticsScopeStatus[]): OwnerAnalyticsScopeStatus {
  if (statuses.includes("LOW_POPULATION")) return "LOW_POPULATION";
  if (statuses.includes("PARTIALLY_SUPPRESSED")) return "PARTIALLY_SUPPRESSED";
  if (statuses.includes("VISIBLE")) {
    return statuses.includes("LOW_SAMPLE") ? "PARTIALLY_SUPPRESSED" : "VISIBLE";
  }
  if (statuses.includes("LOW_SAMPLE")) return "LOW_SAMPLE";
  if (statuses.includes("UNAVAILABLE")) return "UNAVAILABLE";
  return "NO_DATA";
}

function invalidRequest(
  req: express.Request,
  res: express.Response,
  context: RouteContext,
  customLogger?: OwnerAnalyticsRouterDependencies["onAccessLog"],
): express.Response {
  return sendFailure(
    req,
    res,
    context,
    400,
    "OWNER_ANALYTICS_INVALID_REQUEST",
    "Owner analytics request is invalid.",
    customLogger,
  );
}

export function createOwnerAnalyticsRouter(
  dependencies: OwnerAnalyticsRouterDependencies,
): express.Router {
  const router = express.Router();
  const database = dependencies.database ?? getPrisma() as PrismaClient;
  const aggregate = dependencies.getAggregates ?? getOwnerAcademicAggregates;
  const now = dependencies.now ?? (() => new Date());
  const onAccessLog = dependencies.onAccessLog;
  router.use(ownerAnalyticsNoStore);
  router.use(dependencies.requireOwner);
  router.use(dependencies.rateLimiter ?? createOwnerAnalyticsRateLimiter());

  router.get("/academic", async (req, res) => {
    const context: RouteContext = { preset: null };
    if (
      !queryHasOnly(req, ["window"])
      || requestHasUnsupportedBody(req)
    ) {
      return invalidRequest(req, res, context, onAccessLog);
    }
    const preset = parsePreset(req.query.window);
    if (!preset) return invalidRequest(req, res, context, onAccessLog);
    context.preset = preset;

    let window: ReturnType<typeof resolveRouteWindow>;
    try {
      window = resolveRouteWindow(preset, now);
    } catch (error) {
      if (error instanceof OwnerAnalyticsWindowError) {
        const unavailable = error.code === "SEMESTER_CONFIGURATION_UNAVAILABLE";
        return sendFailure(
          req,
          res,
          context,
          unavailable ? 503 : 400,
          error.code,
          unavailable
            ? "Current semester configuration is unavailable."
            : "Owner analytics window is invalid.",
          onAccessLog,
        );
      }
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }
    try {
      const raw = await aggregate({
        window: { from: window.from, to: window.to },
        asOf: window.asOf,
      });
      const safe = applyOwnerAnalyticsPrivacy({
        aggregate: raw,
        policyVersion: OWNER_ANALYTICS_PRIVACY_VERSION,
        scopePopulation: raw.population.eligibleStudents,
      });
      const response = {
        analyticsVersion: safe.analyticsVersion,
        privacy: privacyEnvelope(),
        window: toResponseWindow(preset, window),
        analyticsStatus: safe.cohort.analyticsStatus,
        ...safe.cohort,
        subjects: safe.subjects,
      };
      logAccess(req, context, 200, safe.cohort.analyticsStatus, onAccessLog);
      return res.status(200).json(response);
    } catch {
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }
  });

  router.get("/subjects/:subjectId", async (req, res) => {
    const subjectId = req.params.subjectId;
    const context: RouteContext = {
      preset: null,
      ...(typeof subjectId === "string" ? { subjectId } : {}),
    };
    if (
      !queryHasOnly(req, ["window"])
      || requestHasUnsupportedBody(req)
      || !validSubjectId(subjectId)
    ) {
      return invalidRequest(req, res, context, onAccessLog);
    }
    const preset = parsePreset(req.query.window);
    if (!preset) return invalidRequest(req, res, context, onAccessLog);
    context.preset = preset;
    try {
      const content = await database.lecture.findFirst({
        where: { mainSubject: subjectId },
        select: { id: true },
      });
      if (!content) {
        return sendFailure(
          req,
          res,
          context,
          404,
          "OWNER_ANALYTICS_SUBJECT_NOT_FOUND",
          "Subject was not found.",
          onAccessLog,
        );
      }
    } catch {
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }
    let window: ReturnType<typeof resolveRouteWindow>;
    try {
      window = resolveRouteWindow(preset, now);
    } catch (error) {
      if (error instanceof OwnerAnalyticsWindowError) {
        const unavailable = error.code === "SEMESTER_CONFIGURATION_UNAVAILABLE";
        return sendFailure(
          req,
          res,
          context,
          unavailable ? 503 : 400,
          error.code,
          unavailable
            ? "Current semester configuration is unavailable."
            : "Owner analytics window is invalid.",
          onAccessLog,
        );
      }
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }
    try {
      const raw = await aggregate({
        window: { from: window.from, to: window.to },
        asOf: window.asOf,
        subjectIds: [subjectId],
      });
      const safe = applyOwnerAnalyticsPrivacy({
        aggregate: raw,
        policyVersion: OWNER_ANALYTICS_PRIVACY_VERSION,
        scopePopulation: raw.population.eligibleStudents,
      });
      const subject = safe.subjects.find((entry) => entry.subjectId === subjectId);
      if (!subject) {
        return sendFailure(
          req,
          res,
          context,
          404,
          "OWNER_ANALYTICS_SUBJECT_NOT_FOUND",
          "Subject was not found.",
          onAccessLog,
        );
      }
      logAccess(req, context, 200, subject.analyticsStatus, onAccessLog);
      return res.status(200).json({
        analyticsVersion: safe.analyticsVersion,
        privacy: privacyEnvelope(),
        window: toResponseWindow(preset, window),
        subject,
      });
    } catch {
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }
  });

  router.get("/lectures", async (req, res) => {
    const context: RouteContext = { preset: null };
    if (
      !queryHasOnly(req, ["window", "subjectId", "cursor", "limit"])
      || requestHasUnsupportedBody(req)
    ) {
      return invalidRequest(req, res, context, onAccessLog);
    }
    const preset = parsePreset(req.query.window);
    const subjectQuery = req.query.subjectId;
    const subjectId = subjectQuery === undefined ? undefined : queryString(subjectQuery);
    const limit = parseLimit(req.query.limit);
    if (
      !preset
      || (subjectQuery !== undefined && !validSubjectId(subjectId))
      || limit === null
    ) {
      return invalidRequest(req, res, context, onAccessLog);
    }
    context.preset = preset;
    if (subjectId !== undefined) context.subjectId = subjectId;

    let cursor: OwnerAnalyticsLectureCursor | undefined;
    if (req.query.cursor !== undefined) {
      try {
        cursor = decodeOwnerAnalyticsLectureCursor(req.query.cursor);
      } catch (error) {
        if (error instanceof OwnerAnalyticsCursorError) {
          return invalidRequest(req, res, context, onAccessLog);
        }
        return invalidRequest(req, res, context, onAccessLog);
      }
      if (subjectId !== undefined && cursor.subjectId !== subjectId) {
        return invalidRequest(req, res, context, onAccessLog);
      }
    }

    try {
      if (subjectId !== undefined) {
        const content = await database.lecture.findFirst({
          where: { mainSubject: subjectId },
          select: { id: true },
        });
        if (!content) {
          return sendFailure(
            req,
            res,
            context,
            404,
            "OWNER_ANALYTICS_SUBJECT_NOT_FOUND",
            "Subject was not found.",
            onAccessLog,
          );
        }
      }
    } catch {
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }

    let window: ReturnType<typeof resolveRouteWindow>;
    try {
      window = resolveRouteWindow(preset, now);
    } catch (error) {
      if (error instanceof OwnerAnalyticsWindowError) {
        const unavailable = error.code === "SEMESTER_CONFIGURATION_UNAVAILABLE";
        return sendFailure(
          req,
          res,
          context,
          unavailable ? 503 : 400,
          error.code,
          unavailable
            ? "Current semester configuration is unavailable."
            : "Owner analytics window is invalid.",
          onAccessLog,
        );
      }
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }

    try {
      const conditions: Prisma.LectureWhereInput[] = [];
      if (subjectId !== undefined) conditions.push({ mainSubject: subjectId });
      if (cursor) {
        conditions.push({
          OR: [
            { mainSubject: { gt: cursor.subjectId } },
            { mainSubject: cursor.subjectId, id: { gt: cursor.lectureId } },
          ],
        });
      }
      const content = await database.lecture.findMany({
        where: conditions.length > 0 ? { AND: conditions } : undefined,
        select: { id: true, mainSubject: true },
        orderBy: [{ mainSubject: "asc" }, { id: "asc" }],
        take: limit + 1,
      });
      const hasMore = content.length > limit;
      const page = hasMore ? content.slice(0, limit) : content;
      const nextCursor = hasMore && page.length > 0
        ? encodeOwnerAnalyticsLectureCursor({
            subjectId: page[page.length - 1]!.mainSubject,
            lectureId: page[page.length - 1]!.id,
          })
        : null;
      if (page.length === 0) {
        logAccess(req, context, 200, "NO_DATA", onAccessLog);
        return res.status(200).json({
          analyticsVersion: "owner-academic-analytics-v1",
          privacy: privacyEnvelope(),
          window: toResponseWindow(preset, window),
          lectures: [],
          pageInfo: {
            limit,
            nextCursor,
          },
        });
      }

      const raw = await aggregate({
        window: { from: window.from, to: window.to },
        asOf: window.asOf,
        ...(subjectId !== undefined ? { subjectIds: [subjectId] } : {}),
        lectureIds: page.map((lecture) => lecture.id),
      });
      const safe = applyOwnerAnalyticsPrivacy({
        aggregate: raw,
        policyVersion: OWNER_ANALYTICS_PRIVACY_VERSION,
        scopePopulation: raw.population.eligibleStudents,
      });
      const byLectureId = new Map(safe.lectures.map((lecture) => [lecture.lectureId, lecture]));
      const safeLectures = page.flatMap((lecture) => {
        const result = byLectureId.get(lecture.id);
        return result ? [result] : [];
      });
      const privacyResult = getScopeStatus(safeLectures.map((lecture) => lecture.analyticsStatus));
      logAccess(req, context, 200, privacyResult, onAccessLog);
      return res.status(200).json({
        analyticsVersion: safe.analyticsVersion,
        privacy: privacyEnvelope(),
        window: toResponseWindow(preset, window),
        lectures: safeLectures,
        pageInfo: {
          limit,
          nextCursor,
        },
      });
    } catch (error) {
      if (error instanceof OwnerAnalyticsCursorError) {
        return invalidRequest(req, res, context, onAccessLog);
      }
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }
  });

  router.get("/lectures/:lectureId", async (req, res) => {
    const lectureId = req.params.lectureId;
    const context: RouteContext = {
      preset: null,
      ...(typeof lectureId === "string" ? { lectureId } : {}),
    };
    if (
      !queryHasOnly(req, ["window"])
      || requestHasUnsupportedBody(req)
      || !isCanonicalLectureId(lectureId)
    ) {
      return invalidRequest(req, res, context, onAccessLog);
    }
    const preset = parsePreset(req.query.window);
    if (!preset) return invalidRequest(req, res, context, onAccessLog);
    context.preset = preset;
    try {
      const content = await database.lecture.findUnique({
        where: { id: lectureId },
        select: { id: true },
      });
      if (!content) {
        return sendFailure(
          req,
          res,
          context,
          404,
          "OWNER_ANALYTICS_LECTURE_NOT_FOUND",
          "Lecture was not found.",
          onAccessLog,
        );
      }
    } catch {
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }
    let window: ReturnType<typeof resolveRouteWindow>;
    try {
      window = resolveRouteWindow(preset, now);
    } catch (error) {
      if (error instanceof OwnerAnalyticsWindowError) {
        const unavailable = error.code === "SEMESTER_CONFIGURATION_UNAVAILABLE";
        return sendFailure(
          req,
          res,
          context,
          unavailable ? 503 : 400,
          error.code,
          unavailable
            ? "Current semester configuration is unavailable."
            : "Owner analytics window is invalid.",
          onAccessLog,
        );
      }
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }
    try {
      const raw = await aggregate({
        window: { from: window.from, to: window.to },
        asOf: window.asOf,
        lectureIds: [lectureId],
      });
      const safe = applyOwnerAnalyticsPrivacy({
        aggregate: raw,
        policyVersion: OWNER_ANALYTICS_PRIVACY_VERSION,
        scopePopulation: raw.population.eligibleStudents,
      });
      const lecture = safe.lectures.find((entry) => entry.lectureId === lectureId);
      if (!lecture) {
        return sendFailure(
          req,
          res,
          context,
          404,
          "OWNER_ANALYTICS_LECTURE_NOT_FOUND",
          "Lecture was not found.",
          onAccessLog,
        );
      }
      logAccess(req, context, 200, lecture.analyticsStatus, onAccessLog);
      return res.status(200).json({
        analyticsVersion: safe.analyticsVersion,
        privacy: privacyEnvelope(),
        window: toResponseWindow(preset, window),
        lecture,
      });
    } catch {
      return sendUnexpectedFailure(req, res, context, onAccessLog);
    }
  });

  return router;
}