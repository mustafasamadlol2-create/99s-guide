import React, { memo } from "react";
import { ChevronLeft, ShieldCheck } from "lucide-react";

interface PrivacyPolicyViewProps {
  onBack: () => void;
}

const PrivacyPolicyView = ({ onBack }: PrivacyPolicyViewProps) => {
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
          <ShieldCheck className="w-5 h-5 text-indigo-500" />
          Privacy Policy
        </h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8 text-neutral-800 dark:text-neutral-200">
        <section className="bg-white dark:bg-[#1C1C1E] p-6 rounded-xl border border-neutral-200/50 dark:border-white/10 shadow-sm space-y-4 text-sm leading-relaxed">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
            Last Updated: August 2026
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Data Collection</h2>
          <p>
            We collect the minimum necessary data to provide our educational services. This includes Account Information such as your name, email address, and academic progress data.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Authentication & Google Sign-In</h2>
          <p>
            When you authenticate using Google Sign-In, we receive only your basic profile information (name, email, and avatar) authorized by Google. We do not have access to your Google password or any other Google services. We strictly comply with Google OAuth requirements.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Stored Data & Uploaded Files</h2>
          <p>
            Any files or academic materials you upload to the platform are stored securely. You maintain full ownership of your data, and we do not use your files for unauthorized external purposes or data brokering.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Cookies and Sessions</h2>
          <p>
            We use essential cookies and local storage tokens strictly to maintain your session, keep you logged in securely, and save your application preferences. We do not use third-party tracking cookies.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Security</h2>
          <p>
            We implement industry-standard encryption, rate-limiting, and secure architectures to protect your information against unauthorized access, alteration, or destruction.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Data Retention & Account Deletion</h2>
          <p>
            We retain your data for as long as your account is active. Users possess the fundamental right to their data. You can completely erase your data and delete your account directly from the application's Settings page ("Danger Zone").
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">User Rights & Contact</h2>
          <p>
            You have the right to access, rectify, or erase your data at any time. For privacy-related inquiries, please contact our data protection officer at mostafa.samad24001@comed.uobaghdad.edu.iq.
          </p>
        </section>
      </div>
    </div>
  );
};

export default memo(PrivacyPolicyView);
