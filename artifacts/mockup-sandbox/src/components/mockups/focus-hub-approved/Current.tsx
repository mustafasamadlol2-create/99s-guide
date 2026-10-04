import "./_group.css";
import { useEffect, useState } from "react";
import { FocusHub } from "./src/features/focus/components/FocusHub";
import type { DatabaseLecture, Subject } from "./src/core/types";

const lectures: DatabaseLecture[] = [
  {
    id: "b98f08e1-b9a2-4f75-9b7c-33e7eaa32f61",
    name: "PHC.TBL",
    mainSubject: "PHC",
    subSubject: "Public Health Care",
    trackMode: "core",
  },
  {
    id: "74b25893-8ed7-4c34-8ccf-85244ebff118",
    name: "Practical Mycology",
    mainSubject: "ID",
    subSubject: "Infectious Diseases",
    trackMode: "core",
  },
];

const subjects: Subject[] = [
  {
    id: "ID",
    name: "Infectious Diseases",
    nameAr: "الأمراض المعدية",
    icon: "book-open",
    color: "#487da6",
    description: "",
    modules: [],
  },
  {
    id: "PHC",
    name: "Public Health Care",
    nameAr: "الرعاية الصحية العامة",
    icon: "book-open",
    color: "#487da6",
    description: "",
    modules: [],
  },
];

const noOperation = () => {};
const refreshLectures = async () => {};

export function Current() {
  const [dark, setDark] = useState(false);
  const [language, setLanguage] = useState<"en" | "ar">("en");
  const [historyView, setHistoryView] = useState(false);
  const [useViewportShell, setUseViewportShell] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDark(params.get("theme") === "dark");
    setLanguage(params.get("lang") === "ar" ? "ar" : "en");
    setHistoryView(params.get("view") === "history");
    const updateViewportShell = () => {
      setUseViewportShell(window.matchMedia("(min-width: 768px)").matches);
    };
    updateViewportShell();
    window.addEventListener("resize", updateViewportShell);
    return () => window.removeEventListener("resize", updateViewportShell);
  }, []);

  return (
    <main className={`min-h-[100dvh] ${dark ? "dark" : ""}`}>
      <div
        id={useViewportShell ? "main-scroll-canvas" : undefined}
        className="focus-planner-viewport"
      >
        <div className="focus-hub-current-root min-h-[100dvh]">
          <FocusHub
            lectures={lectures}
            subjects={subjects}
            language={language}
            catalogStatus="ready"
            sessionRouteId={null}
            summaryRouteId={null}
            historyOpen={historyView}
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
        </div>
      </div>
    </main>
  );
}