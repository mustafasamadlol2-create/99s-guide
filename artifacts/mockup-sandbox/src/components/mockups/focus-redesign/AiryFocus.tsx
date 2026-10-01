import "./_group.css";
import "./AiryFocus.css";
import type { DatabaseLecture, Subject } from "../../../core/types";
import type { Language } from "../../../core/i18n/translations";
import { FocusHub } from "../../../features/focus/components/FocusHub";

type LectureCatalogStatus = "loading" | "ready" | "error";

interface AiryFocusProps {
  lectures?: DatabaseLecture[];
  subjects?: Subject[];
  language?: Language;
  catalogStatus?: LectureCatalogStatus;
  sessionRouteId?: string | null;
  summaryRouteId?: string | null;
  historyOpen?: boolean;
  historyDetailId?: string | null;
  onRefreshLectures?: () => Promise<void>;
  onBackToHome?: () => void;
  onReturnToPlanner?: () => void;
  onOpenSession?: (sessionId: string) => void;
  onOpenSummary?: (sessionId: string) => void;
  onOpenHistory?: () => void;
  onOpenHistoryDetail?: (sessionId: string) => void;
  onReturnToHistory?: () => void;
}

const emptyLectures: DatabaseLecture[] = [];
const emptySubjects: Subject[] = [];
const noOperation = () => {};
const refreshLectures = async () => {};

export function AiryFocus({
  lectures = emptyLectures,
  subjects = emptySubjects,
  language = "en",
  catalogStatus = "ready",
  sessionRouteId = null,
  summaryRouteId = null,
  historyOpen = false,
  historyDetailId = null,
  onRefreshLectures = refreshLectures,
  onBackToHome = noOperation,
  onReturnToPlanner = noOperation,
  onOpenSession = noOperation,
  onOpenSummary = noOperation,
  onOpenHistory = noOperation,
  onOpenHistoryDetail = noOperation,
  onReturnToHistory = noOperation,
}: AiryFocusProps) {
  return (
    <main className="airy-focus min-h-[100dvh]">
      <FocusHub
        lectures={lectures}
        subjects={subjects}
        language={language}
        catalogStatus={catalogStatus}
        sessionRouteId={sessionRouteId}
        summaryRouteId={summaryRouteId}
        historyOpen={historyOpen}
        historyDetailId={historyDetailId}
        onRefreshLectures={onRefreshLectures}
        onBackToHome={onBackToHome}
        onReturnToPlanner={onReturnToPlanner}
        onOpenSession={onOpenSession}
        onOpenSummary={onOpenSummary}
        onOpenHistory={onOpenHistory}
        onOpenHistoryDetail={onOpenHistoryDetail}
        onReturnToHistory={onReturnToHistory}
      />
    </main>
  );
}