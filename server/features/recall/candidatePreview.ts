import { createRecallCandidateService } from "./candidateService.js";
import type {
  RecallCandidate,
  RecallCandidatePreviewInput,
} from "./candidateTypes.js";

/**
 * Internal diagnostics only. This helper is not mounted on an HTTP route and
 * returns identifiers and bounded scores, never source content.
 */
export function previewRecallCandidates(
  input: RecallCandidatePreviewInput,
): Promise<RecallCandidate[]> {
  return createRecallCandidateService().previewRecallCandidates(input);
}