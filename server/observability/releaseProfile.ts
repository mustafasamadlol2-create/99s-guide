import { readFile } from "node:fs/promises";
import {
  getStudyFeatureFlags,
  STUDY_FEATURE_FLAGS,
  type StudyFeatureFlagState,
} from "../features/study-core/featureFlags.js";

export interface StudyReleaseProfile {
  name: string;
  flags: StudyFeatureFlagState;
  source: "environment" | "file";
}

const flagSet = new Set<string>(STUDY_FEATURE_FLAGS);

export async function loadStudyReleaseProfile(
  profilePath?: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<StudyReleaseProfile> {
  if (!profilePath) {
    return {
      name: "current-environment",
      flags: getStudyFeatureFlags(environment),
      source: "environment",
    };
  }

  const parsed = JSON.parse(await readFile(profilePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Release profile must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["name", "features"].includes(key))
    || (record.name !== undefined
      && (typeof record.name !== "string" || record.name.length > 80))
    || typeof record.features !== "object"
    || record.features === null
    || Array.isArray(record.features)
  ) {
    throw new Error("Release profile has unsupported fields or an invalid features object.");
  }

  const features = record.features as Record<string, unknown>;
  if (Object.keys(features).some((key) => !flagSet.has(key))) {
    throw new Error("Release profile contains an unknown Study Engine feature flag.");
  }
  const flags = { ...getStudyFeatureFlags(environment) } as Record<string, boolean>;
  for (const [name, value] of Object.entries(features)) {
    if (typeof value !== "boolean") {
      throw new Error("Release profile feature values must be boolean.");
    }
    flags[name] = value;
  }

  return {
    name: typeof record.name === "string" ? record.name : "configured-profile",
    flags: flags as StudyFeatureFlagState,
    source: "file",
  };
}