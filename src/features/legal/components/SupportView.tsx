import React, { memo } from "react";
import { ChevronLeft, LifeBuoy } from "lucide-react";

interface SupportViewProps {
  onBack: () => void;
}

const SupportView = ({ onBack }: SupportViewProps) => {
  return (
    <div className="h-full w-full bg-[#F8F9FC] dark:bg-[#000000] overflow-y-auto pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-md border-b border-black/5 dark:border-white/[0.12] px-4 py-3 flex items-center shadow-sm">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors text-neutral-600 dark:text-neutral-300"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-white ml-2 flex items-center gap-2">
          <LifeBuoy className="w-5 h-5 text-indigo-500" />
          Support & Help Center
        </h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8 text-neutral-800 dark:text-neutral-200">
        <section className="bg-white dark:bg-[#1C1C1E] p-6 rounded-xl border border-neutral-200/50 dark:border-white/10 shadow-sm space-y-4 text-sm leading-relaxed">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
            Last Updated: August 2026
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Contact Support</h2>
          <p>
            If you need help, please email our support team at <a href="mailto:mostafa.samad24001@comed.uobaghdad.edu.iq" className="text-indigo-500 hover:underline">mostafa.samad24001@comed.uobaghdad.edu.iq</a>.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Frequently Asked Questions</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>How do I reset my password?</strong> You can request a password reset from the login screen.</li>
            <li><strong>Is my progress saved offline?</strong> Progress syncs automatically when you regain internet connectivity.</li>
            <li><strong>Can I change my academic group?</strong> Yes, you can update your profile information in the Profile tab.</li>
          </ul>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Account Assistance & Deletion</h2>
          <p>
            If you wish to terminate your account, account deletion is available directly from the Settings page. This will permanently erase your academic data and personal information in accordance with App Store guidelines.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">How to Report Bugs</h2>
          <p>
            Encountered a technical issue? Send an email to our support address with your device model, browser, and a description of the bug. Screenshots are highly appreciated.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Response Time</h2>
          <p>
            Our technical support team aims to respond to all inquiries within 48-72 business hours.
          </p>
        </section>
      </div>
    </div>
  );
};

export default memo(SupportView);
