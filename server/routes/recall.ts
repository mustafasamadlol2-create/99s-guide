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

export interface RecallRouteDependencies {
  requireUser: RequestHandler;
  service?: RecallAttemptService;
}

type AuthenticatedRequest = express.Request & { user: { id: string } };

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
  router.use(dependencies.requireUser);

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
      const result = await service.answer(userId(req), parsedId.data, answer);
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