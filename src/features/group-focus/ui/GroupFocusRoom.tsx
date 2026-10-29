import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, BookOpen, Clock3, Copy, FileText, Layers3, LoaderCircle, LockKeyhole, Pause, Play, RefreshCw, Share2, UserMinus, UsersRound, Video } from "lucide-react";
import type { GroupFocusMembershipDto, GroupFocusRoomDto } from "../api/groupFocusApi";
import type { GroupFocusRealtimeSnapshot } from "../runtime/groupFocusRealtime";
import type { DatabaseLecture, Subject } from "../../../core/types";
import type { GroupFocusStudyResourceSelection } from "../../../../shared/group-focus-study-plan/contract";
import { FOCUS_AUDIO_ENABLED } from "../../../config/featureFlags";
import { FocusLecturePicker } from "../../focus/components/FocusLecturePicker";
import { FocusAudioPlanningCard } from "../../focus/components/FocusAudioPlanningCard";
import type { FocusPlanDraftItem } from "../../focus/focusHubModel";
import {
  GroupFocusButton,
  GroupFocusError,
  GroupFocusPageHeader,
  GroupFocusPanel,
  GroupFocusShell,
  GroupFocusSkeleton,
  useGroupFocusCopy,
  type GroupFocusLanguage,
} from "./groupFocusUi";

export interface GroupFocusRoomProps {
  language: GroupFocusLanguage;
  room: GroupFocusRoomDto | null;
  membership: GroupFocusMembershipDto | null;
  roomStatus: "loading" | "ready" | "error";
  stage: "lobby" | "session" | "terminal";
  snapshot: GroupFocusRealtimeSnapshot;
  remainingMilliseconds: number | null;
  actionPending?: "start" | "pause" | "resume" | "leave" | "close" | null;
  lectureName?: string | null;
  lectures: DatabaseLecture[];
  subjects: Subject[];
  selectedLectureId: string | null;
  lectureCatalogStatus: "loading" | "ready" | "error";
  lectureChangePending?: boolean;
  onChooseLecture: (lectureId: string) => void;
  onRefreshLectures: () => Promise<void>;
  inviteManagementAllowed: boolean;
  memberManagementAllowed: boolean;
  memberRemovalPendingUserId?: string | null;
  onRemoveMember: (userId: string) => void;
  safeInviteLinkOrCode: string | null;
  inviteActionPending?: "rotate" | "copy" | "share" | null;
  inviteFeedback?: { kind: "success" | "error"; message: string } | null;
  onRotateInvite: () => void;
  onCopyInvite: (invite: string) => void;
  onShareInvite: (invite: string) => void;
  onBack: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onLeave: () => void;
  onCloseRoom: () => void;
  onReconnect: () => void;
  onRequestRoomState: () => void;
  roomStateRequestPending?: boolean;
  onRetryRoom: () => void;
  onOpenSummary: () => void;
  roomError?: string;
}

