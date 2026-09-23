export type ProjectionMetadata = {
  canonicalId: string;
  projectionVersion: number;
  revision: number | string;
  updatedAt: string;
  deletedAt?: string | null;
  userScope?: string | null;
  cohortScope?: string | null;
};