import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../../services/prismaClient.js";
import { IntegrityReviewService } from "./review.js";
import { IntegritySignalQueries } from "./queries.js";
import { StudyIntegrityPersistenceService } from "./service.js";
import type {
  BlockingIntegritySignalInput,
  BlockingIntegritySignalResult,
  IntegrityContextInput,
  IntegrityReviewInput,
  IntegrityReviewResult,
  IntegritySignalListFilters,
  IntegritySignalRecordInput,
} from "./types.js";

export * from "./types.js";
export { IntegrityReviewService } from "./review.js";
export { IntegritySignalQueries } from "./queries.js";
export { StudyIntegrityPersistenceService } from "./service.js";

/**
 * Persistence and review façade. The pure Study Integrity evaluator remains
 * independent of PostgreSQL; product services may call these methods after
 * evaluation without changing the original action's outcome.
 */
export class StudyIntegrityService {
  private readonly recorder: StudyIntegrityPersistenceService;
  private readonly reviewer: IntegrityReviewService;
  private readonly queries: IntegritySignalQueries;

  constructor(
    database: PrismaClient = getPrisma() as PrismaClient,
    now: () => Date = () => new Date(),
  ) {
    this.recorder = new StudyIntegrityPersistenceService(database, now);
    this.reviewer = new IntegrityReviewService(database, now);
    this.queries = new IntegritySignalQueries(database, now);
  }

  recordIntegrityDecision(input: IntegritySignalRecordInput) {
    return this.recorder.recordIntegrityDecision(input);
  }

  reviewSignal(input: IntegrityReviewInput): Promise<IntegrityReviewResult> {
    return this.reviewer.reviewSignal(input);
  }

  listSignals(filters: IntegritySignalListFilters) {
    return this.queries.listSignals(filters);
  }

  getSignalDetail(signalId: string) {
    return this.queries.getSignalDetail(signalId);
  }

  getUserIntegrityContext(input: IntegrityContextInput) {
    return this.queries.getUserIntegrityContext(input);
  }

  hasBlockingIntegritySignal(input: BlockingIntegritySignalInput) {
    return this.queries.hasBlockingIntegritySignal(input);
  }
}