export const PRIVACY_CLASSES = [
  "PUBLIC",
  "PROFILE_PUBLIC",
  "PRIVATE_STUDY",
  "ADMIN_SECURITY",
  "SYSTEM_INTERNAL",
] as const;

export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

export function isPublicStudyRecord(privacyClass: PrivacyClass): boolean {
  return privacyClass === "PUBLIC" || privacyClass === "PROFILE_PUBLIC";
}

export function isSensitiveStudyRecord(privacyClass: PrivacyClass): boolean {
  return (
    privacyClass === "PRIVATE_STUDY" ||
    privacyClass === "ADMIN_SECURITY" ||
    privacyClass === "SYSTEM_INTERNAL"
  );
}