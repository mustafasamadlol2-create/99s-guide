export const INTEGRITY_ENFORCEMENT_RESULTS = [
  "ALLOW",
  "ALLOW_NO_REWARD",
  "SOFT_FLAG",
  "HARD_REJECT",
  "REVIEW_REQUIRED",
] as const;
export type IntegrityEnforcementResult =
  (typeof INTEGRITY_ENFORCEMENT_RESULTS)[number];

export const INTEGRITY_FLAG_SEVERITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export type IntegrityFlagSeverity = (typeof INTEGRITY_FLAG_SEVERITIES)[number];