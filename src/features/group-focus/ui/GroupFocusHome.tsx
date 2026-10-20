import { ArrowUpRight, BookOpen, LoaderCircle, LockKeyhole, Plus, UsersRound } from "lucide-react";
import type { GroupFocusRoomDto } from "../api/groupFocusApi";
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

export interface GroupFocusHomeProps {
  language: GroupFocusLanguage;
  myRooms: GroupFocusRoomDto[];
  publicRooms: GroupFocusRoomDto[];
  myRoomsStatus: "loading" | "ready" | "error";
  publicRoomsStatus: "loading" | "ready" | "error";
  publicNextCursor: string | null;
  loadingMorePublicRooms: boolean;
  onCreateRoom: () => void;
  onStartJoin: () => void;
  onJoinRoom: (room: GroupFocusRoomDto) => void;
  onOpenRoom: (room: GroupFocusRoomDto) => void;
  onRetryMyRooms: () => void;
  onRetryPublicRooms: () => void;
  onLoadMorePublicRooms: () => void;
  myRoomsError?: string;
  publicRoomsError?: string;
}

function RoomCard({
  room,
  language,
  action,
  actionLabel,
}: {
  room: GroupFocusRoomDto;
  language: GroupFocusLanguage;
  action: () => void;
  actionLabel: string;
}) {
  const { t } = useGroupFocusCopy(language);
  const isFull = room.participantCount >= room.maxParticipants;
  const modeLabel = room.mode === "SHARED_LECTURE" ? t("sharedLectureMode") : t("studyTogether");
  const lectureCount = room.mode === "SHARED_LECTURE" ? room.sharedStudyPlan.length : null;
  return (
    <article className="group overflow-hidden rounded-[24px] border border-sky-100/90 bg-white/78 p-4 shadow-[0_12px_34px_rgba(50,105,160,0.07)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_16px_42px_rgba(50,105,160,0.12)] dark:border-white/10 dark:bg-white/[0.04] sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="max-w-full truncate text-base font-bold tracking-[-0.02em] text-slate-900 dark:text-white" dir="auto">{room.name}</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:border-sky-300/15 dark:bg-sky-300/10 dark:text-sky-200">
              {room.visibility === "PRIVATE" ? <LockKeyhole className="h-3.5 w-3.5" /> : <UsersRound className="h-3.5 w-3.5" />}
              {room.visibility === "PRIVATE" ? t("privateRoom") : t("open")}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />{modeLabel}{lectureCount ? ` · ${lectureCount}` : ""}</span>
            <span className="tabular-nums" dir="ltr">{room.focusDurationSeconds / 60} {t("minuteCount")} · {room.roundCount} {t("rounds")}</span>
            <span className="tabular-nums" dir="ltr">{room.participantCount}/{room.maxParticipants} {t("participantsCount")}</span>
          </div>
        </div>
        <GroupFocusButton variant="secondary" disabled={room.status !== "OPEN" || isFull} onClick={action} className="w-full shrink-0 sm:w-auto">
          {room.status !== "OPEN" ? t("closed") : isFull ? t("full") : actionLabel}<ArrowUpRight className="h-4 w-4" />
        </GroupFocusButton>
      </div>
    </article>
  );
}

export function GroupFocusHome(props: GroupFocusHomeProps) {
  const { t } = useGroupFocusCopy(props.language);
  return (
    <GroupFocusShell language={props.language}>
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-4 sm:px-7 lg:px-10">
        <section className="overflow-hidden rounded-[30px] border border-sky-100/90 bg-gradient-to-br from-white/88 via-sky-50/50 to-indigo-50/55 p-5 shadow-[0_18px_55px_rgba(52,105,160,0.10)] backdrop-blur-xl dark:border-white/10 dark:from-white/[0.07] dark:via-sky-300/[0.035] dark:to-indigo-300/[0.04] sm:p-7">
          <GroupFocusPageHeader
            language={props.language}
            eyebrow={t("sharedFocus")}
            title={t("title")}
            description={t("subtitle")}
            action={<div className="flex flex-wrap gap-2"><GroupFocusButton variant="secondary" onClick={props.onCreateRoom}><Plus className="h-4 w-4" />{t("createRoom")}</GroupFocusButton><GroupFocusButton onClick={props.onStartJoin}>{t("joinRoom")}</GroupFocusButton></div>}
          />
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <section aria-labelledby="my-rooms-heading">
            <div className="mb-3 flex items-center justify-between gap-4 px-1">
              <h2 id="my-rooms-heading" className="text-base font-bold text-slate-800 dark:text-slate-100">{t("myRooms")}</h2>
              {props.myRoomsStatus === "ready" && props.myRooms.length > 0 && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-300/10 dark:text-sky-200">{props.myRooms.length}</span>}
            </div>
            {props.myRoomsStatus === "loading" && <GroupFocusSkeleton rows={2} label={t("loading")} />}
            {props.myRoomsStatus === "error" && <GroupFocusError message={props.myRoomsError || t("myRoomsLoadError")} onRetry={props.onRetryMyRooms} retryLabel={t("retry")} />}
            {props.myRoomsStatus === "ready" && props.myRooms.length === 0 && <GroupFocusPanel className="border-dashed"><p className="font-semibold text-slate-800 dark:text-white">{t("emptyMine")}</p><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("emptyMineHelp")}</p><GroupFocusButton onClick={props.onCreateRoom} className="mt-4">{t("createRoom")}</GroupFocusButton></GroupFocusPanel>}
            {props.myRoomsStatus === "ready" && props.myRooms.length > 0 && <div className="space-y-3">{props.myRooms.map((room) => <RoomCard key={room.id} room={room} language={props.language} action={() => props.onOpenRoom(room)} actionLabel={t("room")} />)}</div>}
          </section>

          <section aria-labelledby="public-rooms-heading">
            <div className="mb-3 px-1"><h2 id="public-rooms-heading" className="text-base font-bold text-slate-800 dark:text-slate-100">{t("publicRooms")}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("publicRoomsSubtitle")}</p></div>
            {props.publicRoomsStatus === "loading" && <GroupFocusSkeleton rows={2} label={t("loading")} />}
            {props.publicRoomsStatus === "error" && <GroupFocusError message={props.publicRoomsError || t("publicRoomsLoadError")} onRetry={props.onRetryPublicRooms} retryLabel={t("retry")} />}
            {props.publicRoomsStatus === "ready" && props.publicRooms.length === 0 && <GroupFocusPanel className="border-dashed"><p className="font-semibold text-slate-800 dark:text-white">{t("emptyPublic")}</p><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("emptyPublicHelp")}</p></GroupFocusPanel>}
            {props.publicRoomsStatus === "ready" && props.publicRooms.length > 0 && <div className="space-y-3">{props.publicRooms.map((room) => <RoomCard key={room.id} room={room} language={props.language} action={() => props.onJoinRoom(room)} actionLabel={t("joinRoom")} />)}</div>}
            {props.publicRoomsStatus === "ready" && props.publicNextCursor !== null && <div className="mt-4 flex justify-center"><GroupFocusButton variant="secondary" onClick={props.onLoadMorePublicRooms} disabled={props.loadingMorePublicRooms}>{props.loadingMorePublicRooms && <LoaderCircle className="h-4 w-4 animate-spin" />}{props.loadingMorePublicRooms ? t("loadingMore") : t("loadMore")}</GroupFocusButton></div>}
          </section>
        </div>
      </div>
    </GroupFocusShell>
  );
}
