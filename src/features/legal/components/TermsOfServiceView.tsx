import React, { memo } from "react";
import { ChevronLeft, FileText } from "lucide-react";

interface TermsOfServiceViewProps {
  onBack: () => void;
}

const TermsOfServiceView = ({ onBack }: TermsOfServiceViewProps) => {
  return (
    <div className="h-full w-full bg-[#F8F9FC] dark:bg-[#000000] overflow-y-auto pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-md border-b border-black/5 dark:border-white/[0.12] px-4 py-3 flex items-center shadow-sm">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors text-neutral-600 dark:text-neutral-300"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-white ml-2 flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-500" />
          Terms of Service
        </h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8 text-neutral-800 dark:text-neutral-200">
        <section className="bg-white dark:bg-[#1C1C1E] p-6 rounded-xl border border-neutral-200/50 dark:border-white/10 shadow-sm space-y-4 text-sm leading-relaxed">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
            Last Updated: August 2026
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Acceptance of Terms</h2>
          <p>
            By accessing or using 99's Guide, you agree to be bound by these Terms of Service. If you do not agree, you must cease use of the application immediately.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Educational Purpose</h2>
          <p>
            This application is built strictly for academic and educational purposes. It is a study tool designed for students to organize, review, and learn academic materials.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">User Responsibilities & Account Usage</h2>
          <p>
            You are responsible for maintaining the confidentiality of your account credentials. You agree to use the service legally and not to distribute malicious content, violate copyrights, or harass other users.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Prohibited Activities</h2>
          <p>
            Reverse-engineering, scraping data, attempting unauthorized access to the application's infrastructure, or distributing illegal or offensive materials is strictly prohibited and will result in immediate termination of your account.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Intellectual Property</h2>
          <p>
            All original platform designs, software architecture, and source code are the intellectual property of 99's Guide. Content uploaded by users remains the intellectual property of its respective owners.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Medical Education Disclaimer</h2>
          <p>
            Despite containing medical education resources, this platform is not a diagnostic tool. The content within must not be used to treat patients or make clinical decisions.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Limitation of Liability & Service Availability</h2>
          <p>
            We provide the service "as is" without warranty. We are not liable for academic outcomes, lost data, or interruptions to service availability. We reserve the right to modify or discontinue the service at any time.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Changes to Terms & Contact Information</h2>
          <p>
            We may update these terms periodically. Continued use of the application constitutes acceptance of new terms. For any legal inquiries, contact us at legal@99s-guide.com.
          </p>
        </section>
      </div>
    </div>
  );
};

export default memo(TermsOfServiceView);
