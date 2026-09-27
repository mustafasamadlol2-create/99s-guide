import type {
  AskStudyDataAnswerV1,
  AskStudyDataFactSetV1,
  AskStudyDataIntent,
  AskStudyDataLocale,
  AskStudyDataSupportedIntent,
  AskStudyDataWindow,
} from "../../../shared/askStudyData.js";

export type AskMyStudyDataResponse =
  | {
      status: "ANSWERED";
      source: "DETERMINISTIC" | "AI" | "DETERMINISTIC_FALLBACK";
      intent: AskStudyDataSupportedIntent;
      locale: AskStudyDataLocale;
      answer: string;
      evidence: AskStudyDataAnswerV1["evidence"];
      limitations: string[];
      asOf: string;
      routerVersion: "ask-study-data-router-v1";
      window: AskStudyDataWindow;
    }
  | {
      status: "NEEDS_CLARIFICATION";
      reason: string;
      candidates?: string[];
      locale: AskStudyDataLocale;
      routerVersion: "ask-study-data-router-v1";
    }
  | {
      status: "UNSUPPORTED";
      reason: string;
      supportedExamples: string[];
      locale: AskStudyDataLocale;
      routerVersion: "ask-study-data-router-v1";
    };

export type AskStudyDataWorkerRequest = {
  version: "ask-study-data-v1";
  promptVersion: "ask-study-data-prompt-v1";
  locale: AskStudyDataLocale;
  intent: AskStudyDataSupportedIntent;
  question: string;
  facts: AskStudyDataFactSetV1;
};

export type AskStudyDataServiceInput = {
  userId: string;
  question: string;
  locale: AskStudyDataLocale;
};

export type AskStudyDataIntentForResponse = AskStudyDataIntent;