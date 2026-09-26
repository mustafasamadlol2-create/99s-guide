import { z } from "zod";
import {
  RECALL_FLASHCARD_RATINGS,
  RECALL_MCQ_OPTIONS,
} from "./constants.js";

export const recallAttemptIdSchema = z.string().trim().min(1).max(200);

export const mcqRecallAnswerBodySchema = z
  .object({
    selectedOption: z.enum(RECALL_MCQ_OPTIONS),
  })
  .strict();

export const flashcardRecallAnswerBodySchema = z
  .object({
    rating: z.enum(RECALL_FLASHCARD_RATINGS),
  })
  .strict();

export const recallAnswerBodySchema = z.union([
  mcqRecallAnswerBodySchema,
  flashcardRecallAnswerBodySchema,
]);

export const recallSkipBodySchema = z.object({}).strict();