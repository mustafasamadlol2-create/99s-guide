import "./_group.css";
import { FocusHub } from "./src/features/focus/components/FocusHub";
import type { DatabaseLecture, Subject } from "./src/core/types";

const lectures: DatabaseLecture[] = [
  {
    id: "b98f08e1-b9a2-4f75-9b7c-33e7eaa32f61",
    name: "Bacterial Cell Structure",
    mainSubject: "ID",
    subSubject: "Bacteriology",
    trackMode: "core",
  },
  {
    id: "74b25893-8ed7-4c34-8ccf-85244ebff118",
    name: "Nutritional Assessment",
    mainSubject: "NT",
    subSubject: "Clinical Nutrition",
    trackMode: "core",
  },
];

const subjects: Subject[] = [
  {
    id: "ID",
    name: "Infectious Diseases",
    nameAr: "الأمراض المعدية",
    icon: "book-open",
    color: "#315f75",
    description: "",
    modules: [],
  },
  {
    id: "NT",
    name: "Nutrition",
    nameAr: "التغذية",
    icon: "book-open",
    color: "#315f75",
    description: "",
    modules: [],
  },
];

const noOperation = () => {};
const refreshLectures = async () => {};

export function Current() {
  return (
    <main className="focus-hub-current-root min-h-screen">
      <FocusHub
        lectures={lectures}
        subjects={subjects}
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