function formatTimer(milliseconds: number) {
  const seconds = Math.max(0, Math.floor((milliseconds ?? 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function RoomCountdownTimer({
  remainingMilliseconds,
  unavailableLabel,
  accessibleLabel,
}: {
  remainingMilliseconds: number | null;
  unavailableLabel: string;
  accessibleLabel: string;
}) {
  const [sample, setSample] = useState(() => ({
    value: remainingMilliseconds,
    sampledAt: Date.now(),
  }));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sampledAt = Date.now();
    setSample({ value: remainingMilliseconds, sampledAt });
    setNow(sampledAt);
  }, [remainingMilliseconds]);

  useEffect(() => {
    if (remainingMilliseconds === null) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [remainingMilliseconds]);

  const currentSample = sample.value === remainingMilliseconds
    ? sample
    : { value: remainingMilliseconds, sampledAt: Date.now() };
  if (currentSample.value === null) {
    return <p className="mt-8 text-lg font-medium text-[#64748b]">{unavailableLabel}</p>;
  }

  const elapsedMilliseconds = Math.max(0, now - currentSample.sampledAt);
  const displayedMilliseconds = Math.max(0, currentSample.value - elapsedMilliseconds);
  return (
    <div
      className="mt-5 font-mono text-[clamp(4rem,13vw,8.5rem)] font-medium leading-none tracking-[-0.075em] text-[#0f2744] tabular-nums"
      dir="ltr"
      role="timer"
      aria-label={accessibleLabel}
    >
      {formatTimer(displayedMilliseconds)}
    </div>
  );
}

function phaseTitle(phase: string | undefined, t: ReturnType<typeof useGroupFocusCopy>["t"]) {
  switch (phase) {
    case "COUNTDOWN": return t("countdown");
    case "FOCUS": return t("focus");
    case "BREAK": return t("break");
    case "PAUSED": return t("paused");
    case "COMPLETED": return t("completed");
    case "LOBBY": return t("waiting");
    case "CLOSED": return t("terminal");
    default: return t("unknownState");
  }
}

function connectionTitle(status: GroupFocusRealtimeSnapshot["status"], t: ReturnType<typeof useGroupFocusCopy>["t"]) {
  if (status === "CONNECTED") return t("connected");
  if (status === "CONNECTING" || status === "IDLE") return t("connecting");
  if (status === "RECONNECTING") return t("reconnecting");
  if (status === "TERMINAL") return t("terminal");
  return t("disconnected");
}

function studyResourceLabel(
  lecture: DatabaseLecture | undefined,
  resource: GroupFocusStudyResourceSelection,
  language: GroupFocusLanguage,
): string {
  if (resource.resourceType === "MCQ_SET") return language === "ar" ? "أسئلة MCQ" : "MCQs";
  if (resource.resourceType === "FLASHCARD_SET") return language === "ar" ? "البطاقات" : "Flashcards";
  const material = lecture?.materials?.find((candidate) => candidate.id === resource.resourceId);
  if (material?.title) return material.title;
  if (resource.resourceType === "VIDEO") return language === "ar" ? "فيديو" : "Video";
  if (resource.resourceType === "NOTE") return language === "ar" ? "الملاحظات" : "Notes";
  return language === "ar" ? "ملف PDF" : "PDF";
}

function StudyResourceIcon({ type }: { type: GroupFocusStudyResourceSelection["resourceType"] }) {
  if (type === "VIDEO") return <Video className="h-3.5 w-3.5" aria-hidden="true" />;
  if (type === "MCQ_SET" || type === "FLASHCARD_SET") {
    return <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  return <FileText className="h-3.5 w-3.5" aria-hidden="true" />;
}

export function GroupFocusRoom({
  language,
  room,
  membership,
  roomStatus,
  stage,
  snapshot,
  remainingMilliseconds,
  actionPending = null,
  lectureName,
  lectures,
  subjects,
  selectedLectureId,
  lectureCatalogStatus,
  lectureChangePending = false,
  onChooseLecture,
  onRefreshLectures,
  inviteManagementAllowed,
  memberManagementAllowed,
  memberRemovalPendingUserId = null,
  onRemoveMember,
  safeInviteLinkOrCode,
  inviteActionPending = null,
  inviteFeedback,
  onRotateInvite,
  onCopyInvite,
  onShareInvite,
  onBack,
  onStart,
  onPause,
  onResume,
  onLeave,
  onCloseRoom,
  onReconnect,
  onRequestRoomState,
  roomStateRequestPending = false,
  onRetryRoom,
  onOpenSummary,
  roomError,
}: GroupFocusRoomProps) {
  const { t } = useGroupFocusCopy(language);
  const [confirmClose, setConfirmClose] = useState(false);
  const [lecturePickerOpen, setLecturePickerOpen] = useState(false);
  const closeLecturePicker = useCallback(() => setLecturePickerOpen(false), []);
  if (roomStatus === "loading") {
    return <GroupFocusShell language={language}><div className="mx-auto max-w-5xl px-4 py-10 sm:px-8"><GroupFocusSkeleton rows={3} label={t("loading")} /></div></GroupFocusShell>;
  }
  if (roomStatus === "error" || !room) {
    return (
      <GroupFocusShell language={language}>
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
          <GroupFocusButton variant="quiet" onClick={onBack}><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t("backToRooms")}</GroupFocusButton>
          <GroupFocusError message={roomError || t("roomLoadError")} onRetry={onRetryRoom} retryLabel={t("retry")} />
        </div>
      </GroupFocusShell>
    );
  }

  const host = membership?.role === "HOST" && membership.status === "ACTIVE";
  const authoritativePhase = snapshot.roomState?.phase;
  const phase = authoritativePhase;
  const phaseLabel = phaseTitle(phase, t);
  const connectionReady = snapshot.status === "CONNECTED";
  const phaseStage = authoritativePhase === "LOBBY"
    ? "lobby"
    : authoritativePhase === "COUNTDOWN" || authoritativePhase === "FOCUS" || authoritativePhase === "BREAK" || authoritativePhase === "PAUSED"
      ? "session"
      : authoritativePhase === "COMPLETED" || authoritativePhase === "CLOSED"
        ? "terminal"
        : null;
  const visibleStage = phaseStage ?? stage;
  const active = phaseStage === "session";
  const terminal = visibleStage === "terminal";
  const roomState = snapshot.roomState;
  const currentRound = roomState?.currentRound;
  const roundCount = roomState?.roundCount ?? room.roundCount;
  const progressCaption = currentRound !== undefined && currentRound > 0
    ? `${t("round")} ${currentRound} ${t("of")} ${roundCount}`
    : `${roundCount} ${t("rounds")}`;
  const roomMode = room.mode === "SHARED_LECTURE" ? t("sharedLectureMode") : t("studyTogether");
  const roomCapacityLabel = room.maxParticipants === 0
    ? t("unlimited")
    : String(room.maxParticipants);
  const activeMembersLabel = room.maxParticipants === 0
    ? String(room.participantCount)
    : `${room.participantCount} / ${room.maxParticipants}`;
  const shouldShowActions = !terminal && room.status === "OPEN";
  const confirmedLobby = authoritativePhase === "LOBBY";
  const canChooseLecture = room.mode === "STUDY_TOGETHER"
    && membership?.status === "ACTIVE"
    && !terminal;
  const selectedLecture = lectures.find((lecture) => lecture.id === selectedLectureId);
  const visibleStudyPlan = room.mode === "SHARED_LECTURE"
    ? room.sharedStudyPlan
    : membership?.studyPlan ?? [];
  const studyPlanLectureIds = new Set(visibleStudyPlan.map((item) => item.lectureId));
  const selectableLectures = lectures.filter((lecture) => studyPlanLectureIds.has(lecture.id));
  const queuedStudyPlanItems: FocusPlanDraftItem[] = visibleStudyPlan.map((item) => ({
    lectureId: item.lectureId,
    sessionCount: 1,
    includeMcq: item.resources.some((resource) => resource.resourceType === "MCQ_SET"),
    includeFlashcards: item.resources.some((resource) => resource.resourceType === "FLASHCARD_SET"),
    includeVideo: item.resources.some((resource) => resource.resourceType === "VIDEO"),
    resources: item.resources,
  }));

  return (
    <GroupFocusShell language={language}>
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-14 pt-4 sm:px-7 sm:pt-5 lg:px-10">
        <button type="button" onClick={onBack} className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[#475569] hover:bg-[#f0f9ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9]">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t("backToRooms")}
        </button>
        <GroupFocusPageHeader
          language={language}
          eyebrow={visibleStage === "lobby" ? t("lobby") : terminal ? t("terminal") : t("session")}
          title={room.name}
          description={roomMode}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs font-semibold ${connectionReady ? "bg-[#e0f2fe] text-[#0369a1]" : "bg-[#f4eee3] text-[#826a42]"}`}>
                <span className={`h-2 w-2 rounded-full ${connectionReady ? "bg-[#0ea5e9]" : "bg-[#bb9855]"}`} aria-hidden="true" />
                {connectionTitle(snapshot.status, t)}
              </span>
              {!connectionReady && !terminal && (
                <GroupFocusButton variant="secondary" onClick={onReconnect} disabled={snapshot.status === "CONNECTING" || snapshot.status === "RECONNECTING"}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />{t("retryConnection")}
                </GroupFocusButton>
              )}
            </div>
          }
        />

        {roomError && <div className="mt-5"><GroupFocusError message={roomError} /></div>}
        <div className="mt-6 grid gap-5 sm:grid-cols-[minmax(0,1.6fr)_minmax(270px,0.8fr)]">
          <div className="space-y-5">
            <section className="relative overflow-hidden rounded-[1.8rem] border border-[#dbeafe] bg-[#eef6ff] px-5 py-8 text-center sm:px-10 sm:py-12">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,rgba(96,165,250,0.20),transparent_72%)]" aria-hidden="true" />
              <div className="relative mx-auto max-w-lg">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#dbeafe] bg-[#ffffff]/80 px-3 py-1.5 text-xs font-semibold text-[#475569]">
                  {active ? <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> : <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />}
                  {active ? phaseLabel : terminal ? t("terminal") : visibleStage === "lobby" ? t("lobby") : phaseLabel}
                </div>
                {active ? (
                  <>
                    <RoomCountdownTimer
                      remainingMilliseconds={remainingMilliseconds}
                      unavailableLabel={t("timeUnavailable")}
                      accessibleLabel={t("accessibleTimer")}
                    />
                    <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[#64748b]">
                      <span>{progressCaption}</span>
                      <span aria-hidden="true">·</span>
                      <span>{(roomState?.focusDurationSeconds ?? room.focusDurationSeconds) / 60} {t("minutesShort")}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-[#0f172a] sm:text-3xl">
                      {terminal ? t("terminal") : visibleStage === "lobby" && confirmedLobby ? t("waitingForHost") : t("waitingForState")}
                    </h2>
                    <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#64748b]">
                      {terminal ? t("summarySubtitle") : snapshot.roomState ? phaseLabel : t("waitingForState")}
                    </p>
                    {!snapshot.roomState && connectionReady && !terminal && (
                      <GroupFocusButton
                        variant="secondary"
                        onClick={onRequestRoomState}
                        disabled={roomStateRequestPending}
                        className="mt-5"
                      >
                        {roomStateRequestPending ? t("requestingRoomState") : t("requestRoomState")}
                      </GroupFocusButton>
                    )}
                  </>
                )}
                {snapshot.status === "ERROR" && snapshot.error && (
                  <p className="mt-4 inline-flex items-center gap-2 text-sm text-[#8c5546]" role="status">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />{t("connectionError")}
                  </p>
                )}
              </div>
            </section>

            <GroupFocusPanel title={t("roomPlan")}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <PlanMetric label={t("focusLength")} value={`${room.focusDurationSeconds / 60}`} suffix={t("minutesShort")} />
                <PlanMetric label={t("breakLength")} value={`${room.breakDurationSeconds / 60}`} suffix={t("minutesShort")} />
                <PlanMetric label={t("rounds")} value={`${room.roundCount}`} />
                <PlanMetric label={t("participants")} value={roomCapacityLabel} />
              </div>
              <div className="mt-4 space-y-2">
                {visibleStudyPlan.map((item, index) => {
                  const lecture = lectures.find((candidate) => candidate.id === item.lectureId);
                  const activeLecture = item.lectureId === selectedLectureId;
                  return (
                    <div key={item.lectureId} className={`rounded-2xl border px-3 py-3 ${activeLecture ? "border-sky-300 bg-sky-50/90 dark:border-sky-300/30 dark:bg-sky-300/10" : "border-slate-200/80 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.035]"}`}>
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-bold text-blue-600 shadow-sm dark:bg-white/[0.07] dark:text-sky-200">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" dir="auto">{lecture?.name || t("selectedLectureUnavailable")}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{item.resources.length} {language === "ar" ? "مصادر دراسة" : "study resources"}</p>
                        </div>
                        {activeLecture && <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white">{language === "ar" ? "الحالية" : "Current"}</span>}
                      </div>
                      {item.resources.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5 ps-12">
                          {item.resources.map((resource) => (
                            <span
                              key={`${resource.resourceType}:${resource.resourceId}`}
                              className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-lg border border-sky-100 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
                            >
                              <StudyResourceIcon type={resource.resourceType} />
                              <span className="max-w-[220px] truncate" dir="auto">{studyResourceLabel(lecture, resource, language)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {canChooseLecture && visibleStudyPlan.length > 1 && (
                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-sky-100 bg-sky-50/60 p-4 dark:border-sky-300/15 dark:bg-sky-300/[0.06] sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("yourStudyLecture")}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100" dir="auto">
                      {selectedLecture?.name || (selectedLectureId ? t("selectedLectureUnavailable") : t("noneSelected"))}
                    </p>
                  </div>
                  <GroupFocusButton variant="secondary" onClick={() => setLecturePickerOpen(true)} disabled={lectureChangePending || lectureCatalogStatus === "loading"} className="shrink-0">
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    {lectureChangePending ? t("savingLecture") : t("changeLecture")}
                  </GroupFocusButton>
                </div>
              )}
            </GroupFocusPanel>
          </div>

          <aside className="space-y-5">
            <GroupFocusPanel>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b]">{t("roomStatus")}</p>
                  <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[#0f172a]">{room.status === "OPEN" ? (terminal ? t("terminal") : visibleStage === "lobby" ? t("waiting") : phaseLabel) : t("closed")}</p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eff6ff] text-[#0284c7]">
                  {room.visibility === "PRIVATE" ? <LockKeyhole className="h-5 w-5" aria-hidden="true" /> : <UsersRound className="h-5 w-5" aria-hidden="true" />}
                </span>
              </div>
              <div className="mt-5 border-t border-[#e2e8f0] pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#64748b]">{t("peopleHere")}</span>
                  <span className="font-semibold tabular-nums text-[#334155]" dir="ltr">{activeMembersLabel}</span>
                </div>
                {membership && (
                  <p className="mt-3 text-xs text-[#7c8a83]">
                    {membership.role === "HOST" ? t("host") : t("member")}
                  </p>
                )}
              </div>
            </GroupFocusPanel>

            <GroupFocusPanel title={t("liveParticipants")}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs leading-5 text-[#64748b]">{t("presenceHelp")}</p>
                <span className="rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-semibold tabular-nums text-[#475569]" dir="ltr">
                  {snapshot.presence.length}
                </span>
              </div>
              <p className="sr-only" role="status" aria-live="polite">
                {t("liveParticipants")}: {snapshot.presence.length}
              </p>
              {snapshot.presence.length === 0 ? (
                <p className="rounded-xl bg-[#f8fafc] p-3 text-sm leading-6 text-[#64748b]">
                  {t("presenceEmpty")}
                </p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto" aria-label={t("liveParticipants")}>
                  {snapshot.presence.map((participant) => {
                    const isSelf = participant.userId === snapshot.userId;
                    const isReconnecting = participant.connectionState === "RECONNECTING";
                    const participantLecture = room.mode === "STUDY_TOGETHER"
                      ? lectures.find((lecture) => lecture.id === participant.effectiveLectureId)
                      : null;
                    const roleLabel = participant.role === "HOST" ? t("host") : t("member");
                    return (
                      <li
                        key={participant.userId}
                        className="flex min-w-0 items-center gap-3 rounded-xl bg-[#f8fafc] p-3"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e0f2fe] text-[#0284c7]">
                          <UsersRound className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[#334155]" dir="auto">
                            {isSelf ? `${t("you")} · ${roleLabel}` : roleLabel}
                          </p>
                          {participantLecture && (
                            <p className="mt-0.5 truncate text-xs text-[#64748b]" dir="auto">
                              {participantLecture.name}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 text-xs ${isReconnecting ? "text-[#8a7145]" : "text-[#0284c7]"}`}>
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${isReconnecting ? "bg-[#c3a365]" : "bg-[#3b82f6]"}`}
                              aria-hidden="true"
                            />
                            {isReconnecting ? t("reconnecting") : t("connected")}
                          </span>
                          {memberManagementAllowed && !isSelf && participant.role !== "HOST" && (
                            <button
                              type="button"
                              onClick={() => onRemoveMember(participant.userId)}
                              disabled={memberRemovalPendingUserId !== null}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[#8a5749] hover:bg-[#f7ebe6] disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a6557]"
                              aria-label={t("removeMember")}
                            >
                              {memberRemovalPendingUserId === participant.userId
                                ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                : <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />}
                              <span className="hidden sm:inline">
                                {memberRemovalPendingUserId === participant.userId ? t("removingMember") : t("removeMember")}
                              </span>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </GroupFocusPanel>

            {shouldShowActions && (
              <GroupFocusPanel title={visibleStage === "lobby" ? t("lobby") : t("session")}>
                <div className="space-y-2">
                  {visibleStage === "lobby" && confirmedLobby && host && (
                    <GroupFocusButton onClick={onStart} disabled={!connectionReady || actionPending !== null} className="w-full">
                      {actionPending === "start" ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                      {actionPending === "start" ? t("starting") : t("start")}
                    </GroupFocusButton>
                  )}
                  {visibleStage === "lobby" && confirmedLobby && !host && <p className="rounded-xl bg-[#f8fafc] p-3 text-sm leading-6 text-[#64748b]">{t("waitingForHost")}</p>}
                  {active && host && phase !== "PAUSED" && (
                    <GroupFocusButton variant="secondary" onClick={onPause} disabled={!connectionReady || actionPending !== null} className="w-full">
                      {actionPending === "pause" ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
                      {t("pause")}
                    </GroupFocusButton>
                  )}
                  {active && host && phase === "PAUSED" && (
                    <GroupFocusButton onClick={onResume} disabled={!connectionReady || actionPending !== null} className="w-full">
                      {actionPending === "resume" ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                      {t("resume")}
                    </GroupFocusButton>
                  )}
                  {host && (
                    confirmClose ? (
                      <div className="rounded-xl border border-[#e5d5ca] bg-[#fff8f2] p-4">
                        <p className="font-semibold text-[#6e473b]">{t("closeConfirmTitle")}</p>
                        <p className="mt-1 text-sm leading-5 text-[#8a6b5e]">{t("closeConfirmText")}</p>
                        <div className="mt-4 flex flex-col gap-2">
                          <GroupFocusButton variant="danger" onClick={onCloseRoom} disabled={actionPending !== null} className="w-full">{t("confirmEnd")}</GroupFocusButton>
                          <GroupFocusButton variant="quiet" onClick={() => setConfirmClose(false)}>{t("cancel")}</GroupFocusButton>
                        </div>
                      </div>
                    ) : (
                      <GroupFocusButton variant="quiet" onClick={() => setConfirmClose(true)} className="w-full">{t("closeRoom")}</GroupFocusButton>
                    )
                  )}
                  {membership?.status === "ACTIVE" && membership.role !== "HOST" && (
                    <GroupFocusButton variant="quiet" onClick={onLeave} disabled={actionPending !== null} className="w-full">{t("leave")}</GroupFocusButton>
                  )}
                </div>
              </GroupFocusPanel>
            )}
            {room.visibility === "PRIVATE" && inviteManagementAllowed && room.status === "OPEN" && !terminal && (
              <GroupFocusPanel title={t("inviteLink")}>
                <p className="text-sm leading-6 text-[#64748b]">{t("inviteHelp")}</p>
                {safeInviteLinkOrCode && (
                  <>
                    <label className="mt-4 block">
                      <span className="sr-only">{t("inviteLink")}</span>
                      <input
                        readOnly
                        value={safeInviteLinkOrCode}
                        dir="ltr"
                        className="min-h-12 w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 text-sm text-[#334155] outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9]"
                      />
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <GroupFocusButton
                        variant="secondary"
                        onClick={() => onCopyInvite(safeInviteLinkOrCode)}
                        disabled={inviteActionPending !== null}
                        className="w-full"
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        {inviteActionPending === "copy" ? t("working") : t("copyInvite")}
                      </GroupFocusButton>
                      <GroupFocusButton
                        variant="secondary"
                        onClick={() => onShareInvite(safeInviteLinkOrCode)}
                        disabled={inviteActionPending !== null}
                        className="w-full"
                      >
                        <Share2 className="h-4 w-4" aria-hidden="true" />
                        {inviteActionPending === "share" ? t("working") : t("shareInvite")}
                      </GroupFocusButton>
                    </div>
                  </>
                )}
                {inviteFeedback && (
                  <p className={`mt-3 text-sm ${inviteFeedback.kind === "error" ? "text-[#8c5546]" : "text-[#0284c7]"}`} role={inviteFeedback.kind === "error" ? "alert" : "status"}>
                    {inviteFeedback.message}
                  </p>
                )}
                <GroupFocusButton
                  variant="quiet"
                  onClick={onRotateInvite}
                  disabled={inviteActionPending !== null}
                  className="mt-3 w-full"
                >
                  {inviteActionPending === "rotate" ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                  {inviteActionPending === "rotate" ? t("rotatingInvite") : t("rotateInvite")}
                </GroupFocusButton>
              </GroupFocusPanel>
            )}
            {terminal && (
              <GroupFocusButton onClick={onOpenSummary} className="w-full">{t("summaryTitle")}</GroupFocusButton>
            )}
            {FOCUS_AUDIO_ENABLED && !terminal && (
              <FocusAudioPlanningCard language={language} idPrefix="group-focus-audio" />
            )}
          </aside>
        </div>
      </div>
      <FocusLecturePicker
        isOpen={lecturePickerOpen && canChooseLecture}
        lectures={selectableLectures}
        subjects={subjects}
        queuedItems={queuedStudyPlanItems}
        language={language}
        catalogStatus={lectureCatalogStatus}
        onClose={closeLecturePicker}
        onSelect={(lecture) => {
          onChooseLecture(lecture.id);
          setLecturePickerOpen(false);
        }}
        onRefresh={onRefreshLectures}
      />
    </GroupFocusShell>
  );
}

function PlanMetric({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-xl bg-[#f8fafc] p-3">
      <p className="text-xs leading-5 text-[#64748b]">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-[-0.025em] text-[#334155]" dir="ltr">
        {value}{suffix ? <span className="ms-1 text-xs font-medium text-[#64748b]">{suffix}</span> : null}
      </p>
    </div>
  );
}