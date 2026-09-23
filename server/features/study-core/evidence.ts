export const EVIDENCE_CLASSES = [
  "UNVERIFIED_CLIENT",
  "CLIENT_OBSERVED",
  "SERVER_VALIDATED",
  "SERVER_DERIVED",
  "REALTIME_VERIFIED",
  "ADMIN_VERIFIED",
] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/**
 * This rank expresses relative trust for later integrity rules only. It does
 * not award Points or make a record authoritative by itself.
 */
export const EVIDENCE_CLASS_RANK: Readonly<Record<EvidenceClass, number>> = {
  UNVERIFIED_CLIENT: 0,
  CLIENT_OBSERVED: 1,
  SERVER_VALIDATED: 2,
  SERVER_DERIVED: 3,
  REALTIME_VERIFIED: 3,
  ADMIN_VERIFIED: 4,
};

export function getEvidenceRank(evidenceClass: EvidenceClass): number {
  return EVIDENCE_CLASS_RANK[evidenceClass];
}