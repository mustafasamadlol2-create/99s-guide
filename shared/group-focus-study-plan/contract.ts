export const GROUP_FOCUS_STUDY_RESOURCE_TYPES = [
  "PDF",
  "NOTE",
  "MCQ_SET",
  "FLASHCARD_SET",
  "VIDEO",
] as const;

export type GroupFocusStudyResourceType =
  (typeof GROUP_FOCUS_STUDY_RESOURCE_TYPES)[number];

export type GroupFocusStudyResourceSelection = {
  resourceType: GroupFocusStudyResourceType;
  resourceId: string;
  sequence: number;
};

export type GroupFocusStudyPlanItem = {
  lectureId: string;
  sequence: number;
  resources: GroupFocusStudyResourceSelection[];
};

export const GROUP_FOCUS_STUDY_PLAN_MAX_ITEMS = 100;
export const GROUP_FOCUS_STUDY_PLAN_MAX_RESOURCES_PER_ITEM = 500;
