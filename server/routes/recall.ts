import express, { type RequestHandler } from "express";
import {
  createRecallAttemptService,
} from "../features/recall/attemptService.js";
import { isRecallError } from "../features/recall/errors.js";
import {
  recallAnswerBodySchema,
  recallAttemptIdSchema,
  recallSkipBodySchema,
} from "../features/recall/schemas.js";
import type { RecallAttemptService } from "../features/recall/types.js";
import { createRecallCandidateService } from "../features/recall/candidateService.js";
import { mintRecallInteractionToken, verifyRecallInteractionToken } from "../features/recall/interactionToken.js";
import { isStudyFeatureEnabled } from "../features/study-core/featureFlags.js";
import { getPrisma } from "../services/prismaClient.js";
import { lockRecallScope } from "../features/recall/repository.js";
import {
  RECALL_DAILY_ISSUANCE_CAP,
  RECALL_GLOBAL_ISSUANCE_COOLDOWN_MS,
  RECALL_POLICY_VERSION,
  RECALL_PROTECTED_ATTEMPT_TTL_MS,
  RECALL_WEEKLY_ISSUANCE_CAP,
} from "../features/recall/constants.js";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getStudyPointsBaghdadDayBounds } from "../features/study-points/caps.js";
import { getBaghdadWeekPeriod } from "../features/gamification/challengePeriods.js";
import { studyPointsBaghdadDate } from "../features/study-points/caps.js";

export interface RecallRouteDependencies {
  requireUser: RequestHandler;
  service?: RecallAttemptService;
  database?: PrismaClient;
  now?: () => Date;
  refreshMastery?(userId: string, lectureId: string): Promise<unknown>;
}

type AuthenticatedRequest = express.Request & { user: { id: string } };

type PeriodicEligibilityBlock =
  | { status: "NOT_DUE"; nextEligibleAt: Date }
  | { status: "DAILY_LIMIT_REACHED"; nextEligibleAt: Date }
  | { status: "WEEKLY_LIMIT_REACHED"; nextEligibleAt: Date };

async function findActivePeriodicAttempt(
  tx: Prisma.TransactionClient,
  userId: string,
  asOf: Date,
) {
  return tx.recallAttempt.findFirst({
    where: {
      userId,
      status: "PRESENTED",
      issuanceSource: "PERIODIC",
      issuancePolicyVersion: RECALL_POLICY_VERSION,
      expiresAt: { gt: asOf },
    },
    orderBy: [{ presentedAt: "desc" }, { id: "desc" }],
  });
}

async function findPeriodicEligibilityBlock(
  tx: Prisma.TransactionClient,
  userId: string,
  asOf: Date,
): Promise<PeriodicEligibilityBlock | null> {
  const latest = await tx.recallAttempt.findFirst({
    where: {
      userId,
      issuanceSource: "PERIODIC",
      issuancePolicyVersion: RECALL_POLICY_VERSION,
    },
    orderBy: [{ presentedAt: "desc" }, { id: "desc" }],
    select: { presentedAt: true },
  });
  if (
    latest &&
    latest.presentedAt.getTime() + RECALL_GLOBAL_ISSUANCE_COOLDOWN_MS >
      asOf.getTime()
  ) {
    return {
      status: "NOT_DUE",
      nextEligibleAt: new Date(
        latest.presentedAt.getTime() + RECALL_GLOBAL_ISSUANCE_COOLDOWN_MS,
      ),
    };
  }

  const day = await getStudyPointsBaghdadDayBounds(
    tx,
    studyPointsBaghdadDate(asOf),
  );
  const dayCount = await tx.recallAttempt.count({
    where: {
      userId,
      issuanceSource: "PERIODIC",
      issuancePolicyVersion: RECALL_POLICY_VERSION,
      presentedAt: { gte: day.start, lt: day.end },
    },
  });
  if (dayCount >= RECALL_DAILY_ISSUANCE_CAP) {
    return { status: "DAILY_LIMIT_REACHED", nextEligibleAt: day.end };
  }

  const week = getBaghdadWeekPeriod(asOf);
  const weekCount = await tx.recallAttempt.count({
    where: {
      userId,
      issuanceSource: "PERIODIC",
      issuancePolicyVersion: RECALL_POLICY_VERSION,
      presentedAt: { gte: week.startsAt, lt: week.endsAt },
    },
  });
  if (weekCount >= RECALL_WEEKLY_ISSUANCE_CAP) {
    return { status: "WEEKLY_LIMIT_REACHED", nextEligibleAt: week.endsAt };
  }

  return null;
}

