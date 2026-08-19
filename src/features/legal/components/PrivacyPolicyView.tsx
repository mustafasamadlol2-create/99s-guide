import React, { memo } from "react";
import { ChevronLeft, ShieldCheck } from "lucide-react";

interface PrivacyPolicyViewProps {
  onBack: () => void;
}

const PrivacyPolicyView = ({ onBack }: PrivacyPolicyViewProps) => {
  return (
    <div className="legal-page-scroll h-full w-full bg-[#F8F9FC] dark:bg-[#000000] overflow-y-auto">
      {/* Header */}
      <div className="legal-page-header sticky top-0 z-40 bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-md border-b border-black/5 dark:border-white/[0.12] px-4 py-3 flex items-center shadow-sm">
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

      <div className="legal-page-content max-w-2xl mx-auto px-4 py-6 space-y-8 text-neutral-800 dark:text-neutral-200">
        <section className="bg-white dark:bg-[#1C1C1E] p-6 rounded-xl border border-neutral-200/50 dark:border-white/10 shadow-sm space-y-4 text-sm leading-relaxed">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
            Last Updated: August 2026
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Data Collection</h2>
          <p>
            We collect only the data required to provide our educational services: your full name, email address, academic group (A–D), and the account information you provide. To power your personal dashboard we also store study activity such as lecture progress, quiz scores, flashcard reviews, academic points, streaks, study time, and calendar events you create, along with any questions, answers, or votes you post in the study community. This data is used exclusively for the educational features of the application and is never sold or shared with third-party marketers.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Authentication & Sign-In</h2>
          <p>
            Access is restricted to Baghdad University Medical College students and to accounts explicitly approved by the operator (for example, app store review accounts). When you sign in with Google, we receive only the basic profile information you authorize (name, email, and avatar). We never receive or store your Google password, and we strictly follow Google OAuth requirements. Passwords created within the app are encrypted with a strong one-way hash before storage.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Stored Data & Uploaded Files</h2>
          <p>
            Academic materials shared on the platform are stored securely and are used only to deliver the educational content of the application. You retain ownership of the content you post, and we do not use it for unauthorized external purposes or data brokering.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Cookies and Sessions</h2>
          <p>
            We use an essential, secure (httpOnly) session cookie to keep you signed in and a small number of local-storage keys to save your preferences and cached content. We do not use third-party tracking cookies or advertising identifiers.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Offline Storage</h2>
          <p>
            To support offline study, the app may store lecture content, subject catalogs, and your progress locally on your device (IndexedDB and local storage). On iOS native builds, authentication tokens are stored in the platform's secure storage (Keychain-backed). This data stays on your device and is cleared when you delete the app or your account.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Push Notifications</h2>
          <p>
            With your permission, we collect a device push token so we can deliver notifications you opt into. Notification settings can be changed at any time from the Settings screen, and tokens are removed when you delete your account.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Hosting & Third-Party Services</h2>
          <p>
            The application backend and database are hosted by a commercial cloud provider (Render, including a PostgreSQL database) in the United States. We rely on the following third parties solely to operate the service: Google for sign-in, YouTube for embedded lecture videos, and an email service for account verification and password recovery. Each provider receives only the minimum data needed for its function.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Security</h2>
          <p>
            We apply industry-standard measures to protect your information, including HTTPS transport, hashed passwords, rate-limiting on authentication endpoints, input validation, and an institutional email access gate. No system is completely secure, but we work to keep your data safe against unauthorized access, alteration, or destruction.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">Data Retention & Account Deletion</h2>
          <p>
            We retain your data for as long as your account is active. You have the right to fully erase your data at any time: from the Settings screen, open the "Danger Zone", type DELETE, and confirm. This permanently removes your account and associated records from the server and clears locally stored data on your device.
          </p>

          <h2 className="text-xl font-bold text-neutral-900 dark:text-white pt-2">User Rights & Contact</h2>
          <p>
            You have the right to access, rectify, or erase your personal data at any time. For privacy-related inquiries, please contact our data protection officer at mostafa.samad24001@comed.uobaghdad.edu.iq.
          </p>
        </section>
      </div>
    </div>
  );
};

export default memo(PrivacyPolicyView);
