import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, BookOpen, Clock3, Copy, LoaderCircle, LockKeyhole, Pause, Play, RefreshCw, Share2, UsersRound } from "lucide-react";
import type { GroupFocusMembershipDto, GroupFocusRoomDto } from "../api/groupFocusApi";
import type { GroupFocusRealtimeSnapshot } from "../runtime/groupFocusRealtime";
import type { DatabaseLecture, Subject } from "../../../core/types";
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

const EMPTY_QUEUED_LECTURES: FocusPlanDraftItem[] = [];

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
    return <p className="mt-8 text-lg font-medium text-[#60766d]">{unavailableLabel}</p>;
  }

  const elapsedMilliseconds = Math.max(0, now - currentSample.sampledAt);
  const displayedMilliseconds = Math.max(0, currentSample.value - elapsedMilliseconds);
  return (
    <div
      className="mt-5 font-mono text-[clamp(4rem,13vw,8.5rem)] font-medium leading-none tracking-[-0.075em] text-[#284a41] tabular-nums"
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
  const shouldShowActions = !terminal && room.status === "OPEN";
  const confirmedLobby = authoritativePhase === "LOBBY";
  const canChooseLecture = room.mode === "STUDY_TOGETHER"
    && membership?.status === "ACTIVE"
    && !terminal;
  const selectedLecture = lectures.find((lecture) => lecture.id === selectedLectureId);

  return (
    <GroupFocusShell language={language}>
      <div className="mx-auto max-w-6xl px-4 pb-14 pt-6 sm:px-8 sm:pt-9 lg:px-12">
        <button type="button" onClick={onBack} className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[#54736a] hover:bg-[#e7eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39796b]">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t("backToRooms")}
        </button>
        <GroupFocusPageHeader
          language={language}
          eyebrow={visibleStage === "lobby" ? t("lobby") : terminal ? t("terminal") : t("session")}
          title={room.name}
          description={roomMode}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs font-semibold ${connectionReady ? "bg-[#e4f1e8] text-[#3c7059]" : "bg-[#f4eee3] text-[#826a42]"}`}>
                <span className={`h-2 w-2 rounded-full ${connectionReady ? "bg-[#5d9874]" : "bg-[#bb9855]"}`} aria-hidden="true" />
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
            <section className="relative overflow-hidden rounded-[1.8rem] border border-[#d7e3dc] bg-[#e9f0e9] px-5 py-8 text-center sm:px-10 sm:py-12">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,rgba(116,161,139,0.17),transparent_72%)]" aria-hidden="true" />
              <div className="relative mx-auto max-w-lg">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#d0dfd5] bg-[#f8faf6]/80 px-3 py-1.5 text-xs font-semibold text-[#55736a]">
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
                    <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[#6e8178]">
                      <span>{progressCaption}</span>
                      <span aria-hidden="true">·</span>
                      <span>{(roomState?.focusDurationSeconds ?? room.focusDurationSeconds) / 60} {t("minutesShort")}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-[#2c4c42] sm:text-3xl">
                      {terminal ? t("terminal") : visibleStage === "lobby" && confirmedLobby ? t("waitingForHost") : t("waitingForState")}
                    </h2>
                    <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#6e8178]">
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
                <PlanMetric label={t("peopleHere")} value={`${room.participantCount}/${room.maxParticipants}`} />
              </div>
              {room.mode === "SHARED_LECTURE" && (
                <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#f1f5f0] p-3">
                  <BookOpen className="h-4 w-4 shrink-0 text-[#67887b]" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#73847c]">{t("lecture")}</p>
                    <p className="truncate text-sm font-semibold text-[#38534b]" dir="auto">{lectureName || t("selectedLectureUnavailable")}</p>
                  </div>
                </div>
              )}
              {canChooseLecture && (
                <div className="mt-4 flex flex-col gap-3 rounded-xl bg-[#f1f5f0] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#73847c]">{t("yourStudyLecture")}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[#38534b]" dir="auto">
                      {selectedLecture?.name || (selectedLectureId ? t("selectedLectureUnavailable") : t("noneSelected"))}
                    </p>
                  </div>
                  <GroupFocusButton
                    variant="secondary"
                    onClick={() => setLecturePickerOpen(true)}
                    disabled={lectureChangePending || lectureCatalogStatus === "loading"}
                    className="shrink-0"
                  >
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
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#779087]">{t("roomStatus")}</p>
                  <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[#2b4840]">{room.status === "OPEN" ? (terminal ? t("terminal") : visibleStage === "lobby" ? t("waiting") : phaseLabel) : t("closed")}</p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#edf3ed] text-[#658779]">
                  {room.visibility === "PRIVATE" ? <LockKeyhole className="h-5 w-5" aria-hidden="true" /> : <UsersRound className="h-5 w-5" aria-hidden="true" />}
                </span>
              </div>
              <div className="mt-5 border-t border-[#e7ece7] pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#798982]">{t("peopleHere")}</span>
                  <span className="font-semibold tabular-nums text-[#405951]" dir="ltr">{room.participantCount} / {room.maxParticipants}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e6ece6]" role="meter" aria-label={t("peopleHere")} aria-valuemin={0} aria-valuemax={room.maxParticipants} aria-valuenow={Math.min(room.participantCount, room.maxParticipants)}>
                  <div className="h-full rounded-full bg-[#77a18e]" style={{ width: `${Math.min(100, (room.participantCount / room.maxParticipants) * 100)}%` }} />
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
                <p className="text-xs leading-5 text-[#788981]">{t("presenceHelp")}</p>
                <span className="rounded-full bg-[#edf3ee] px-2.5 py-1 text-xs font-semibold tabular-nums text-[#55746b]" dir="ltr">
                  {snapshot.presence.length}/{room.maxParticipants}
                </span>
              </div>
              <p className="sr-only" role="status" aria-live="polite">
                {t("liveParticipants")}: {snapshot.presence.length}
              </p>
              {snapshot.presence.length === 0 ? (
                <p className="rounded-xl bg-[#f5f8f4] p-3 text-sm leading-6 text-[#718078]">
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
                        className="flex min-w-0 items-center gap-3 rounded-xl bg-[#f5f8f4] p-3"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e4eee6] text-[#5d8172]">
                          <UsersRound className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[#38534b]" dir="auto">
                            {isSelf ? `${t("you")} · ${roleLabel}` : roleLabel}
                          </p>
                          {participantLecture && (
                            <p className="mt-0.5 truncate text-xs text-[#75847c]" dir="auto">
                              {participantLecture.name}
                            </p>
                          )}
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs ${isReconnecting ? "text-[#8a7145]" : "text-[#638271]"}`}>
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${isReconnecting ? "bg-[#c3a365]" : "bg-[#76a28a]"}`}
                            aria-hidden="true"
                          />
                          {isReconnecting ? t("reconnecting") : t("connected")}
                        </span>
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
                  {visibleStage === "lobby" && confirmedLobby && !host && <p className="rounded-xl bg-[#f2f6f1] p-3 text-sm leading-6 text-[#718078]">{t("waitingForHost")}</p>}
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
                <p className="text-sm leading-6 text-[#718078]">{t("inviteHelp")}</p>
                {safeInviteLinkOrCode && (
                  <>
                    <label className="mt-4 block">
                      <span className="sr-only">{t("inviteLink")}</span>
                      <input
                        readOnly
                        value={safeInviteLinkOrCode}
                        dir="ltr"
                        className="min-h-12 w-full rounded-xl border border-[#d3dfd8] bg-[#f5f8f4] px-3 text-sm text-[#38534b] outline-none focus-visible:ring-2 focus-visible:ring-[#39796b]"
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
                  <p className={`mt-3 text-sm ${inviteFeedback.kind === "error" ? "text-[#8c5546]" : "text-[#47745d]"}`} role={inviteFeedback.kind === "error" ? "alert" : "status"}>
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
        lectures={lectures}
        subjects={subjects}
        queuedItems={EMPTY_QUEUED_LECTURES}
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
    <div className="rounded-xl bg-[#f1f5f0] p-3">
      <p className="text-xs leading-5 text-[#7a8982]">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-[-0.025em] text-[#38554c]" dir="ltr">
        {value}{suffix ? <span className="ms-1 text-xs font-medium text-[#718078]">{suffix}</span> : null}
      </p>
    </div>
  );
}