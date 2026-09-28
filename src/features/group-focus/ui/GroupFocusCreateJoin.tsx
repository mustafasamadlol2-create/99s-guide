import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, BookOpen, DoorOpen, UsersRound } from "lucide-react";
import type { CreateGroupFocusRoomInput } from "../api/groupFocusApi";
import type { DatabaseLecture, Subject } from "../../../core/types";
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
  onJoin: (input: { roomLinkOrInvite: string; lectureId?: string }) => Promise<boolean>;
  onJoinEdit?: () => void;
  onRetryLectures?: () => void;
}

const inputClass = "min-h-12 w-full rounded-xl border border-[#d3dfd8] bg-[#fcfdfa] px-4 text-sm text-[#2c4640] outline-none transition placeholder:text-[#9aa9a3] motion-reduce:transition-none focus:border-[#6c9a8b] focus:ring-2 focus:ring-[#6c9a8b]/20";
const labelClass = "mb-2 block text-sm font-semibold text-[#476159]";

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
  const [sharedLectureId, setSharedLectureId] = useState("");
  const [hostLectureId, setHostLectureId] = useState("");
  const [joinLectureId, setJoinLectureId] = useState("");
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [roundCount, setRoundCount] = useState(4);
  const [maxParticipants, setMaxParticipants] = useState(6);
  const [joinValue, setJoinValue] = useState(initialJoinValue ?? "");
  const [joinNeedsLecture, setJoinNeedsLecture] = useState(false);
  const createTabRef = useRef<HTMLButtonElement>(null);
  const joinTabRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (initialJoinValue !== undefined) {
      setJoinValue(initialJoinValue);
      setJoinLectureId("");
      setJoinNeedsLecture(false);
    }
  }, [initialJoinValue]);
  const subjectNames = new Map<string, string>(
    subjects.map((subject) => [subject.id, language === "ar" ? subject.nameAr || subject.name : subject.name] as [string, string]),
  );
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const logicalDirection = language === "ar" ? -direction : direction;
      const currentIndex = view === "create" ? 0 : 1;
      nextIndex = (currentIndex + logicalDirection + 2) % 2;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextView = nextIndex === 0 ? "create" : "join";
    setView(nextView);
    if (nextIndex === 0) createTabRef.current?.focus();
    else joinTabRef.current?.focus();
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    onCreate({
      name: trimmedName,
      visibility,
      mode,
      ...(mode === "SHARED_LECTURE" && sharedLectureId ? { sharedLectureId } : {}),
      ...(mode === "STUDY_TOGETHER" && hostLectureId ? { hostLectureId } : {}),
      focusDurationSeconds: focusMinutes * 60,
      breakDurationSeconds: breakMinutes * 60,
      roundCount,
      maxParticipants,
    });
  };
  const submitJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = joinValue.trim();
    if (!value || submitting) return;
    const needsLecture = await onJoin({
      roomLinkOrInvite: value,
      ...(joinLectureId ? { lectureId: joinLectureId } : {}),
    });
    if (needsLecture) setJoinNeedsLecture(true);
  };
  const heading = view === "create" ? t("createRoom") : t("joinRoom");

  return (
    <GroupFocusShell language={language}>
      <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 sm:px-8 sm:pt-10">
        <button
          type="button"
          onClick={onBack}
          className="mb-7 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[#54736a] hover:bg-[#e7eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39796b]"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t("backToRooms")}
        </button>
        <GroupFocusPageHeader language={language} eyebrow={t("sharedFocus")} title={heading} description={t("subtitle")} />

        <div className="mt-6 flex rounded-xl border border-[#d9e3dc] bg-[#e9efea] p-1" role="tablist" aria-label={t("title")}>
          <button ref={createTabRef} type="button" role="tab" id="group-focus-create-tab" aria-controls="group-focus-create-panel" tabIndex={view === "create" ? 0 : -1} aria-selected={view === "create"} onClick={() => setView("create")} onKeyDown={handleTabKeyDown} className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39796b] ${view === "create" ? "bg-[#fbfcf9] text-[#2d5148] shadow-sm" : "text-[#6c7d76]"}`}>
            {t("createRoom")}
          </button>
          <button ref={joinTabRef} type="button" role="tab" id="group-focus-join-tab" aria-controls="group-focus-join-panel" tabIndex={view === "join" ? 0 : -1} aria-selected={view === "join"} onClick={() => setView("join")} onKeyDown={handleTabKeyDown} className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39796b] ${view === "join" ? "bg-[#fbfcf9] text-[#2d5148] shadow-sm" : "text-[#6c7d76]"}`}>
            {t("joinRoom")}
          </button>
        </div>

        <GroupFocusPanel
          className="mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39796b]"
          role="tabpanel"
          id={view === "create" ? "group-focus-create-panel" : "group-focus-join-panel"}
          aria-labelledby={view === "create" ? "group-focus-create-tab" : "group-focus-join-tab"}
          tabIndex={0}
        >
          {view === "create" ? (
            <form onSubmit={submitCreate} className="space-y-6">
              <label className="block">
                <span className={labelClass}>{t("roomName")}</span>
                <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder={t("roomNamePlaceholder")} dir="auto" />
              </label>

              <fieldset>
                <legend className={labelClass}>{t("visibility")}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={`flex min-h-[76px] cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors motion-reduce:transition-none ${visibility === "PUBLIC" ? "border-[#76a395] bg-[#f0f6f1]" : "border-[#dce5de] bg-[#fbfcf9]"}`}>
                    <input type="radio" name="visibility" value="PUBLIC" checked={visibility === "PUBLIC"} onChange={() => setVisibility("PUBLIC")} className="accent-[#285c52]" />
                    <UsersRound className="h-5 w-5 text-[#5f877b]" aria-hidden="true" />
                    <span className="text-sm font-semibold text-[#38544b]">{t("public")}</span>
                  </label>
                  <label className={`flex min-h-[76px] cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors motion-reduce:transition-none ${visibility === "PRIVATE" ? "border-[#76a395] bg-[#f0f6f1]" : "border-[#dce5de] bg-[#fbfcf9]"}`}>
                    <input type="radio" name="visibility" value="PRIVATE" checked={visibility === "PRIVATE"} onChange={() => setVisibility("PRIVATE")} className="accent-[#285c52]" />
                    <DoorOpen className="h-5 w-5 text-[#5f877b]" aria-hidden="true" />
                    <span className="text-sm font-semibold text-[#38544b]">{t("private")}</span>
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend className={labelClass}>{t("mode")}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["STUDY_TOGETHER", "SHARED_LECTURE"] as const).map((option) => (
                    <label key={option} className={`flex min-h-[76px] cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors motion-reduce:transition-none ${mode === option ? "border-[#76a395] bg-[#f0f6f1]" : "border-[#dce5de] bg-[#fbfcf9]"}`}>
                      <input type="radio" name="mode" value={option} checked={mode === option} onChange={() => setMode(option)} className="mt-1 accent-[#285c52]" />
                      <span>
                        <span className="block text-sm font-semibold text-[#38544b]">{option === "SHARED_LECTURE" ? t("sharedLecture") : t("studyTogether")}</span>
                        <span className="mt-1 block text-xs leading-5 text-[#7a8982]">{option === "SHARED_LECTURE" ? t("sharedLectureDescription") : t("studyTogetherDescription")}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {mode === "SHARED_LECTURE" && (
                <label className="block">
                  <span className={labelClass}>{t("lecture")}</span>
                  <select value={sharedLectureId} onChange={(event) => setSharedLectureId(event.target.value)} className={inputClass} required>
                    <option value="">{catalogStatus === "loading" ? t("loading") : t("chooseLecture")}</option>
                    {lectures.map((lecture) => (
                      <option key={lecture.id} value={lecture.id}>{lecture.name}{subjectNames.has(lecture.mainSubject) ? ` — ${subjectNames.get(lecture.mainSubject)}` : ""}</option>
                    ))}
                  </select>
                  {catalogStatus === "error" && (
                    <span className="mt-2 block text-xs text-[#9a5948]">
                      {t("lecturesLoadError")}
                      {onRetryLectures && <button type="button" className="ms-2 underline underline-offset-2" onClick={onRetryLectures}>{t("retry")}</button>}
                    </span>
                  )}
                </label>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: t("focusLength"), value: focusMinutes, set: setFocusMinutes, min: 1, max: 360, suffix: t("minutesShort") },
                  { label: t("breakLength"), value: breakMinutes, set: setBreakMinutes, min: 0, max: 180, suffix: t("minutesShort") },
                  { label: t("rounds"), value: roundCount, set: setRoundCount, min: 1, max: 20, suffix: "" },
                  { label: t("participants"), value: maxParticipants, set: setMaxParticipants, min: 2, max: 25, suffix: t("people") },
                ].map((field) => (
                  <label key={field.label} className="block">
                    <span className={`${labelClass} min-h-10 text-xs leading-5`}>{field.label}</span>
                    <div className="relative">
                      <input type="number" min={field.min} max={field.max} value={field.value} onChange={(event) => field.set(Number(event.target.value))} className={`${inputClass} tabular-nums ${language === "ar" ? "pl-12" : "pr-12"}`} />
                      {field.suffix && <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs text-[#819088] ${language === "ar" ? "left-3" : "right-3"}`}>{field.suffix}</span>}
                    </div>
                  </label>
                ))}
              </div>
              {mode === "STUDY_TOGETHER" && (
                <label className="block">
                  <span className={labelClass}>{t("yourStudyLecture")}</span>
                  <span className="relative block">
                    <BookOpen className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-[#779188] ${language === "ar" ? "right-4" : "left-4"}`} aria-hidden="true" />
                    <select required value={hostLectureId} onChange={(event) => setHostLectureId(event.target.value)} className={`${inputClass} ${language === "ar" ? "pr-11" : "pl-11"}`}>
                      <option value="">{t("chooseLecture")}</option>
                      {lectures.map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.name}</option>)}
                    </select>
                  </span>
                  {catalogStatus === "error" && (
                    <span className="mt-2 block text-xs text-[#9a5948]">
                      {t("lecturesLoadError")}
                      {onRetryLectures && <button type="button" className="ms-2 underline underline-offset-2" onClick={onRetryLectures}>{t("retry")}</button>}
                    </span>
                  )}
                </label>
              )}
              {error && <GroupFocusError message={error} />}
              <div className="flex flex-col-reverse gap-3 border-t border-[#e5ebe5] pt-5 sm:flex-row sm:justify-end">
                <GroupFocusButton variant="secondary" onClick={onBack}>{t("backToRooms")}</GroupFocusButton>
                <GroupFocusButton type="submit" disabled={submitting || !name.trim()}>{submitting ? t("creating") : t("create")}</GroupFocusButton>
              </div>
            </form>
          ) : (
            <form onSubmit={submitJoin} className="space-y-5">
              <div className="rounded-xl bg-[#f1f6f1] p-4">
                <div className="flex items-start gap-3">
                  <DoorOpen className="mt-0.5 h-5 w-5 shrink-0 text-[#5d887a]" aria-hidden="true" />
                  <p className="text-sm leading-6 text-[#59716a]">{t("joinHelp")}</p>
                </div>
              </div>
              <label className="block">
                <span className={labelClass}>{t("inviteCode")}</span>
                <input
                  className={inputClass}
                  value={joinValue}
                  onChange={(event) => {
                    setJoinValue(event.target.value);
                    setJoinLectureId("");
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
                <label className="block">
                  <span className={labelClass}>{t("yourStudyLecture")}</span>
                  <select
                    required
                    value={joinLectureId}
                    onChange={(event) => {
                      setJoinLectureId(event.target.value);
                      onJoinEdit?.();
                    }}
                    className={inputClass}
                  >
                    <option value="">{catalogStatus === "loading" ? t("loading") : t("chooseLecture")}</option>
                    {lectures.map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.name}</option>)}
                  </select>
                  {catalogStatus === "error" && (
                    <span className="mt-2 block text-xs text-[#9a5948]">
                      {t("lecturesLoadError")}
                      {onRetryLectures && <button type="button" className="ms-2 underline underline-offset-2" onClick={onRetryLectures}>{t("retry")}</button>}
                    </span>
                  )}
                </label>
              )}
              {error && <GroupFocusError message={error} />}
              <div className="flex flex-col-reverse gap-3 border-t border-[#e5ebe5] pt-5 sm:flex-row sm:justify-end">
                <GroupFocusButton variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t("backToRooms")}</GroupFocusButton>
                <GroupFocusButton type="submit" disabled={submitting || !joinValue.trim()}>{submitting ? t("joining") : t("join")}</GroupFocusButton>
              </div>
            </form>
          )}
        </GroupFocusPanel>
      </div>
    </GroupFocusShell>
  );
}