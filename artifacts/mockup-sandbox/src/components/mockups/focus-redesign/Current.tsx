import "./_group.css";
import type { DatabaseLecture, Subject } from "../../../core/types";
import { FocusHub } from "../../../features/focus/components/FocusHub";

const emptyLectures: DatabaseLecture[] = [];
const emptySubjects: Subject[] = [];
const noOperation = () => {};
const refreshLectures = async () => {};

export function Current() {
  return (
    <main className="min-h-screen">
      <FocusHub
        lectures={emptyLectures}
        subjects={emptySubjects}
        language="en"
        catalogStatus="ready"
        sessionRouteId={null}
        summaryRouteId={null}
        historyOpen={false}
        historyDetailId={null}
        onRefreshLectures={refreshLectures}
        onBackToHome={noOperation}
        onReturnToPlanner={noOperation}
        onOpenSession={noOperation}
        onOpenSummary={noOperation}
        onOpenHistory={noOperation}
        onOpenHistoryDetail={noOperation}
        onReturnToHistory={noOperation}
      />
    </main>
  );
}