import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

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

const DISABLED_FLAGS: StudyFeatureFlagValues = {
  STUDY_POINTS_ENABLED: false,
  GAMIFICATION_ENABLED: false,
  FOCUS_RESOURCE_HANDOFF_ENABLED: false,
};

const StudyFeatureFlagsContext = createContext<StudyFeatureFlags>({
  ...DISABLED_FLAGS,
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
  const [flags, setFlags] = useState<StudyFeatureFlagValues>(DISABLED_FLAGS);
  const [status, setStatus] = useState<StudyFeatureFlags["status"]>("loading");

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/study/features", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Feature flags are unavailable.");
      const resolved = parseStudyFeatureFlags(await response.json());
      if (!resolved) throw new Error("Feature flags are invalid.");
      setFlags(resolved);
      setStatus("ready");
    } catch {
      setFlags(DISABLED_FLAGS);
      setStatus("unavailable");
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
