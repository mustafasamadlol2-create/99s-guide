import React, { createContext, useContext, useEffect, useState } from "react";

export interface StudyFeatureFlags {
  STUDY_POINTS_ENABLED: boolean;
  GAMIFICATION_ENABLED: boolean;
  FOCUS_RESOURCE_HANDOFF_ENABLED: boolean;
}

const DISABLED_FLAGS: StudyFeatureFlags = {
  STUDY_POINTS_ENABLED: false,
  GAMIFICATION_ENABLED: false,
  FOCUS_RESOURCE_HANDOFF_ENABLED: false,
};

const StudyFeatureFlagsContext = createContext<StudyFeatureFlags>(DISABLED_FLAGS);

function parseStudyFeatureFlags(value: unknown): StudyFeatureFlags | null {
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
  const [flags, setFlags] = useState(DISABLED_FLAGS);

  useEffect(() => {
    let active = true;
    void fetch("/api/study/features", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Feature flags are unavailable.");
        return parseStudyFeatureFlags(await response.json());
      })
      .then((resolved) => {
        if (active && resolved) setFlags(resolved);
      })
      .catch(() => {
        if (active) setFlags(DISABLED_FLAGS);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <StudyFeatureFlagsContext.Provider value={flags}>
      {children}
    </StudyFeatureFlagsContext.Provider>
  );
}

export function useStudyFeatureFlags(): StudyFeatureFlags {
  return useContext(StudyFeatureFlagsContext);
}
