import { useCallback, useEffect, useRef, useState } from "react";
import { cancelAIPreviewJob, requestAIPreview, AIPreviewError } from "../api/aiPreviewApi";
import type {
  AIMCQCandidate,
  AIFlashcardCandidate,
  AIPreviewRequest,
  AIPreviewResponse,
} from "../types/aiPreview";

export type AIPreviewStage = "idle" | "preparing" | "analyzing" | "structuring";

export function useAIPreview() {
  const controllerRef = useRef<AbortController | null>(null);
  const activeJobRef = useRef<{ target: AIPreviewRequest["target"]; jobId: string } | null>(null);
  const [stage, setStage] = useState<AIPreviewStage>("idle");
  const [error, setError] = useState<AIPreviewError | null>(null);

  const cancel = useCallback(() => {
    const activeJob = activeJobRef.current;
    if (activeJob) {
      void cancelAIPreviewJob(activeJob, activeJob.jobId).catch(() => {});
    }
    controllerRef.current?.abort();
    activeJobRef.current = null;
  }, []);

  const submit = useCallback(async (
    request: AIPreviewRequest,
  ): Promise<AIPreviewResponse<AIMCQCandidate | AIFlashcardCandidate> | null> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setStage("preparing");
    const stageTimer = window.setTimeout(() => setStage("analyzing"), 350);
    try {
      const result = await requestAIPreview(request, controller.signal, (status) => {
        if (!activeJobRef.current) {
          activeJobRef.current = { target: request.target, jobId: status.jobId };
        }
        if (status.state === "running") setStage("analyzing");
        if (status.progress.stage === "validating") setStage("structuring");
      }, (jobId) => {
        activeJobRef.current = { target: request.target, jobId };
      });
      setStage("structuring");
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      return result;
    } catch (caught) {
      const nextError = caught instanceof AIPreviewError
        ? caught
        : new AIPreviewError(caught instanceof Error ? caught.message : "AI preview failed.");
      if (nextError.code !== "ABORTED" && !controller.signal.aborted) setError(nextError);
      return null;
    } finally {
      window.clearTimeout(stageTimer);
      controllerRef.current = null;
      activeJobRef.current = null;
      setStage("idle");
    }
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return {
    stage,
    isBusy: stage !== "idle",
    error,
    submit,
    cancel,
    clearError: () => setError(null),
  };
}