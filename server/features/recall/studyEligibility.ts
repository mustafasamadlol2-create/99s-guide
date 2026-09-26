import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import type { RecallTransaction } from "./types.js";
import type { RecallStudiedLectureEvidence } from "./candidateTypes.js";
import { loadRecallLectureStudyFacts } from "./candidateRepository.js";
import { mergeRecallLectureStudyFacts } from "./sourceEvidence.js";

export interface GetRecallEligibleStudiedLecturesInput {
  userId: string;
  asOf: Date;
  tx?: RecallTransaction;
}

export async function getRecallEligibleStudiedLectures(
  input: GetRecallEligibleStudiedLecturesInput,
  database: PrismaClient = getPrisma(),
): Promise<RecallStudiedLectureEvidence[]> {
  if (
    !input.userId.trim() ||
    !(input.asOf instanceof Date) ||
    !Number.isFinite(input.asOf.getTime())
  ) {
    throw new Error("Recall study eligibility input is invalid.");
  }

  const client = input.tx ?? database;
  const facts = await loadRecallLectureStudyFacts(client, input.userId, input.asOf);
  return mergeRecallLectureStudyFacts(facts);
}