export function createRecallJsonParser(): RequestHandler {
  const parser = express.json({ limit: "2kb" });
  return (req, res, next) => {
    parser(req, res, (error: unknown) => {
      if (!error) return next();
      const candidate = error as { status?: unknown; type?: unknown };
      if (candidate.status === 413 || candidate.type === "entity.too.large") {
        return res.status(413).json({
          error: "Recall request is too large.",
          code: "REQUEST_TOO_LARGE",
        });
      }
      if (error instanceof SyntaxError) {
        return res.status(400).json({
          error: "Recall request JSON is invalid.",
          code: "INVALID_REQUEST",
        });
      }
      return res.status(400).json({
        error: "Recall request could not be parsed.",
        code: "INVALID_REQUEST",
      });
    });
  };
}

export function createRecallRouter(
  dependencies: RecallRouteDependencies,
): express.Router {
  const router = express.Router();
  const service = dependencies.service ?? createRecallAttemptService();
  const database = dependencies.database ?? getPrisma();
  const now = dependencies.now ?? (() => new Date());
  const candidates = createRecallCandidateService({ database, attemptService: service });
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, private");
    next();
  });
  router.use(dependencies.requireUser);

  router.get("/eligibility", route(async (req, res) => {
    if (!isStudyFeatureEnabled("SPACED_RECALL_ENABLED")) {
      return res.status(404).json({ error: "Spaced Recall is not available.", code: "FEATURE_DISABLED" });
    }
    res.setHeader("Cache-Control", "no-store, private");
    const id = userId(req);
    const asOf = now();
    if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
      throw new Error("Recall server clock is invalid.");
    }
    const result = await database.$transaction(async (tx) => {
      if (await findActivePeriodicAttempt(tx, id, asOf)) {
        return { status: "ACTIVE_ATTEMPT" as const };
      }
      const block = await findPeriodicEligibilityBlock(tx, id, asOf);
      if (block) return block;
      const available = await candidates.hasEligibleProtectedRecallCandidate({
        userId: id,
        asOf,
        tx: tx as never,
      });
      return { status: available ? "AVAILABLE" as const : "NO_CANDIDATE" as const };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
    return res.json(result);
  }));

  router.get(
    "/attempts/:attemptId",
    route(async (req, res) => {
      if (!isStudyFeatureEnabled("SPACED_RECALL_ENABLED")) {
        return res.status(404).json({ error: "Spaced Recall is not available.", code: "FEATURE_DISABLED" });
      }
      res.setHeader("Cache-Control", "no-store, private");
      const parsedId = recallAttemptIdSchema.safeParse(req.params.attemptId);
      if (!parsedId.success) {
        return res.status(400).json({ error: "Recall attempt is invalid.", code: "INVALID_REQUEST" });
      }

      const id = userId(req);
      const attempt = await database.recallAttempt.findFirst({
        where: { id: parsedId.data, userId: id },
        select: {
          id: true,
          itemType: true,
          itemId: true,
          lectureId: true,
          issuanceSource: true,
          status: true,
          outcome: true,
          presentedAt: true,
          expiresAt: true,
        },
      });
      if (!attempt || attempt.issuanceSource !== "PERIODIC") {
        return res.status(404).json({ error: "Recall attempt not found.", code: "ATTEMPT_NOT_FOUND" });
      }

      const expiresAt =
        attempt.expiresAt ??
        new Date(attempt.presentedAt.getTime() + RECALL_PROTECTED_ATTEMPT_TTL_MS);
      const status =
        attempt.status === "PRESENTED" && expiresAt.getTime() <= now().getTime()
          ? "EXPIRED"
          : attempt.status;
      if (status !== "PRESENTED") {
        return res.json({
          attemptId: attempt.id,
          itemType: attempt.itemType,
          status,
          outcome: attempt.outcome,
        });
      }

      const lecture = await database.lecture.findUnique({
        where: { id: attempt.lectureId },
        select: {
          id: true,
          title: true,
          mcqs: {
            where: { id: attempt.itemId },
            select: {
              id: true,
              question: true,
              optionA: true,
              optionB: true,
              optionC: true,
              optionD: true,
            },
          },
          flashcards: {
            where: { id: attempt.itemId },
            select: {
              id: true,
              clinicalConcept: true,
              explanation: true,
            },
          },
        },
      });

      if (attempt.itemType === "MCQ") {
        const item = lecture?.mcqs.find((row) => row.id === attempt.itemId);
        if (!item || typeof item.question !== "string") {
          return res.status(404).json({ error: "Recall item is unavailable.", code: "ITEM_NOT_FOUND" });
        }
        const options = [
          { key: "A", text: item.optionA },
          { key: "B", text: item.optionB },
          { key: "C", text: item.optionC },
          { key: "D", text: item.optionD },
        ].filter((option): option is { key: "A" | "B" | "C" | "D"; text: string } =>
          typeof option.text === "string" && option.text.trim().length > 0
        );
        return res.json({
          attemptId: attempt.id,
          status,
          itemType: "MCQ",
          lectureId: attempt.lectureId,
          lectureTitle: lecture?.title ?? null,
          expiresAt,
          item: { id: item.id, question: item.question, options },
        });
      }

      if (attempt.itemType === "FLASHCARD") {
        const item = lecture?.flashcards.find((row) => row.id === attempt.itemId);
        if (!item || typeof item.clinicalConcept !== "string") {
          return res.status(404).json({ error: "Recall item is unavailable.", code: "ITEM_NOT_FOUND" });
        }
        return res.json({
          attemptId: attempt.id,
          status,
          itemType: "FLASHCARD",
          lectureId: attempt.lectureId,
          lectureTitle: lecture?.title ?? null,
          expiresAt,
          item: {
            id: item.id,
            front: item.clinicalConcept,
            back: item.explanation ?? "",
          },
        });
      }

      return res.status(404).json({ error: "Recall item is unavailable.", code: "ITEM_NOT_FOUND" });
    }),
  );

  router.post("/next", route(async (req, res) => {
    if (!isStudyFeatureEnabled("SPACED_RECALL_ENABLED")) {
      return res.status(404).json({ error: "Spaced Recall is not available.", code: "FEATURE_DISABLED" });
    }
    if (
      req.body !== undefined &&
      (!req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length > 0)
    ) {
      return res.status(400).json({
        error: "Recall next does not accept client-selected input.",
        code: "INVALID_REQUEST",
      });
    }
    const id = userId(req);
    const asOf = now();
    if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
      throw new Error("Recall server clock is invalid.");
    }
    const result = await database.$transaction(async (tx) => {
      await lockRecallScope(tx, "policy", [id]);
      const stale = await tx.recallAttempt.findMany({
        where: { userId: id, status: "PRESENTED", issuanceSource: "PERIODIC", issuancePolicyVersion: RECALL_POLICY_VERSION, expiresAt: { lte: asOf } },
        select: { id: true },
      });
      for (const row of stale) await service.expire(id, row.id, tx);
      const active = await findActivePeriodicAttempt(tx, id, asOf);
      if (active) {
        const expiresAt = active.expiresAt ?? new Date(active.presentedAt.getTime() + RECALL_PROTECTED_ATTEMPT_TTL_MS);
        return {
          kind: "attempt" as const,
          attempt: active,
          reused: true,
          interactionToken: mintRecallInteractionToken(id, active.id, expiresAt, asOf),
        };
      }
      const block = await findPeriodicEligibilityBlock(tx, id, asOf);
      if (block) return { kind: "status" as const, ...block };
      try {
        const attempt = await candidates.selectAndIssueProtectedRecallCandidate({
          userId: id,
          asOf,
          issuanceIdempotencyKey: `periodic:${id}:${asOf.toISOString()}`,
          expiresAt: new Date(asOf.getTime() + RECALL_PROTECTED_ATTEMPT_TTL_MS),
          tx: tx as never,
        });
        const expiresAt = attempt.expiresAt ?? new Date(attempt.presentedAt.getTime() + RECALL_PROTECTED_ATTEMPT_TTL_MS);
        return {
          kind: "attempt" as const,
          attempt,
          reused: false,
          interactionToken: mintRecallInteractionToken(id, attempt.id, expiresAt, asOf),
        };
      } catch (error) {
        if (isRecallError(error) && error.code === "NO_RECALL_CANDIDATE") {
          return { kind: "status" as const, status: "NO_CANDIDATE" as const };
        }
        throw error;
      }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
    if (result.kind === "status") {
      return res.json({
        status: result.status,
        ...("nextEligibleAt" in result
          ? { nextEligibleAt: result.nextEligibleAt }
          : {}),
      });
    }
    return res.json({
      status: result.reused ? "ACTIVE_ATTEMPT" : "AVAILABLE",
      attempt: {
        id: result.attempt.id,
        itemType: result.attempt.itemType,
        itemId: result.attempt.itemId,
        lectureId: result.attempt.lectureId,
        presentedAt: result.attempt.presentedAt,
        expiresAt: result.attempt.expiresAt ?? new Date(result.attempt.presentedAt.getTime() + RECALL_PROTECTED_ATTEMPT_TTL_MS),
      },
      interactionToken: result.interactionToken,
      policyVersion: RECALL_POLICY_VERSION,
    });
  }));

  router.post(
    "/attempts/:attemptId/answer",
    route(async (req, res) => {
      const parsedId = recallAttemptIdSchema.safeParse(req.params.attemptId);
      const parsedBody = recallAnswerBodySchema.safeParse(req.body);
      if (!parsedId.success || !parsedBody.success) {
        return res.status(400).json({
          error: "Recall answer is invalid.",
          code: "INVALID_REQUEST",
        });
      }

      const answer =
        "selectedOption" in parsedBody.data
          ? { kind: "MCQ_OPTION" as const, value: parsedBody.data.selectedOption }
          : { kind: "FLASHCARD_RECALL_RATING" as const, value: parsedBody.data.rating };
        const id = userId(req);
        const attempt = await database.recallAttempt.findFirst({
          where: { id: parsedId.data, userId: id },
          select: { issuanceSource: true, lectureId: true },
        });
       if (attempt?.issuanceSource === "PERIODIC") verifyRecallInteractionToken(req.header("X-Recall-Interaction-Token"), userId(req), parsedId.data, new Date());
        const result = await service.answer(id, parsedId.data, answer);
        if (result.status === "ANSWERED" && attempt?.lectureId) {
          try {
            await dependencies.refreshMastery?.(id, attempt.lectureId);
          } catch {
            // Projection failures must not change a committed Recall answer.
          }
        }
      return res.json(result);
    }),
  );

  router.post(
    "/attempts/:attemptId/skip",
    route(async (req, res) => {
      const parsedId = recallAttemptIdSchema.safeParse(req.params.attemptId);
      const parsedBody = recallSkipBodySchema.safeParse(req.body ?? {});
      if (!parsedId.success || !parsedBody.success) {
        return res.status(400).json({
          error: "Recall skip request is invalid.",
          code: "INVALID_REQUEST",
        });
      }
       const attempt = await database.recallAttempt.findFirst({ where: { id: parsedId.data, userId: userId(req) }, select: { issuanceSource: true } });
       if (attempt?.issuanceSource === "PERIODIC") verifyRecallInteractionToken(req.header("X-Recall-Interaction-Token"), userId(req), parsedId.data, new Date());
       const result = await service.skip(userId(req), parsedId.data);
      return res.json(result);
    }),
  );

  return router;
}

function userId(req: express.Request): string {
  return (req as AuthenticatedRequest).user.id;
}

function route(
  handler: (
    req: express.Request,
    res: express.Response,
  ) => Promise<unknown>,
): RequestHandler {
  return (req, res) => {
    void handler(req, res).catch((error: unknown) => {
      if (isRecallError(error)) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      res.status(500).json({
        error: "Recall request failed.",
        code: "INTERNAL_ERROR",
      });
    });
  };
}