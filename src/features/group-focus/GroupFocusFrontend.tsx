import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DatabaseLecture, Subject } from "../../core/types.js";
import type { Language } from "../../core/i18n/translations.js";
import {
  createGroupFocusRoom,
  getGroupFocusRoom,
  getMyGroupFocusRuntimeSummary,
  joinGroupFocusRoom,
  leaveGroupFocusRoom,
  listMyGroupFocusRooms,
  listPublicGroupFocusRooms,
  rotateGroupFocusInvite,
  updateMyGroupFocusLecture,
  GroupFocusApiError,
  type CreateGroupFocusRoomInput,
  type GroupFocusMembershipDto,
  type GroupFocusRoomDetail,
  type GroupFocusRoomDto,
} from "./api/groupFocusApi.js";
import {
  connectGroupFocusRuntime,
  getOrCreateGroupFocusRuntime,
  leaveAndRemoveGroupFocusRuntime,
  removeTerminalGroupFocusRuntime,
  type GroupFocusRuntimeEntry,
} from "./runtime/groupFocusRuntimeStore.js";
import type {
  GroupFocusRealtimeSnapshot,
} from "./runtime/groupFocusRealtime.js";
import {
  GroupFocusCreateJoin,
  GroupFocusHome,
  GroupFocusRoom,
  GroupFocusSummary,
  GroupFocusError,
  GroupFocusShell,
} from "./ui/index.js";
import {
  buildGroupFocusInviteUrl,
  groupFocusErrorMessage,
  parseGroupFocusFrontendRoute,
  parseGroupFocusJoinInput,
} from "./groupFocusFrontendModel.js";

const PUBLIC_ROOM_PAGE_SIZE = 20;
const HOME_REFRESH_MILLISECONDS = 25_000;
const SUMMARY_FINALIZATION_RETRIES = 8;
const SUMMARY_FINALIZATION_DELAY_MILLISECONDS = 2_500;
const CANONICAL_LECTURE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GroupFocusFrontendProps = {
  accountId: string | null;
  language: Language;
  lectures: DatabaseLecture[];
  subjects: Subject[];
  catalogStatus: "loading" | "ready" | "error";
  onRefreshLectures: () => Promise<void>;
  workerUrl: string;
  routePath: string;
  onRouteChange: (routePath: string) => void;
};

function localized(language: Language, english: string, arabic: string): string {
  return language === "ar" ? arabic : english;
}

function createIdempotencyKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure room creation identifiers are unavailable.");
  }
  if (typeof crypto.randomUUID === "function") {
    return `group-focus-${crypto.randomUUID()}`;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `group-focus-${suffix}`;
}

function safeOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function emptySnapshot(roomId: string): GroupFocusRealtimeSnapshot {
  return {
    status: "IDLE",
    roomId,
    connectionId: null,
    userId: null,
    role: null,
    revision: -1,
    roomState: null,
    presence: [],
    estimatedServerNow: null,
    error: null,
  };
}

function isTerminalPhase(phase: string | undefined): boolean {
  return phase === "COMPLETED" || phase === "CLOSED";
}

function lectureDisplayName(
  lectures: DatabaseLecture[],
  lectureId: string | null,
): string | null {
  if (!lectureId) return null;
  const lecture = lectures.find((item) => item.id === lectureId);
  if (!lecture) return null;
  if ("title" in lecture && typeof lecture.title === "string") return lecture.title;
  if ("name" in lecture && typeof lecture.name === "string") return lecture.name;
  return null;
}

