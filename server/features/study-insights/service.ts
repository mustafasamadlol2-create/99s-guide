import {
  STUDY_INSIGHT_PROMPT_VERSION,
  STUDY_INSIGHT_VERSION,
  deterministicDataLimitations,
  studyInsightCacheEntrySchema,
  validateStudyInsightOutput,
  type StudyInsightLocale,
} from "../../../shared/studyInsights.js";
import { DEFAULT_CLOUDFLARE_MODEL } from "../../services/ai/config.js";
import { isStudyFeatureEnabled } from "../study-core/featureFlags.js";
import { readStudyAnalyzer } from "../study-analyzer/service.js";
import type { StudyAnalyzerDto } from "../study-analyzer/types.js";
import { buildDeterministicStudyInsightFallback } from "./deterministicFallback.js";
import { buildStudyInsightGrounding, hasStudyInsightData } from "./grounding.js";
import {
  buildStudyInsightCacheKey,
  fingerprintStudyInsightGrounding,
} from "./fingerprint.js";
import type { StudyInsightResponse, StudyInsightWorkerRequest } from "./types.js";
import {
  createStudyInsightWorkerCall,
  type StudyInsightWorkerCall,
} from "./workerClient.js";

const inFlight = new Map<string, Promise<StudyInsightResponse>>();

function configuredModel(environment: Readonly<Record<string, string | undefined>>): string {
  const model = environment.CLOUDFLARE_AI_STUDY_INSIGHT_MODEL?.trim();
  return model || DEFAULT_CLOUDFLARE_MODEL;
}

function cacheEnabled(environment: Readonly<Record<string, string | undefined>>): boolean {
  return environment.AI_STUDY_INSIGHTS_CACHE_ENABLED?.trim().toLowerCase() === "true" ||
    environment.AI_STUDY_INSIGHTS_CACHE_ENABLED?.trim() === "1";
}

async function joinSingleFlight(
  key: string,
  generate: () => Promise<StudyInsightResponse>,
): Promise<StudyInsightResponse> {
  const current = inFlight.get(key);
  if (current) return current;
  const promise = generate();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}

export function createStudyInsightService(options: {
  environment?: Readonly<Record<string, string | undefined>>;
  readAnalyzer?: (userId: string) => Promise<StudyAnalyzerDto>;
  callWorker?: StudyInsightWorkerCall;
} = {}): (input: {
  userId: string;
  locale: StudyInsightLocale;
}) => Promise<StudyInsightResponse> {
  const environment = options.environment ?? process.env;
  const readAnalyzer = options.readAnalyzer ?? readStudyAnalyzer;
  const callWorker = options.callWorker ?? createStudyInsightWorkerCall({ environment });

  return async ({ userId, locale }) => {
    const analyzer = await readAnalyzer(userId);
    const grounding = buildStudyInsightGrounding(analyzer);
    const groundingFingerprint = await fingerprintStudyInsightGrounding(grounding);

    if (!hasStudyInsightData(grounding)) {
      return buildDeterministicStudyInsightFallback(
        grounding,
        groundingFingerprint,
        locale,
        "INSUFFICIENT_DATA",
      );
    }

    const model = configuredModel(environment);
    const cacheKey = await buildStudyInsightCacheKey({
      userId,
      locale,
      model,
      groundingFingerprint,
    });
    const request: StudyInsightWorkerRequest = {
      requestVersion: STUDY_INSIGHT_VERSION,
      promptVersion: STUDY_INSIGHT_PROMPT_VERSION,
      locale,
      grounding,
    };

    return joinSingleFlight(cacheKey, async () => {
      try {
        const result = await callWorker({
          request,
          cacheKey,
          cacheEnabled: cacheEnabled(environment),
          expectedModel: model,
        });
        const parsedEntry = studyInsightCacheEntrySchema.safeParse(result.entry);
        if (!parsedEntry.success) {
          return buildDeterministicStudyInsightFallback(
            grounding,
            groundingFingerprint,
            locale,
            "AI_UNAVAILABLE",
          );
        }
        const entry = parsedEntry.data;
        if (entry.insightVersion !== STUDY_INSIGHT_VERSION ||
            entry.promptVersion !== STUDY_INSIGHT_PROMPT_VERSION ||
            entry.analyzerVersion !== grounding.analyzerVersion ||
            entry.groundingFingerprint !== groundingFingerprint ||
            entry.locale !== locale ||
            entry.model !== model) {
          return buildDeterministicStudyInsightFallback(
            grounding,
            groundingFingerprint,
            locale,
            "AI_UNAVAILABLE",
          );
        }
        const output = validateStudyInsightOutput(entry.output, grounding, locale);
        if (!output) {
          return buildDeterministicStudyInsightFallback(
            grounding,
            groundingFingerprint,
            locale,
            "AI_UNAVAILABLE",
          );
        }
        const safeOutput = {
          ...output,
          dataLimitations: deterministicDataLimitations(grounding, locale),
        };
        return {
          status: "READY",
          source: "AI",
          insightVersion: STUDY_INSIGHT_VERSION,
          promptVersion: STUDY_INSIGHT_PROMPT_VERSION,
          analyzerVersion: grounding.analyzerVersion,
          groundingFingerprint,
          cacheHit: result.cacheHit,
          insight: safeOutput,
          generatedAt: entry.generatedAt,
        };
      } catch {
        return buildDeterministicStudyInsightFallback(
          grounding,
          groundingFingerprint,
          locale,
          "AI_UNAVAILABLE",
        );
      }
    });
  };
}

export const getStudyInsight = createStudyInsightService();

export function clearStudyInsightSingleFlightForTests(): void {
  inFlight.clear();
}