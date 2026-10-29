import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, DoorOpen, Minus, Plus, UsersRound } from "lucide-react";
import type { CreateGroupFocusRoomInput } from "../api/groupFocusApi";
import type { DatabaseLecture, Subject } from "../../../core/types";
import type { GroupFocusStudyPlanItem } from "../../../../shared/group-focus-study-plan/contract";
import {
  GROUP_FOCUS_MAX_FINITE_PARTICIPANTS,
  GROUP_FOCUS_MIN_FINITE_PARTICIPANTS,
  GROUP_FOCUS_UNLIMITED_PARTICIPANTS,
} from "../../../../shared/group-focus-capability/contract";
import { GroupFocusStudyPlanEditor } from "./GroupFocusStudyPlanEditor";
import {
  GroupFocusButton,
  GroupFocusError,
  GroupFocusPageHeader,
  GroupFocusPanel,
  GroupFocusShell,
  useGroupFocusCopy,
  type GroupFocusLanguage,
} from "./groupFocusUi";

type CreateValues = Omit<CreateGroupFocusRoomInput, "idempotencyKey">;
export interface GroupFocusCreateJoinProps {
  language: GroupFocusLanguage;
  lectures: DatabaseLecture[];
  subjects: Subject[];
  catalogStatus: "loading" | "ready" | "error";
  initialView?: "create" | "join";
  initialJoinValue?: string;
  submitting?: boolean;
  error?: string;
  onBack: () => void;
  onCreate: (input: CreateValues) => void;
  onJoin: (input: { roomLinkOrInvite: string; studyPlan?: GroupFocusStudyPlanItem[] }) => Promise<boolean>;
  onJoinEdit?: () => void;
  onRetryLectures?: () => void;
}

const inputClass = "min-h-12 w-full rounded-2xl border border-slate-200/90 bg-white/85 px-4 text-sm text-slate-900 outline-none shadow-sm transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-white";
const labelClass = "mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200";