export function GroupFocusFrontend({
  accountId,
  language,
  lectures,
  subjects,
  catalogStatus,
  onRefreshLectures,
  workerUrl,
  routePath,
  onRouteChange,
}: GroupFocusFrontendProps) {
  const route = useMemo(
    () => parseGroupFocusFrontendRoute(routePath),
    [routePath],
  );
  const isHome = route.kind === "home";
  const mountedRef = useRef(true);

  const accessibleLectures = useMemo(
    () => lectures.filter((lecture) => CANONICAL_LECTURE_ID.test(lecture.id)),
    [lectures],
  );

  const [myRooms, setMyRooms] = useState<GroupFocusRoomDto[]>([]);
  const [myRoomsStatus, setMyRoomsStatus] =
    useState<"loading" | "ready" | "error">("loading");
  const [myRoomsError, setMyRoomsError] = useState<string | undefined>();
  const [publicRooms, setPublicRooms] = useState<GroupFocusRoomDto[]>([]);
  const [publicRoomsStatus, setPublicRoomsStatus] =
    useState<"loading" | "ready" | "error">("loading");
  const [publicRoomsError, setPublicRoomsError] = useState<string | undefined>();
  const [publicNextCursor, setPublicNextCursor] = useState<string | null>(null);
  const [loadingMorePublicRooms, setLoadingMorePublicRooms] = useState(false);
  const myRoomsRequestInFlight = useRef(false);
  const publicRoomsRequestInFlight = useRef(false);

  const [joinPrefill, setJoinPrefill] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [formSubmitting, setFormSubmitting] = useState(false);
  const formSubmissionLock = useRef(false);
  const createAttempt = useRef<{ payload: string; idempotencyKey: string } | null>(null);

  const [roomDetail, setRoomDetail] = useState<GroupFocusRoomDetail | null>(null);
  const [roomStatus, setRoomStatus] =
    useState<"loading" | "ready" | "error">("loading");
  const [roomError, setRoomError] = useState<string | undefined>();
  const [roomRequestVersion, setRoomRequestVersion] = useState(0);
  const [runtimeEntry, setRuntimeEntry] = useState<GroupFocusRuntimeEntry | null>(null);
  const [snapshot, setSnapshot] = useState<GroupFocusRealtimeSnapshot>(() =>
    emptySnapshot(route.kind === "room" ? route.roomId : ""),
  );
  const [actionPending, setActionPending] =
    useState<"start" | "pause" | "resume" | "leave" | "close" | null>(null);
  const [lectureChangePending, setLectureChangePending] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteActionPending, setInviteActionPending] =
    useState<"rotate" | "copy" | "share" | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const terminalRouteRequested = useRef<string | null>(null);

  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof getMyGroupFocusRuntimeSummary>
  > | null>(null);
  const [summaryStatus, setSummaryStatus] =
    useState<"loading" | "ready" | "error">("loading");
  const [summaryError, setSummaryError] = useState<string | undefined>();
  const [summaryRetryVersion, setSummaryRetryVersion] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadMyRooms = useCallback(async () => {
    if (!accountId || myRoomsRequestInFlight.current) return;
    myRoomsRequestInFlight.current = true;
    setMyRoomsStatus((current) => current === "ready" ? current : "loading");
    setMyRoomsError(undefined);
    try {
      const result = await listMyGroupFocusRooms({
        limit: 50,
        membershipStatus: "ACTIVE",
        roomStatus: "OPEN",
      });
      if (!mountedRef.current) return;
      setMyRooms(result.rooms.map((entry) => entry.room));
      setMyRoomsStatus("ready");
    } catch (error) {
      if (!mountedRef.current) return;
      setMyRoomsError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "Your rooms could not be loaded.", "تعذر تحميل غرفك."),
      ));
      setMyRoomsStatus("error");
    } finally {
      myRoomsRequestInFlight.current = false;
    }
  }, [accountId, language]);

  const loadPublicRooms = useCallback(async (
    cursor: string | null = null,
    append = false,
  ) => {
    if (publicRoomsRequestInFlight.current) return;
    publicRoomsRequestInFlight.current = true;
    if (append) {
      setLoadingMorePublicRooms(true);
    } else {
      setPublicRoomsStatus((current) => current === "ready" ? current : "loading");
    }
    setPublicRoomsError(undefined);
    try {
      const result = await listPublicGroupFocusRooms({
        limit: PUBLIC_ROOM_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });
      if (!mountedRef.current) return;
      setPublicRooms((current) => append ? [...current, ...result.rooms] : result.rooms);
      setPublicNextCursor(result.nextCursor);
      setPublicRoomsStatus("ready");
    } catch (error) {
      if (!mountedRef.current) return;
      setPublicRoomsError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "Public rooms could not be loaded.", "تعذر تحميل الغرف العامة."),
      ));
      setPublicRoomsStatus("error");
    } finally {
      publicRoomsRequestInFlight.current = false;
      if (mountedRef.current) setLoadingMorePublicRooms(false);
    }
  }, [language]);

  useEffect(() => {
    if (!isHome || !accountId) return;
    void loadMyRooms();
    void loadPublicRooms();
    const refresh = window.setInterval(() => {
      void loadMyRooms();
      void loadPublicRooms();
    }, HOME_REFRESH_MILLISECONDS);
    return () => window.clearInterval(refresh);
  }, [accountId, isHome, loadMyRooms, loadPublicRooms]);

  const openCreate = useCallback(() => {
    setFormError(undefined);
    setJoinPrefill(undefined);
    onRouteChange("create");
  }, [onRouteChange]);

  const openJoin = useCallback(() => {
    setFormError(undefined);
    setJoinPrefill(undefined);
    onRouteChange("join");
  }, [onRouteChange]);

  const openPublicRoomJoin = useCallback((room: GroupFocusRoomDto) => {
    const link = safeOrigin()
      ? `${safeOrigin()}/#focus/group/room/${encodeURIComponent(room.id)}`
      : room.id;
    setJoinPrefill(link);
    setFormError(undefined);
    onRouteChange("join");
  }, [onRouteChange]);

  const navigateToSummary = useCallback((roomId: string, terminal = false) => {
    onRouteChange(`summary/${encodeURIComponent(roomId)}`);
    if (terminal && accountId) {
      window.setTimeout(() => removeTerminalGroupFocusRuntime(accountId, roomId), 0);
    }
  }, [accountId, onRouteChange]);

  const createRoom = useCallback(async (
    input: Omit<CreateGroupFocusRoomInput, "idempotencyKey">,
  ) => {
    if (!accountId) return;
    if (!workerUrl) {
      setFormError(localized(
        language,
        "Realtime rooms are not configured on this app yet. No room was created.",
        "لم يتم إعداد الاتصال المباشر للغرف بعد. لم يتم إنشاء أي غرفة.",
      ));
      return;
    }
    if (formSubmissionLock.current) return;

    const payload = JSON.stringify(input);
    if (!createAttempt.current || createAttempt.current.payload !== payload) {
      try {
        createAttempt.current = {
          payload,
          idempotencyKey: createIdempotencyKey(),
        };
      } catch {
        setFormError(localized(
          language,
          "Secure room creation is unavailable in this browser.",
          "إنشاء الغرفة الآمن غير متاح في هذا المتصفح.",
        ));
        return;
      }
    }
    formSubmissionLock.current = true;
    setFormSubmitting(true);
    setFormError(undefined);
    try {
      const result = await createGroupFocusRoom({
        ...input,
        idempotencyKey: createAttempt.current.idempotencyKey,
      });
      createAttempt.current = null;
      setInviteToken(null);
      onRouteChange(`room/${encodeURIComponent(result.room.id)}`);
    } catch (error) {
      setFormError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "The room could not be created. Your settings are still here; try again.", "تعذر إنشاء الغرفة. بقيت إعداداتك كما هي؛ حاول مرة أخرى."),
      ));
    } finally {
      formSubmissionLock.current = false;
      if (mountedRef.current) setFormSubmitting(false);
    }
  }, [accountId, language, onRouteChange, workerUrl]);

  const joinRoom = useCallback(async (input: {
    roomLinkOrInvite: string;
    lectureId?: string;
  }): Promise<boolean> => {
    if (!accountId) return false;
    if (!workerUrl) {
      setFormError(localized(
        language,
        "Realtime rooms are not configured on this app yet. No room was joined.",
        "لم يتم إعداد الاتصال المباشر للغرف بعد. لم يتم الانضمام إلى أي غرفة.",
      ));
      return false;
    }
    if (formSubmissionLock.current) return false;
    const parsed = parseGroupFocusJoinInput(input.roomLinkOrInvite, safeOrigin());
    if (!parsed) {
      setFormError(localized(
        language,
        "Enter a room ID or paste the complete Group Focus invite link.",
        "أدخل معرّف الغرفة أو الصق رابط دعوة التركيز الجماعي كاملاً.",
      ));
      return false;
    }

    formSubmissionLock.current = true;
    setFormSubmitting(true);
    setFormError(undefined);
    try {
      const result = await joinGroupFocusRoom(parsed.roomId, {
        ...(parsed.inviteToken ? { inviteToken: parsed.inviteToken } : {}),
        ...(input.lectureId ? { lectureId: input.lectureId } : {}),
      });
      setJoinPrefill(undefined);
      setInviteToken(null);
      onRouteChange(`room/${encodeURIComponent(result.room.id)}`);
      return false;
    } catch (error) {
      setFormError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "The room could not be joined. Check the invite and try again.", "تعذر الانضمام إلى الغرفة. تحقق من الدعوة وحاول مرة أخرى."),
      ));
      return error instanceof GroupFocusApiError
        && error.code === "INVALID_MEMBER_LECTURE"
        && !input.lectureId;
    } finally {
      formSubmissionLock.current = false;
      if (mountedRef.current) setFormSubmitting(false);
    }
  }, [accountId, language, onRouteChange, workerUrl]);

  useEffect(() => {
    if (route.kind !== "room" || !accountId) return;
    let cancelled = false;
    setRoomStatus("loading");
    setRoomError(undefined);
    setRoomDetail(null);
    setRuntimeEntry(null);
    setSnapshot(emptySnapshot(route.roomId));
    setInviteToken(null);
    setInviteFeedback(null);
    setActionPending(null);

    void getGroupFocusRoom(route.roomId).then((detail) => {
      if (cancelled || !mountedRef.current) return;
      setRoomDetail(detail);
      if (detail.room.status === "CLOSED") {
        if (detail.membership) {
          navigateToSummary(route.roomId, true);
          return;
        }
        setRoomStatus("error");
        setRoomError(localized(language, "This room is closed or unavailable.", "هذه الغرفة مغلقة أو غير متاحة."));
        return;
      }
      if (!detail.membership || detail.membership.status !== "ACTIVE") {
        setRoomStatus("error");
        setRoomError(localized(language, "This account is not an active member of this room.", "هذا الحساب ليس عضواً نشطاً في هذه الغرفة."));
        return;
      }
      setRoomStatus("ready");
      if (!workerUrl) {
        setRoomError(localized(language, "Realtime rooms are not configured on this app yet.", "لم يتم إعداد الاتصال المباشر للغرف بعد."));
      }
    }).catch((error: unknown) => {
      if (cancelled || !mountedRef.current) return;
      setRoomStatus("error");
      setRoomError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "This room is unavailable to this account.", "هذه الغرفة غير متاحة لهذا الحساب."),
      ));
    });

    return () => {
      cancelled = true;
    };
  }, [accountId, language, navigateToSummary, onRouteChange, roomRequestVersion, route, workerUrl]);

  useEffect(() => {
    if (
      route.kind !== "room"
      || !accountId
      || !workerUrl
      || roomStatus !== "ready"
      || !roomDetail
      || roomDetail.room.status !== "OPEN"
      || roomDetail.membership?.status !== "ACTIVE"
    ) return;

    let entry: GroupFocusRuntimeEntry;
    try {
      entry = getOrCreateGroupFocusRuntime({
        accountId,
        roomId: route.roomId,
        workerUrl,
      });
    } catch (error) {
      setRoomError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "The realtime room connection could not be configured.", "تعذر إعداد الاتصال المباشر بالغرفة."),
      ));
      return;
    }
    setRuntimeEntry(entry);
    setSnapshot(entry.runtime.getSnapshot());
    const unsubscribe = entry.runtime.subscribe(setSnapshot);
    void connectGroupFocusRuntime(entry).catch(() => {
      // The runtime publishes a safe, user-facing status/error snapshot.
    });
    return unsubscribe;
  }, [
    accountId,
    language,
    roomDetail,
    roomStatus,
    route,
    workerUrl,
  ]);

  const visibleSnapshot = runtimeEntry?.roomId === (route.kind === "room" ? route.roomId : "")
    ? snapshot
    : emptySnapshot(route.kind === "room" ? route.roomId : "");
  const visibleRoomDetail = route.kind === "room" ? roomDetail : null;
  const visibleMembership = visibleRoomDetail?.membership ?? null;
  const visibleRoom = visibleRoomDetail?.room ?? null;
  const runtimeIdentityConfirmed =
    Boolean(accountId)
    && visibleSnapshot.userId === accountId
    && visibleMembership?.userId === accountId;
  const hostAuthorized =
    runtimeIdentityConfirmed
    && visibleSnapshot.status === "CONNECTED"
    && visibleSnapshot.role === "HOST"
    && visibleMembership?.role === "HOST";
  const selectedLectureId = visibleRoom?.mode === "SHARED_LECTURE"
    ? visibleRoom.sharedLectureId
    : visibleRoomDetail?.effectiveLectureId ?? null;
  const safeInviteLink = useMemo(() => {
    if (!inviteToken || !visibleRoom || !safeOrigin()) return null;
    return buildGroupFocusInviteUrl(visibleRoom.id, inviteToken, safeOrigin());
  }, [inviteToken, visibleRoom]);

  useEffect(() => {
    if (route.kind !== "room" || !accountId) return;
    const phase = visibleSnapshot.roomState?.phase;
    if (visibleSnapshot.status !== "TERMINAL" && !isTerminalPhase(phase)) return;
    const key = `${accountId}:${route.roomId}`;
    if (terminalRouteRequested.current === key) return;
    terminalRouteRequested.current = key;
    navigateToSummary(route.roomId, true);
  }, [
    accountId,
    navigateToSummary,
    route,
    visibleSnapshot.roomState?.phase,
    visibleSnapshot.status,
  ]);

  useEffect(() => {
    if (route.kind === "room" && visibleSnapshot.status === "CONNECTED") {
      setActionPending(null);
      setRoomError(undefined);
    }
  }, [route.kind, visibleSnapshot.revision, visibleSnapshot.status]);

  const handleCreate = useCallback((
    input: Omit<CreateGroupFocusRoomInput, "idempotencyKey">,
  ) => {
    void createRoom(input);
  }, [createRoom]);

  const handleJoin = useCallback((input: {
    roomLinkOrInvite: string;
    lectureId?: string;
  }) => joinRoom(input), [joinRoom]);

  const runHostCommand = useCallback((
    action: "start" | "pause" | "resume" | "close",
  ) => {
    if (!runtimeEntry || !hostAuthorized) {
      setRoomError(localized(language, "Reconnect to the room before using host controls.", "أعد الاتصال بالغرفة قبل استخدام أدوات المضيف."));
      return;
    }
    const phase = visibleSnapshot.roomState?.phase;
    if (
      (action === "start" && phase !== "LOBBY")
      || (action === "pause" && !["COUNTDOWN", "FOCUS", "BREAK"].includes(phase ?? ""))
      || (action === "resume" && phase !== "PAUSED")
      || (action === "close" && isTerminalPhase(phase))
    ) return;

    setActionPending(action);
    setRoomError(undefined);
    try {
      if (action === "start") runtimeEntry.runtime.start();
      else if (action === "pause") runtimeEntry.runtime.pause();
      else if (action === "resume") runtimeEntry.runtime.resume();
      else runtimeEntry.runtime.closeRoom();
      window.setTimeout(() => {
        setActionPending((pending) => pending === action ? null : pending);
      }, 8_000);
    } catch (error) {
      setActionPending(null);
      setRoomError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "The room action could not be sent. Reconnect and try again.", "تعذر إرسال الإجراء إلى الغرفة. أعد الاتصال وحاول مرة أخرى."),
      ));
    }
  }, [hostAuthorized, language, runtimeEntry, visibleSnapshot.roomState?.phase]);

  const leaveRoom = useCallback(async () => {
    if (!visibleRoom || !visibleMembership || visibleMembership.role === "HOST") return;
    setActionPending("leave");
    setRoomError(undefined);
    try {
      await leaveGroupFocusRoom(visibleRoom.id);
      if (runtimeEntry) {
        try {
          await leaveAndRemoveGroupFocusRuntime(runtimeEntry);
        } catch {
          runtimeEntry.runtime.dispose();
        }
      }
      setRuntimeEntry(null);
      setInviteToken(null);
      onRouteChange("");
      void loadMyRooms();
    } catch (error) {
      setActionPending(null);
      setRoomError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "You could not leave the room. Your membership has not been changed.", "تعذر مغادرة الغرفة. لم يتم تغيير عضويتك."),
      ));
    }
  }, [language, loadMyRooms, onRouteChange, runtimeEntry, visibleMembership, visibleRoom]);

  const rotateInvite = useCallback(async () => {
    if (!visibleRoom || !hostAuthorized || visibleRoom.visibility !== "PRIVATE" || visibleRoom.status !== "OPEN") {
      return;
    }
    setInviteActionPending("rotate");
    setInviteFeedback(null);
    try {
      const result = await rotateGroupFocusInvite(visibleRoom.id);
      setInviteToken(result.inviteToken);
      setInviteFeedback({
        kind: "success",
        message: localized(language, "A new invite is ready.", "أصبحت دعوة جديدة جاهزة."),
      });
    } catch (error) {
      setInviteFeedback({
        kind: "error",
        message: groupFocusErrorMessage(
          error,
          language,
          localized(language, "The invite could not be created.", "تعذر إنشاء الدعوة."),
        ),
      });
    } finally {
      setInviteActionPending(null);
    }
  }, [hostAuthorized, language, visibleRoom]);

  const copyInvite = useCallback(async (invite: string) => {
    setInviteActionPending("copy");
    setInviteFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable.");
      await navigator.clipboard.writeText(invite);
      setInviteFeedback({
        kind: "success",
        message: localized(language, "Invite copied.", "تم نسخ الدعوة."),
      });
    } catch {
      setInviteFeedback({
        kind: "error",
        message: localized(language, "The invite could not be copied on this device.", "تعذر نسخ الدعوة على هذا الجهاز."),
      });
    } finally {
      setInviteActionPending(null);
    }
  }, [language]);

  const shareInvite = useCallback(async (invite: string) => {
    setInviteActionPending("share");
    setInviteFeedback(null);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: localized(language, "Group Focus invite", "دعوة إلى التركيز الجماعي"),
          text: localized(language, "Join my Group Focus room.", "انضم إلى غرفة التركيز الجماعي."),
          url: invite,
        });
        setInviteFeedback({
          kind: "success",
          message: localized(language, "Invite shared.", "تمت مشاركة الدعوة."),
        });
      } else {
        await copyInvite(invite);
      }
    } catch {
      setInviteFeedback({
        kind: "error",
        message: localized(language, "The invite could not be shared.", "تعذرت مشاركة الدعوة."),
      });
    } finally {
      setInviteActionPending(null);
    }
  }, [copyInvite, language]);

  const chooseLecture = useCallback(async (lectureId: string) => {
    if (
      !visibleRoom
      || !visibleMembership
      || visibleMembership.status !== "ACTIVE"
      || visibleRoom.status !== "OPEN"
      || visibleRoom.mode !== "STUDY_TOGETHER"
      || !CANONICAL_LECTURE_ID.test(lectureId)
    ) return;
    setLectureChangePending(true);
    setRoomError(undefined);
    try {
      const result = await updateMyGroupFocusLecture(visibleRoom.id, lectureId);
      setRoomDetail((current) => current
        ? {
          ...current,
          membership: result.membership,
          effectiveLectureId: result.effectiveLectureId,
        }
        : current);
    } catch (error) {
      setRoomError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "Your lecture could not be changed.", "تعذر تغيير محاضرتك."),
      ));
    } finally {
      setLectureChangePending(false);
    }
  }, [language, visibleMembership, visibleRoom]);

  const requestRoomState = useCallback(() => {
    if (!runtimeEntry || visibleSnapshot.status !== "CONNECTED") return;
    try {
      runtimeEntry.runtime.requestRoomState();
    } catch (error) {
      setRoomError(groupFocusErrorMessage(
        error,
        language,
        localized(language, "The room state could not be refreshed.", "تعذر تحديث حالة الغرفة."),
      ));
    }
  }, [language, runtimeEntry, visibleSnapshot.status]);

  const reconnect = useCallback(() => {
    if (!runtimeEntry || !workerUrl) return;
    setRoomError(undefined);
    runtimeEntry.runtime.retryConnection();
  }, [runtimeEntry, workerUrl]);

  const retryRoom = useCallback(() => {
    setRoomRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (route.kind !== "summary" || !accountId) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempts = 0;
    setSummary(null);
    setSummaryStatus("loading");
    setSummaryError(undefined);

    const fetchSummary = async () => {
      try {
        const result = await getMyGroupFocusRuntimeSummary(route.roomId);
        if (cancelled || !mountedRef.current) return;
        setSummary(result);
        setSummaryStatus("ready");
      } catch (error) {
        if (cancelled || !mountedRef.current) return;
        if (attempts < SUMMARY_FINALIZATION_RETRIES) {
          attempts += 1;
          retryTimer = window.setTimeout(
            () => void fetchSummary(),
            SUMMARY_FINALIZATION_DELAY_MILLISECONDS,
          );
          return;
        }
        setSummaryError(groupFocusErrorMessage(
          error,
          language,
          localized(language, "The room summary could not be loaded. Try again.", "تعذر تحميل ملخص الغرفة. حاول مرة أخرى."),
        ));
        setSummaryStatus("error");
      }
    };
    void fetchSummary();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [accountId, language, route, summaryRetryVersion]);

  const retrySummary = useCallback(() => {
    setSummaryRetryVersion((version) => version + 1);
  }, []);

  if (!accountId) {
    return (
      <GroupFocusShell language={language}>
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
          <GroupFocusError
            message={localized(language, "Sign in to use Group Focus.", "سجّل الدخول لاستخدام التركيز الجماعي.")}
          />
        </div>
      </GroupFocusShell>
    );
  }

  if (route.kind === "create" || route.kind === "join") {
    const inviteJoinValue = route.kind === "join" && route.roomId && route.inviteToken
      ? buildGroupFocusInviteUrl(route.roomId, route.inviteToken, safeOrigin())
      : undefined;
    return (
      <GroupFocusCreateJoin
        language={language}
        lectures={accessibleLectures}
        subjects={subjects}
        catalogStatus={catalogStatus}
        initialView={route.kind === "join" ? "join" : "create"}
        initialJoinValue={inviteJoinValue ?? joinPrefill}
        submitting={formSubmitting}
        error={formError}
        onBack={() => onRouteChange("")}
        onCreate={handleCreate}
        onJoin={handleJoin}
        onJoinEdit={() => setFormError(undefined)}
        onRetryLectures={onRefreshLectures}
      />
    );
  }

  if (route.kind === "room") {
    const phase = visibleSnapshot.roomState?.phase;
    const stage = isTerminalPhase(phase) || visibleSnapshot.status === "TERMINAL"
      ? "terminal"
      : phase === "LOBBY"
        ? "lobby"
        : "session";
    const remainingMilliseconds = visibleSnapshot.status === "CONNECTED"
      ? runtimeEntry?.runtime.getRemainingMilliseconds() ?? null
      : null;
    const runtimeError = visibleSnapshot.error
      ? groupFocusErrorMessage(
        visibleSnapshot.error,
        language,
        localized(
          language,
          "The realtime room connection needs attention. Reconnect to sync with its current state.",
          "انقطع الاتصال المباشر بالغرفة. أعد الاتصال للمزامنة مع حالتها الحالية.",
        ),
      )
      : undefined;
    const effectiveRoomError = roomError ?? runtimeError;

    return (
      <GroupFocusRoom
        language={language}
        room={visibleRoom}
        membership={visibleMembership}
        roomStatus={roomStatus}
        stage={stage}
        snapshot={visibleSnapshot}
        remainingMilliseconds={remainingMilliseconds}
        actionPending={actionPending}
        lectureName={lectureDisplayName(accessibleLectures, selectedLectureId)}
        lectures={accessibleLectures}
        subjects={subjects}
        selectedLectureId={selectedLectureId}
        lectureCatalogStatus={catalogStatus}
        lectureChangePending={lectureChangePending}
        onChooseLecture={(lectureId) => void chooseLecture(lectureId)}
        onRefreshLectures={onRefreshLectures}
        inviteManagementAllowed={
          hostAuthorized
          && visibleRoom?.status === "OPEN"
          && visibleRoom.visibility === "PRIVATE"
        }
        safeInviteLinkOrCode={
          hostAuthorized && visibleRoom?.visibility === "PRIVATE"
            ? safeInviteLink
            : null
        }
        inviteActionPending={inviteActionPending}
        inviteFeedback={inviteFeedback}
        onRotateInvite={() => void rotateInvite()}
        onCopyInvite={(invite) => void copyInvite(invite)}
        onShareInvite={(invite) => void shareInvite(invite)}
        onBack={() => onRouteChange("")}
        onStart={() => runHostCommand("start")}
        onPause={() => runHostCommand("pause")}
        onResume={() => runHostCommand("resume")}
        onLeave={() => void leaveRoom()}
        onCloseRoom={() => runHostCommand("close")}
        onReconnect={reconnect}
        onRequestRoomState={requestRoomState}
        onRetryRoom={retryRoom}
        onOpenSummary={() => navigateToSummary(route.roomId)}
        roomError={effectiveRoomError}
      />
    );
  }

  if (route.kind === "summary") {
    return (
      <GroupFocusSummary
        language={language}
        summary={summary}
        status={summaryStatus}
        onBack={() => onRouteChange("")}
        onRetry={retrySummary}
        error={summaryError}
      />
    );
  }

  return (
    <GroupFocusHome
      language={language}
      myRooms={myRooms}
      publicRooms={publicRooms}
      myRoomsStatus={myRoomsStatus}
      publicRoomsStatus={publicRoomsStatus}
      publicNextCursor={publicNextCursor}
      loadingMorePublicRooms={loadingMorePublicRooms}
      onCreateRoom={openCreate}
      onStartJoin={openJoin}
      onJoinRoom={openPublicRoomJoin}
      onOpenRoom={(room) => {
        setInviteToken(null);
        onRouteChange(`room/${encodeURIComponent(room.id)}`);
      }}
      onRetryMyRooms={() => void loadMyRooms()}
      onRetryPublicRooms={() => void loadPublicRooms()}
      onLoadMorePublicRooms={() => {
        if (publicNextCursor) void loadPublicRooms(publicNextCursor, true);
      }}
      myRoomsError={myRoomsError}
      publicRoomsError={publicRoomsError}
    />
  );
}