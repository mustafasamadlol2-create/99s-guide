export const MODULE_RESOURCE_MODULES = [
  "CA",
  "ID",
  "RM",
  "NT",
  "ImD",
  "PHC",
  "SSC",
] as const;

export type ModuleResourceModuleId = (typeof MODULE_RESOURCE_MODULES)[number];

export const MODULE_RESOURCE_LABELS: Record<
  ModuleResourceModuleId,
  { en: string; ar: string }
> = {
  CA: { en: "Clinical Attachment", ar: "التدريب السريري" },
  ID: { en: "Infectious Diseases", ar: "الأمراض الانتقالية" },
  RM: { en: "Research Methodology", ar: "منهجية البحث" },
  NT: { en: "Nutrition", ar: "التغذية" },
  ImD: { en: "Immune Disturbances", ar: "اضطرابات المناعة" },
  PHC: { en: "Public Health Care", ar: "الرعاية الصحية الأولية" },
  SSC: { en: "Student Selected Components", ar: "المكونات التي يختارها الطالب" },
};

export const MAX_MODULE_RESOURCE_PDF_BYTES = 5 * 1024 * 1024 * 1024;
export const MODULE_RESOURCE_MULTIPART_THRESHOLD_BYTES = 1;
export const MODULE_RESOURCE_MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_MODULE_RESOURCE_PART_UPLOAD_CONCURRENCY = 3;
export const MODULE_RESOURCE_UPLOAD_EXPIRY_SECONDS = 24 * 60 * 60;
export const MODULE_RESOURCE_TITLE_MAX_LENGTH = 200;

export function isModuleResourceModuleId(
  value: unknown,
): value is ModuleResourceModuleId {
  return (
    typeof value === "string" &&
    (MODULE_RESOURCE_MODULES as readonly string[]).includes(value)
  );
}

export function moduleResourceStoragePath(
  moduleId: ModuleResourceModuleId,
  resourceId: string,
): string {
  return `module-resources/${moduleId}/${resourceId}.pdf`;
}