function NativeStepper({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <div className="min-w-0">
      <span className={`${labelClass} min-h-10 text-xs leading-5`}>{label}</span>
      <div className="flex min-h-12 items-center rounded-2xl border border-slate-200/90 bg-white/85 p-1 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
        <button
          type="button"
          onClick={() => update(value - step)}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95 disabled:opacity-30 dark:bg-white/[0.07] dark:text-slate-200"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1 px-1 text-center">
          <span className="block text-base font-bold tabular-nums text-slate-900 dark:text-white" dir="ltr">{value}</span>
          {suffix && <span className="block truncate text-[10px] font-medium text-slate-400 dark:text-slate-500">{suffix}</span>}
        </div>
        <button
          type="button"
          onClick={() => update(value + step)}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-blue-600 transition active:scale-95 disabled:opacity-30 dark:bg-sky-300/10 dark:text-sky-200"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function RoomSizeControl({
  label,
  peopleLabel,
  unlimitedLabel,
  value,
  unlimited,
  onValueChange,
  onUnlimitedChange,
}: {
  label: string;
  peopleLabel: string;
  unlimitedLabel: string;
  value: number;
  unlimited: boolean;
  onValueChange: (value: number) => void;
  onUnlimitedChange: (value: boolean) => void;
}) {
  const clamp = (candidate: number) => Math.max(
    GROUP_FOCUS_MIN_FINITE_PARTICIPANTS,
    Math.min(GROUP_FOCUS_MAX_FINITE_PARTICIPANTS, Math.trunc(candidate)),
  );
  const update = (candidate: number) => onValueChange(clamp(candidate));
  return (
    <div className="min-w-0">
      <span className={`${labelClass} min-h-10 text-xs leading-5`}>{label}</span>
      <div className="rounded-2xl border border-slate-200/90 bg-white/85 p-1 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex min-h-12 items-center">
          <button
            type="button"
            onClick={() => update(value - 1)}
            disabled={unlimited || value <= GROUP_FOCUS_MIN_FINITE_PARTICIPANTS}
            aria-label={`Decrease ${label}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95 disabled:opacity-30 dark:bg-white/[0.07] dark:text-slate-200"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <label className="min-w-0 flex-1 px-1 text-center">
            <span className="sr-only">{label}</span>
            {unlimited ? (
              <span className="block text-sm font-bold text-slate-900 dark:text-white">{unlimitedLabel}</span>
            ) : (
              <input
                type="number"
                inputMode="numeric"
                min={GROUP_FOCUS_MIN_FINITE_PARTICIPANTS}
                max={GROUP_FOCUS_MAX_FINITE_PARTICIPANTS}
                value={value}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) update(next);
                }}
                className="mx-auto block w-full max-w-[92px] bg-transparent text-center text-base font-bold tabular-nums text-slate-900 outline-none dark:text-white"
                dir="ltr"
              />
            )}
            {!unlimited && (
              <span className="block truncate text-[10px] font-medium text-slate-400 dark:text-slate-500">{peopleLabel}</span>
            )}
          </label>
          <button
            type="button"
            onClick={() => update(value + 1)}
            disabled={unlimited || value >= GROUP_FOCUS_MAX_FINITE_PARTICIPANTS}
            aria-label={`Increase ${label}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-blue-600 transition active:scale-95 disabled:opacity-30 dark:bg-sky-300/10 dark:text-sky-200"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          aria-pressed={unlimited}
          onClick={() => onUnlimitedChange(!unlimited)}
          className={`mt-1 flex min-h-8 w-full items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition ${unlimited ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-sm" : "bg-slate-50 text-slate-500 hover:bg-sky-50 hover:text-sky-700 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-sky-300/10"}`}
        >
          <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
          {unlimitedLabel}
        </button>
      </div>
    </div>
  );
}

function planIsReady(plan: readonly GroupFocusStudyPlanItem[]) {
  return plan.length > 0 && plan.every((item) => item.resources.length > 0);
}

export function GroupFocusCreateJoin({
  language,
  lectures,
  subjects,
  catalogStatus,
  initialView = "create",
  initialJoinValue,
  submitting = false,
  error,
  onBack,
  onCreate,
  onJoin,
  onJoinEdit,
  onRetryLectures,
}: GroupFocusCreateJoinProps) {
  const { t } = useGroupFocusCopy(language);
  const [view, setView] = useState(initialView);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [mode, setMode] = useState<"SHARED_LECTURE" | "STUDY_TOGETHER">("STUDY_TOGETHER");
  const [sharedStudyPlan, setSharedStudyPlan] = useState<GroupFocusStudyPlanItem[]>([]);
  const [hostStudyPlan, setHostStudyPlan] = useState<GroupFocusStudyPlanItem[]>([]);
  const [joinStudyPlan, setJoinStudyPlan] = useState<GroupFocusStudyPlanItem[]>([]);
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [roundCount, setRoundCount] = useState(4);
  const [maxParticipants, setMaxParticipants] = useState(6);
  const [unlimitedParticipants, setUnlimitedParticipants] = useState(false);
  const [joinValue, setJoinValue] = useState(initialJoinValue ?? "");
  const [joinNeedsLecture, setJoinNeedsLecture] = useState(false);
  const createTabRef = useRef<HTMLButtonElement>(null);
  const joinTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (initialJoinValue !== undefined) {
      setJoinValue(initialJoinValue);
      setJoinStudyPlan([]);
      setJoinNeedsLecture(false);
    }
  }, [initialJoinValue]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const logicalDirection = language === "ar" ? -direction : direction;
      nextIndex = ((view === "create" ? 0 : 1) + logicalDirection + 2) % 2;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setView(nextIndex === 0 ? "create" : "join");
    (nextIndex === 0 ? createTabRef : joinTabRef).current?.focus();
  };

  const activeCreatePlan = mode === "SHARED_LECTURE" ? sharedStudyPlan : hostStudyPlan;
  const createReady = name.trim().length > 0 && planIsReady(activeCreatePlan);

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting || !planIsReady(activeCreatePlan)) return;
    const primaryLectureId = activeCreatePlan[0]?.lectureId;
    onCreate({
      name: trimmedName,
      visibility,
      mode,
      ...(mode === "SHARED_LECTURE" ? {
        sharedStudyPlan,
        ...(primaryLectureId ? { sharedLectureId: primaryLectureId } : {}),
      } : {
        hostStudyPlan,
        ...(primaryLectureId ? { hostLectureId: primaryLectureId } : {}),
      }),
      focusDurationSeconds: focusMinutes * 60,
      breakDurationSeconds: breakMinutes * 60,
      roundCount,
      maxParticipants: unlimitedParticipants
        ? GROUP_FOCUS_UNLIMITED_PARTICIPANTS
        : maxParticipants,
    });
  };

  const submitJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = joinValue.trim();
    if (!value || submitting || (joinNeedsLecture && !planIsReady(joinStudyPlan))) return;
    const needsLecture = await onJoin({
      roomLinkOrInvite: value,
      ...(joinStudyPlan.length ? { studyPlan: joinStudyPlan } : {}),
    });
    if (needsLecture) setJoinNeedsLecture(true);
  };

  const planTitle = mode === "SHARED_LECTURE"
    ? (language === "ar" ? "خطة الدراسة المشتركة" : "Shared study plan")
    : (language === "ar" ? "خطة دراستك" : "Your study plan");
  const planDescription = mode === "SHARED_LECTURE"
    ? (language === "ar" ? "كل المشاركين يدرسون نفس المحاضرات والمصادر بالترتيب نفسه." : "Everyone studies the same lectures and resources in the same order.")
    : (language === "ar" ? "أنت تختار محاضراتك ومصادرك، وبقية الغرفة تحافظ على نفس إيقاع التركيز." : "Choose your own lectures and resources while the room keeps a shared focus rhythm.");

  return (
    <GroupFocusShell language={language}>
      <div className="mx-auto w-full max-w-[1440px] px-3 pb-16 pt-3 sm:px-5 sm:pt-5">
        <button type="button" onClick={onBack} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 transition hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-white/10">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t("backToRooms")}
        </button>
        <GroupFocusPageHeader language={language} eyebrow={t("sharedFocus")} title={view === "create" ? t("createRoom") : t("joinRoom")} description={t("subtitle")} />

        <div className="mt-5 flex max-w-md rounded-2xl border border-sky-100/90 bg-white/65 p-1 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]" role="tablist" aria-label={t("title")}>
          {(["create", "join"] as const).map((tab) => (
            <button
              key={tab}
              ref={tab === "create" ? createTabRef : joinTabRef}
              type="button"
              role="tab"
              tabIndex={view === tab ? 0 : -1}
              aria-selected={view === tab}
              onClick={() => setView(tab)}
              onKeyDown={handleTabKeyDown}
              className={`min-h-10 flex-1 rounded-xl px-4 text-sm font-semibold transition ${view === tab ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md" : "text-slate-500 hover:bg-sky-50 dark:text-slate-300 dark:hover:bg-white/10"}`}
            >
              {tab === "create" ? t("createRoom") : t("joinRoom")}
            </button>
          ))}
        </div>

        <GroupFocusPanel className="mt-4">
          {view === "create" ? (
            <form onSubmit={submitCreate} className="space-y-6">
              <label className="block">
                <span className={labelClass}>{t("roomName")}</span>
                <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder={t("roomNamePlaceholder")} dir="auto" />
              </label>

              <fieldset>
                <legend className={labelClass}>{t("visibility")}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["PUBLIC", "PRIVATE"] as const).map((option) => (
                    <label key={option} className={`flex min-h-[78px] cursor-pointer items-center gap-3 rounded-2xl border p-4 transition active:scale-[0.99] ${visibility === option ? "border-sky-300 bg-sky-50/80 shadow-sm dark:border-sky-300/30 dark:bg-sky-300/10" : "border-slate-200/90 bg-white/75 dark:border-white/10 dark:bg-white/[0.035]"}`}>
                      <input type="radio" name="visibility" value={option} checked={visibility === option} onChange={() => setVisibility(option)} className="accent-blue-600" />
                      {option === "PUBLIC" ? <UsersRound className="h-5 w-5 text-blue-600 dark:text-sky-200" /> : <DoorOpen className="h-5 w-5 text-blue-600 dark:text-sky-200" />}
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{option === "PUBLIC" ? t("public") : t("private")}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className={labelClass}>{t("mode")}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["STUDY_TOGETHER", "SHARED_LECTURE"] as const).map((option) => (
                    <label key={option} className={`flex min-h-[92px] cursor-pointer items-start gap-3 rounded-2xl border p-4 transition active:scale-[0.99] ${mode === option ? "border-sky-300 bg-sky-50/80 shadow-sm dark:border-sky-300/30 dark:bg-sky-300/10" : "border-slate-200/90 bg-white/75 dark:border-white/10 dark:bg-white/[0.035]"}`}>
                      <input type="radio" name="mode" value={option} checked={mode === option} onChange={() => setMode(option)} className="mt-1 accent-blue-600" />
                      <span>
                        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{option === "SHARED_LECTURE" ? t("sharedLecture") : t("studyTogether")}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{option === "SHARED_LECTURE" ? t("sharedLectureDescription") : t("studyTogetherDescription")}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <GroupFocusStudyPlanEditor
                language={language}
                lectures={lectures}
                subjects={subjects}
                catalogStatus={catalogStatus}
                value={activeCreatePlan}
                onChange={mode === "SHARED_LECTURE" ? setSharedStudyPlan : setHostStudyPlan}
                onRefresh={onRetryLectures ? async () => onRetryLectures() : undefined}
                title={planTitle}
                description={planDescription}
              />

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <NativeStepper label={t("focusLength")} value={focusMinutes} min={1} max={360} suffix={t("minutesShort")} onChange={setFocusMinutes} />
                <NativeStepper label={t("breakLength")} value={breakMinutes} min={0} max={180} suffix={t("minutesShort")} onChange={setBreakMinutes} />
                <NativeStepper label={t("rounds")} value={roundCount} min={1} max={20} onChange={setRoundCount} />
                <RoomSizeControl
                  label={t("participants")}
                  peopleLabel={t("people")}
                  unlimitedLabel={t("unlimited")}
                  value={maxParticipants}
                  unlimited={unlimitedParticipants}
                  onValueChange={setMaxParticipants}
                  onUnlimitedChange={setUnlimitedParticipants}
                />
              </div>

              {catalogStatus === "error" && <GroupFocusError message={t("lecturesLoadError")} onRetry={onRetryLectures} retryLabel={t("retry")} />}
              {error && <GroupFocusError message={error} />}
              <div className="flex flex-col-reverse gap-3 border-t border-slate-200/70 pt-5 dark:border-white/10 sm:flex-row sm:justify-end">
                <GroupFocusButton variant="secondary" onClick={onBack}>{t("backToRooms")}</GroupFocusButton>
                <GroupFocusButton type="submit" disabled={submitting || !createReady}>{submitting ? t("creating") : t("create")}</GroupFocusButton>
              </div>
            </form>
          ) : (
            <form onSubmit={submitJoin} className="space-y-5">
              <div className="rounded-2xl border border-sky-100 bg-sky-50/65 p-4 dark:border-sky-300/15 dark:bg-sky-300/[0.06]">
                <div className="flex items-start gap-3">
                  <DoorOpen className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-sky-200" aria-hidden="true" />
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{t("joinHelp")}</p>
                </div>
              </div>
              <label className="block">
                <span className={labelClass}>{t("inviteCode")}</span>
                <input
                  className={inputClass}
                  value={joinValue}
                  onChange={(event) => {
                    setJoinValue(event.target.value);
                    setJoinStudyPlan([]);
                    setJoinNeedsLecture(false);
                    onJoinEdit?.();
                  }}
                  placeholder={t("invitePlaceholder")}
                  required
                  autoComplete="off"
                  dir="auto"
                />
              </label>
              {joinNeedsLecture && (
                <GroupFocusStudyPlanEditor
                  language={language}
                  lectures={lectures}
                  subjects={subjects}
                  catalogStatus={catalogStatus}
                  value={joinStudyPlan}
                  onChange={(next) => { setJoinStudyPlan(next); onJoinEdit?.(); }}
                  onRefresh={onRetryLectures ? async () => onRetryLectures() : undefined}
                  title={language === "ar" ? "خطة دراستك داخل الغرفة" : "Your study plan in this room"}
                  description={language === "ar" ? "أضف كل المحاضرات والمصادر التي تريد دراستها، وليس محاضرة واحدة فقط." : "Add every lecture and resource you want to study — not just one lecture."}
                />
              )}
              {error && <GroupFocusError message={error} />}
              <div className="flex flex-col-reverse gap-3 border-t border-slate-200/70 pt-5 dark:border-white/10 sm:flex-row sm:justify-end">
                <GroupFocusButton variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t("backToRooms")}</GroupFocusButton>
                <GroupFocusButton type="submit" disabled={submitting || !joinValue.trim() || (joinNeedsLecture && !planIsReady(joinStudyPlan))}>{submitting ? t("joining") : t("join")}</GroupFocusButton>
              </div>
            </form>
          )}
        </GroupFocusPanel>
      </div>
    </GroupFocusShell>
  );
}
