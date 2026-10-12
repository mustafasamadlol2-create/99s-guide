import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiClient } from "../../core/api/apiClient";

export interface StudyFeatureFlags {
  STUDY_POINTS_ENABLED: boolean;
  GAMIFICATION_ENABLED: boolean;
  FOCUS_RESOURCE_HANDOFF_ENABLED: boolean;
  status: "loading" | "ready" | "unavailable";
  reload: () => Promise<void>;
}

type StudyFeatureFlagValues = Pick<
  StudyFeatureFlags,
  "STUDY_POINTS_ENABLED" | "GAMIFICATION_ENABLED" | "FOCUS_RESOURCE_HANDOFF_ENABLED"
>;

const RELEASE_DEFAULT_FLAGS: StudyFeatureFlagValues = {
  STUDY_POINTS_ENABLED: true,
  GAMIFICATION_ENABLED: true,
  FOCUS_RESOURCE_HANDOFF_ENABLED: true,
};

const StudyFeatureFlagsContext = createContext<StudyFeatureFlags>({
  ...RELEASE_DEFAULT_FLAGS,
  status: "loading",
  reload: async () => {},
});

function parseStudyFeatureFlags(value: unknown): StudyFeatureFlagValues | null {
  if (!value || typeof value !== "object") return null;
  const flags = value as Record<string, unknown>;
  if (
    typeof flags.STUDY_POINTS_ENABLED !== "boolean"
    || typeof flags.GAMIFICATION_ENABLED !== "boolean"
    || typeof flags.FOCUS_RESOURCE_HANDOFF_ENABLED !== "boolean"
  ) {
    return null;
  }
  return {
    STUDY_POINTS_ENABLED: flags.STUDY_POINTS_ENABLED,
    GAMIFICATION_ENABLED: flags.GAMIFICATION_ENABLED,
    FOCUS_RESOURCE_HANDOFF_ENABLED: flags.FOCUS_RESOURCE_HANDOFF_ENABLED,
  };
}

export function StudyFeatureFlagsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [flags, setFlags] = useState<StudyFeatureFlagValues>(RELEASE_DEFAULT_FLAGS);
  const [status, setStatus] = useState<StudyFeatureFlags["status"]>("loading");

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await apiClient("/api/study/features", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        bypassCache: true,
        retries: 2,
        retryDelayMs: 750,
        timeoutMs: 12_000,
        silent: true,
      });
      if (!response.ok) throw new Error("Feature flags are unavailable.");
      const resolved = parseStudyFeatureFlags(await response.json());
      if (!resolved) throw new Error("Feature flags are invalid.");
      setFlags(resolved);
      setStatus("ready");
    } catch (error) {
      // The feature availability endpoint is a presentation hint, not an
      // authorization boundary. Keep released Study Engagement surfaces usable
      // during a transient Render cold start/network failure; protected APIs
      // remain authoritative and enforce their own server-side gates.
      console.warn("[StudyFeatureFlags] Availability check failed; using release defaults.", error);
      setFlags(RELEASE_DEFAULT_FLAGS);
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <StudyFeatureFlagsContext.Provider value={{ ...flags, status, reload }}>
      {children}
    </StudyFeatureFlagsContext.Provider>
  );
}

export function useStudyFeatureFlags(): StudyFeatureFlags {
  return useContext(StudyFeatureFlagsContext);
}
