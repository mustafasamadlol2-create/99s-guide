import { createHash } from "node:crypto";
import type { PrismaClient, RecallAttempt } from "@prisma/client";
import { getPrisma } from "../../services/prismaClient.js";
import { RecallError } from "./errors.js";
import { createRecallAttemptService } from "./attemptService.js";
import { canonicalJson } from "../study-core/canonicalJson.js";
import { lockRecallScope } from "./repository.js";
import {
  RECALL_SAME_ITEM_COOLDOWN_MS,
  RECALL_POLICY_VERSION,
} from "./constants.js";
import {
  RECALL_CANDIDATE_LIMITS,
} from "./candidateWeights.js";
import {
  fetchEligibleRecallCandidateItems,
  loadRecallCandidateItemStates,
  loadRecallCandidateMemoryEvidence,
} from "./candidateRepository.js";
import type {
  RecallCandidate,
  RecallCandidateItemState,
  RecallCandidatePreviewInput,
  RecallCandidateSelectionInput,
  RecallCandidateService,
  RecallMemoryEvidence,
  SelectAndIssueRecallCandidateInput,
} from "./candidateTypes.js";
import { getRecallEligibleStudiedLectures } from "./studyEligibility.js";
import type { RecallAttemptService, RecallTransaction } from "./types.js";
import { compareRecallCandidates, scoreRecallCandidate } from "./candidateScoring.js";

export interface RecallCandidateServiceOptions {
  database?: PrismaClient;
  attemptService?: RecallAttemptService;
}

export function createRecallCandidateService(
  options: RecallCandidateServiceOptions = {},
): RecallCandidateService {
  const database = options.database ?? getPrisma();
  const attemptService =
    options.attemptService ?? createRecallAttemptService({ database });

  async function selectCandidates(
    input: RecallCandidateSelectionInput,
  ): Promise<RecallCandidate[]> {
    validateSelectionInput(input);
    const client = input.tx ?? database;
    const lectures = await getRecallEligibleStudiedLectures(input, database);
    if (lectures.length === 0) return [];

    const items = await fetchEligibleRecallCandidateItems(
      client,
      lectures.map(({ lectureId }) => lectureId),
    );
    if (items.length === 0) return [];

    const [states, history] = await Promise.all([
      loadRecallCandidateItemStates(client, input.userId, items),
      loadRecallCandidateMemoryEvidence(client, input.userId, items, input.asOf),
    ]);
    const stateByItem = new Map(
      states.map((state) => [itemKey(state.itemType, state.itemId), state]),
    );
    const evidenceByItem = new Map<string, RecallMemoryEvidence[]>();
    for (const evidence of history) {
      const key = itemKey(evidence.itemType, evidence.itemId);
      const existing = evidenceByItem.get(key);
      if (existing) existing.push(evidence);
      else evidenceByItem.set(key, [evidence]);
    }
    const lectureById = new Map(
      lectures.map((lecture) => [lecture.lectureId, lecture]),
    );

    return items
      .flatMap((item) => {
        const lecture = lectureById.get(item.lectureId);
        if (!lecture) return [];
        return [
          scoreRecallCandidate({
            item,
            lecture,
            state: stateByItem.get(itemKey(item.itemType, item.itemId)),
            history: evidenceByItem.get(itemKey(item.itemType, item.itemId)) ?? [],
            asOf: input.asOf,
          }),
        ];
      })
      .sort(compareRecallCandidates);
  }

  async function selectRecallCandidate(
    input: RecallCandidateSelectionInput,
  ): Promise<RecallCandidate> {
    const candidates = await selectCandidates(input);
    const candidate = candidates[0];
    if (!candidate) {
      throw new RecallError(
        "NO_RECALL_CANDIDATE",
        "No eligible Recall candidate is available.",
      );
    }
    return candidate;
  }

  async function previewRecallCandidates(
    input: RecallCandidatePreviewInput,
  ): Promise<RecallCandidate[]> {
    const limit = input.limit ?? RECALL_CANDIDATE_LIMITS.defaultPreviewLimit;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > RECALL_CANDIDATE_LIMITS.maxPreviewLimit
    ) {
      throw new RecallError(
        "INVALID_RECALL_INPUT",
        `Recall preview limit must be between 1 and ${RECALL_CANDIDATE_LIMITS.maxPreviewLimit}.`,
      );
    }
    return (await selectCandidates(input)).slice(0, limit);
  }

  async function selectAndIssueRecallCandidate(
    input: SelectAndIssueRecallCandidateInput,
  ): Promise<RecallAttempt> {
    validateSelectionInput(input);
    if (
      typeof input.issuanceIdempotencyKey !== "string" ||
      input.issuanceIdempotencyKey.trim().length < 8 ||
      input.issuanceIdempotencyKey.length > 200 ||
      (input.selectionContextId !== undefined &&
        (typeof input.selectionContextId !== "string" ||
          input.selectionContextId.trim().length < 1 ||
          input.selectionContextId.length > 200))
    ) {
      throw new RecallError(
        "INVALID_RECALL_INPUT",
        "Recall candidate issuance context is invalid.",
      );
    }

    const derivedKey = deriveCandidateIssuanceKey(input);
    const issueInTransaction = async (
      tx: RecallTransaction,
    ): Promise<RecallAttempt> => {
      await lockRecallScope(tx, "policy", [input.userId]);
      await lockRecallScope(tx, "issuance", [input.userId, derivedKey]);
      const existing = await tx.recallAttempt.findUnique({
        where: {
          userId_issuanceIdempotencyKey: {
            userId: input.userId,
            issuanceIdempotencyKey: derivedKey,
          },
        },
      });
      if (existing) return existing;

      const candidate = await selectRecallCandidate({ ...input, tx });
      return attemptService.issue({
        userId: input.userId,
        itemType: candidate.itemType,
        itemId: candidate.itemId,
        lectureId: candidate.lectureId,
        issuanceIdempotencyKey: derivedKey,
        presentedAt: input.asOf,
        expiresAt: input.expiresAt,
        tx,
      });
    };

    if (input.tx) return issueInTransaction(input.tx);
    return database.$transaction((tx) =>
      issueInTransaction(tx as RecallTransaction),
    );
  }

  async function selectAndIssueProtectedRecallCandidate(
    input: SelectAndIssueRecallCandidateInput,
  ): Promise<RecallAttempt> {
    validateSelectionInput(input);
    const issueInTransaction = async (tx: RecallTransaction) => {
      await lockRecallScope(tx, "policy", [input.userId]);
      const candidates = await selectCandidates({ ...input, tx });
      const cutoff = new Date(
        input.asOf.getTime() - RECALL_SAME_ITEM_COOLDOWN_MS,
      );
      const mcqIds = [...new Set(
        candidates
          .filter((candidate) => candidate.itemType === "MCQ")
          .map((candidate) => candidate.itemId),
      )];
      const flashcardIds = [...new Set(
        candidates
          .filter((candidate) => candidate.itemType === "FLASHCARD")
          .map((candidate) => candidate.itemId),
      )];
      const [mcqStates, flashcardStates] = await Promise.all([
        mcqIds.length > 0
          ? tx.recallItemState.findMany({
              where: {
                userId: input.userId,
                itemType: "MCQ",
                itemId: { in: mcqIds },
                lastPresentedAt: { gt: cutoff },
              },
              select: { itemType: true, itemId: true, lastPresentedAt: true },
            })
          : Promise.resolve([]),
        flashcardIds.length > 0
          ? tx.recallItemState.findMany({
              where: {
                userId: input.userId,
                itemType: "FLASHCARD",
                itemId: { in: flashcardIds },
                lastPresentedAt: { gt: cutoff },
              },
              select: { itemType: true, itemId: true, lastPresentedAt: true },
            })
          : Promise.resolve([]),
      ]);
      const lastPresentedAtByItem = new Map(
        [...mcqStates, ...flashcardStates]
          .filter((state) => state.lastPresentedAt instanceof Date)
          .map((state) => [
            itemKey(state.itemType, state.itemId),
            state.lastPresentedAt as Date,
          ]),
      );
      const eligible = filterRecallCandidatesByCooldown(
        candidates,
        lastPresentedAtByItem,
        input.asOf,
      );
      const candidate = eligible[0];
      if (!candidate) throw new RecallError("NO_RECALL_CANDIDATE", "No eligible Recall candidate is available.");
      return attemptService.issue({
        userId: input.userId,
        itemType: candidate.itemType,
        itemId: candidate.itemId,
        lectureId: candidate.lectureId,
        issuanceIdempotencyKey: input.issuanceIdempotencyKey,
        presentedAt: input.asOf,
        expiresAt: input.expiresAt,
        issuanceSource: "PERIODIC",
        issuancePolicyVersion: RECALL_POLICY_VERSION,
        tx,
      });
    };
    if (input.tx) return issueInTransaction(input.tx);
    return database.$transaction((tx) => issueInTransaction(tx as RecallTransaction));
  }

  return {
    selectRecallCandidate,
    previewRecallCandidates,
    selectAndIssueRecallCandidate,
    selectAndIssueProtectedRecallCandidate,
  };
}

