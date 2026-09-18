import {
  DEFAULT_PERSONALIZATION_V1,
  PERSONALIZATION_GLASS_STYLES,
  PERSONALIZATION_HERO_STYLES,
  PERSONALIZATION_MOTION_STYLES,
  PERSONALIZATION_READING_SIZES,
  PERSONALIZATION_SUBJECT_IDS,
  PERSONALIZATION_THEME_IDS,
  type GlassStyle,
  type HeroStyle,
  type MotionStyle,
  type PersonalizationConfigV1,
  type ReadingSize,
  type SubjectId,
  type ThemeId,
  normalizePersonalizationConfig,
  validatePersonalizationConfig,
} from "../../../shared/personalization";

export interface PersonalizationState {
  committed: PersonalizationConfigV1;
  draft: PersonalizationConfigV1;
  isDirty: boolean;
}

export type PersonalizationDraftAction =
  | { type: "setThemeId"; value: unknown }
  | { type: "setHeroStyle"; value: unknown }
  | { type: "setGlassStyle"; value: unknown }
  | { type: "setMotionStyle"; value: unknown }
  | { type: "setReadingSize"; value: unknown }
  | { type: "setSubjectOrder"; value: unknown };

export type PersonalizationApplyResult =
  | {
      ok: true;
      state: PersonalizationState;
      config: PersonalizationConfigV1;
    }
  | {
      ok: false;
      state: PersonalizationState;
      error: "invalid-draft";
    };

function cloneConfig(config: PersonalizationConfigV1): PersonalizationConfigV1 {
  return {
    version: config.version,
    themeId: config.themeId,
    heroStyle: config.heroStyle,
    glassStyle: config.glassStyle,
    motionStyle: config.motionStyle,
    readingSize: config.readingSize,
    home: {
      subjectOrder: [...config.home.subjectOrder],
    },
  };
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isCompleteSubjectOrder(value: unknown): value is SubjectId[] {
  if (!Array.isArray(value) || value.length !== PERSONALIZATION_SUBJECT_IDS.length) {
    return false;
  }
  const seen = new Set<SubjectId>();
  return value.every((subjectId) => {
    if (!isOneOf(PERSONALIZATION_SUBJECT_IDS, subjectId) || seen.has(subjectId)) {
      return false;
    }
    seen.add(subjectId);
    return true;
  });
}

function statesDraft(state: PersonalizationState, draft: PersonalizationConfigV1): PersonalizationState {
  const nextDraft = cloneConfig(draft);
  return {
    committed: cloneConfig(state.committed),
    draft: nextDraft,
    isDirty: !personalizationConfigsEqual(state.committed, nextDraft),
  };
}

export function personalizationConfigsEqual(
  left: PersonalizationConfigV1,
  right: PersonalizationConfigV1,
): boolean {
  return (
    left.version === right.version &&
    left.themeId === right.themeId &&
    left.heroStyle === right.heroStyle &&
    left.glassStyle === right.glassStyle &&
    left.motionStyle === right.motionStyle &&
    left.readingSize === right.readingSize &&
    left.home.subjectOrder.length === right.home.subjectOrder.length &&
    left.home.subjectOrder.every(
      (subjectId, index) => subjectId === right.home.subjectOrder[index],
    )
  );
}

export function createPersonalizationState(
  config?: unknown,
): PersonalizationState {
  const normalized = normalizePersonalizationConfig(config ?? DEFAULT_PERSONALIZATION_V1);
  return {
    committed: cloneConfig(normalized),
    draft: cloneConfig(normalized),
    isDirty: false,
  };
}

export function reducePersonalizationState(
  state: PersonalizationState,
  action: PersonalizationDraftAction,
): PersonalizationState {
  const draft = cloneConfig(state.draft);

  switch (action.type) {
    case "setThemeId":
      if (!isOneOf(PERSONALIZATION_THEME_IDS, action.value)) return state;
      draft.themeId = action.value;
      return statesDraft(state, draft);
    case "setHeroStyle":
      if (!isOneOf(PERSONALIZATION_HERO_STYLES, action.value)) return state;
      draft.heroStyle = action.value;
      return statesDraft(state, draft);
    case "setGlassStyle":
      if (!isOneOf(PERSONALIZATION_GLASS_STYLES, action.value)) return state;
      draft.glassStyle = action.value;
      return statesDraft(state, draft);
    case "setMotionStyle":
      if (!isOneOf(PERSONALIZATION_MOTION_STYLES, action.value)) return state;
      draft.motionStyle = action.value;
      return statesDraft(state, draft);
    case "setReadingSize":
      if (!isOneOf(PERSONALIZATION_READING_SIZES, action.value)) return state;
      draft.readingSize = action.value;
      return statesDraft(state, draft);
    case "setSubjectOrder":
      if (!isCompleteSubjectOrder(action.value)) return state;
      draft.home.subjectOrder = [...action.value];
      return statesDraft(state, draft);
  }
}

export function cancelPersonalizationDraft(
  state: PersonalizationState,
): PersonalizationState {
  const committed = cloneConfig(state.committed);
  return {
    committed,
    draft: cloneConfig(committed),
    isDirty: false,
  };
}

export function resetPersonalizationDraft(
  state: PersonalizationState,
): PersonalizationState {
  return statesDraft(state, normalizePersonalizationConfig(DEFAULT_PERSONALIZATION_V1));
}

export function applyPersonalizationDraft(
  state: PersonalizationState,
): PersonalizationApplyResult {
  const validation = validatePersonalizationConfig(state.draft);
  if (!validation.success) {
    return { ok: false, state, error: "invalid-draft" };
  }

  const committed = cloneConfig(validation.data);
  return {
    ok: true,
    state: {
      committed,
      draft: cloneConfig(committed),
      isDirty: false,
    },
    config: cloneConfig(committed),
  };
}