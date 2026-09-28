import { ArrowUpRight, BookOpen, LoaderCircle, LockKeyhole, UsersRound } from "lucide-react";
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
  return (
    <article className="group flex flex-col gap-5 rounded-2xl border border-[#dce5de] bg-[#fbfcfa] p-5 transition-colors motion-reduce:transition-none hover:border-[#9db8ab] sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="max-w-full truncate text-lg font-semibold tracking-[-0.025em] text-[#253b36]" dir="auto">
            {room.name}
          </h3>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#edf3ee] px-2.5 py-1 text-xs font-medium text-[#55746b]">
            {room.visibility === "PRIVATE" ? <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> : <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />}
            {room.visibility === "PRIVATE" ? t("privateRoom") : t("open")}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#70817b]">
          <span className="inline-flex items-center gap-2">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            {modeLabel}
          </span>
          <span className="tabular-nums" dir="ltr">
            {room.focusDurationSeconds / 60} {t("minuteCount")} · {room.roundCount} {t("rounds")}
          </span>
          <span className="tabular-nums" dir="ltr">
            {room.participantCount}/{room.maxParticipants} {t("participantsCount")}
          </span>
        </div>
      </div>
      <GroupFocusButton
        variant="secondary"
        disabled={room.status !== "OPEN" || isFull}
        onClick={action}
        className="w-full shrink-0 sm:w-auto"
      >
        {room.status !== "OPEN" ? t("closed") : isFull ? t("full") : actionLabel}
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </GroupFocusButton>
    </article>
  );
}

export function GroupFocusHome({
  language,
  myRooms,
  publicRooms,
  myRoomsStatus,
  publicRoomsStatus,
  publicNextCursor,
  loadingMorePublicRooms,
  onCreateRoom,
  onStartJoin,
  onJoinRoom,
  onOpenRoom,
  onRetryMyRooms,
  onRetryPublicRooms,
  onLoadMorePublicRooms,
  myRoomsError,
  publicRoomsError,
}: GroupFocusHomeProps) {
  const { t } = useGroupFocusCopy(language);
  return (
    <GroupFocusShell language={language}>
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-7 sm:px-8 sm:pt-12 lg:px-12">
        <GroupFocusPageHeader
          language={language}
          eyebrow={t("sharedFocus")}
          title={t("title")}
          description={t("subtitle")}
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <GroupFocusButton variant="secondary" onClick={onCreateRoom}>
                {t("createRoom")}
              </GroupFocusButton>
              <GroupFocusButton onClick={onStartJoin}>
                {t("joinRoom")}
              </GroupFocusButton>
            </div>
          }
        />

        <section className="mt-9" aria-labelledby="my-rooms-heading">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 id="my-rooms-heading" className="text-lg font-semibold tracking-[-0.025em] text-[#2e4841]">{t("myRooms")}</h2>
            {myRoomsStatus === "ready" && myRooms.length > 0 && (
              <span className="rounded-full bg-[#e5eee7] px-3 py-1 text-xs font-medium text-[#547369] tabular-nums">
                {myRooms.length}
              </span>
            )}
          </div>
          {myRoomsStatus === "loading" && <GroupFocusSkeleton rows={2} label={t("loading")} />}
          {myRoomsStatus === "error" && (
            <GroupFocusError
              message={myRoomsError || t("myRoomsLoadError")}
              onRetry={onRetryMyRooms}
              retryLabel={t("retry")}
            />
          )}
          {myRoomsStatus === "ready" && myRooms.length === 0 && (
            <GroupFocusPanel className="border-dashed bg-[#f7faf6]">
              <p className="text-lg font-semibold tracking-[-0.02em] text-[#35564d]">{t("emptyMine")}</p>
              <p className="mt-2 max-w-lg text-sm leading-6 text-[#73827c]">{t("emptyMineHelp")}</p>
              <GroupFocusButton onClick={() => onCreateRoom()} className="mt-5">{t("createRoom")}</GroupFocusButton>
            </GroupFocusPanel>
          )}
          {myRoomsStatus === "ready" && myRooms.length > 0 && (
            <div className="space-y-3">
              {myRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  language={language}
                  action={() => onOpenRoom(room)}
                  actionLabel={t("room")}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-10" aria-labelledby="public-rooms-heading">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 id="public-rooms-heading" className="text-lg font-semibold tracking-[-0.025em] text-[#2e4841]">{t("publicRooms")}</h2>
              <p className="mt-1 text-sm text-[#798781]">{t("publicRoomsSubtitle")}</p>
            </div>
          </div>
          {publicRoomsStatus === "loading" && <GroupFocusSkeleton rows={2} label={t("loading")} />}
          {publicRoomsStatus === "error" && (
            <GroupFocusError
              message={publicRoomsError || t("publicRoomsLoadError")}
              onRetry={onRetryPublicRooms}
              retryLabel={t("retry")}
            />
          )}
          {publicRoomsStatus === "ready" && publicRooms.length === 0 && (
            <GroupFocusPanel className="border-dashed bg-[#f7faf6]">
              <p className="font-semibold text-[#35564d]">{t("emptyPublic")}</p>
              <p className="mt-1 text-sm text-[#73827c]">{t("emptyPublicHelp")}</p>
            </GroupFocusPanel>
          )}
          {publicRoomsStatus === "ready" && publicRooms.length > 0 && (
            <div className="space-y-3">
              {publicRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  language={language}
                  action={() => onJoinRoom(room)}
                  actionLabel={t("joinRoom")}
                />
              ))}
            </div>
          )}
          {publicRoomsStatus === "ready" && publicNextCursor !== null && (
            <div className="mt-4 flex justify-center">
              <GroupFocusButton
                variant="secondary"
                onClick={onLoadMorePublicRooms}
                disabled={loadingMorePublicRooms}
              >
                {loadingMorePublicRooms && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {loadingMorePublicRooms ? t("loadingMore") : t("loadMore")}
              </GroupFocusButton>
            </div>
          )}
        </section>
      </div>
    </GroupFocusShell>
  );
}