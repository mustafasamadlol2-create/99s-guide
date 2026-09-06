import React, { memo } from "react";
import { useReliableLegalScroll } from "../useReliableLegalScroll";
import { ChevronLeft, AlertTriangle } from "lucide-react";

interface MedicalDisclaimerViewProps {
  onBack: () => void;
}

const MedicalDisclaimerView = ({ onBack }: MedicalDisclaimerViewProps) => {
  const scrollRef = useReliableLegalScroll();

  return (
    <div
      ref={scrollRef}
      className="legal-page-scroll h-full w-full bg-[#F8F9FC] dark:bg-[#000000] overflow-y-auto"
      style={{ WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain", touchAction: "pan-y" }}
    >
      {/* Header */}
      <div className="legal-page-header sticky top-0 z-40 bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-md border-b border-black/5 dark:border-white/[0.12] px-4 py-3 flex items-center shadow-sm">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors text-neutral-600 dark:text-neutral-300"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-white ml-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-indigo-500" />
          Medical Disclaimer
        </h1>
      </div>

      <div className="legal-page-content max-w-2xl mx-auto px-4 py-6 space-y-8 text-neutral-800 dark:text-neutral-200">
        <section className="bg-white dark:bg-[#1C1C1E] p-6 rounded-xl border border-neutral-200/50 dark:border-white/10 shadow-sm space-y-4 text-sm leading-relaxed">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
            Last Updated: August 2026
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Educational Purposes Only</h2>
          <p>
            This application is intended solely for educational and academic purposes. The materials, flashcards, notes, and progress trackers provided within are designed to assist medical students in their academic studies.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Not Medical Advice</h2>
          <p>
            The content within this application does not constitute professional medical advice, diagnosis, or treatment. It must never be used as a substitute for professional medical judgment.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Not a Replacement for Physicians</h2>
          <p>
            This software is not a replacement for consultation with qualified healthcare professionals or physicians. Patients should always seek the advice of a physician regarding a medical condition.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">User Responsibility</h2>
          <p>
            Users of this application remain solely and entirely responsible for any clinical decisions or actions they take. The creators, developers, and maintainers of 99's Guide accept no liability for any clinical outcomes or medical decisions made by users.
          </p>
        </section>
      </div>
    </div>
  );
};

export default memo(MedicalDisclaimerView);