export function filterRecallCandidatesByCooldown(
  candidates: readonly RecallCandidate[],
  lastPresentedAtByItem: ReadonlyMap<string, Date>,
  asOf: Date,
): RecallCandidate[] {
  const cutoff = asOf.getTime() - RECALL_SAME_ITEM_COOLDOWN_MS;
  return candidates.filter(
    (candidate) => {
      const lastPresentedAt = lastPresentedAtByItem.get(
        itemKey(candidate.itemType, candidate.itemId),
      );
      return !lastPresentedAt || lastPresentedAt.getTime() <= cutoff;
    },
  );
}

export function deriveCandidateIssuanceKey(
  input: Pick<
    SelectAndIssueRecallCandidateInput,
    "userId" | "issuanceIdempotencyKey" | "selectionContextId"
  >,
): string {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        contract: "recall-candidate-issuance-v1",
        userId: input.userId,
        issuanceIdempotencyKey: input.issuanceIdempotencyKey,
        selectionContextId: input.selectionContextId ?? null,
      }),
      "utf8",
    )
    .digest("hex");
  return `recall-candidate-v1:${digest}`;
}

function validateSelectionInput(
  input: RecallCandidateSelectionInput,
): void {
  if (
    typeof input.userId !== "string" ||
    input.userId.trim().length === 0 ||
    !(input.asOf instanceof Date) ||
    !Number.isFinite(input.asOf.getTime())
  ) {
    throw new RecallError(
      "INVALID_RECALL_INPUT",
      "Recall candidate selection input is invalid.",
    );
  }
}

function itemKey(itemType: string, itemId: string): string {
  return `${itemType}\u0000${itemId}`;
}