/**
 * CommunityGuidelines — shown once before a user's first Q&A interaction.
 * Acceptance stored in localStorage. Never shown again after "I Agree".
 */
import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, Users, MessageSquare, AlertTriangle, Eye, BookOpen } from "lucide-react";

interface CommunityGuidelinesProps {
  open: boolean;
  onAgree: () => void;
}

const GUIDELINES = [
  { Icon: Users,         text: "Respect other students — be kind and constructive." },
  { Icon: BookOpen,      text: "Stay on topic — keep discussions relevant to the lecture." },
  { Icon: AlertTriangle, text: "No offensive language, insults, or personal attacks." },
  { Icon: MessageSquare, text: "No spam or repetitive posting." },
  { Icon: Eye,           text: "Do not share personal information." },
  { Icon: ShieldCheck,   text: "Reports are reviewed by moderators. False reports may result in a ban." },
];

export const CommunityGuidelines: React.FC<CommunityGuidelinesProps> = ({ open, onAgree }) => (
  <AnimatePresence>
    {open && (
      <>
        {/* Backdrop */}
        <motion.div
          key="guidelines-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 backdrop-blur-sm"
        />

        {/* Modal */}
        <motion.div
          key="guidelines-modal"
          initial={{ opacity: 0, scale: 0.95, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 24 }}
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
          className="mobile-overlay-top fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-elevation-3 overflow-hidden border border-neutral-200/40 dark:border-white/[0.08]">
            {/* Header */}
            <div className="bg-gradient-to-br from-med-blue/10 to-indigo-500/5 dark:from-blue-900/20 dark:to-indigo-900/10 px-6 py-5 border-b border-neutral-100 dark:border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-med-blue/10 dark:bg-blue-500/20 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-med-blue dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-[17px] font-semibold text-neutral-900 dark:text-white tracking-tight">
                    Community Guidelines
                  </h2>
                  <p className="text-[13px] text-neutral-500 dark:text-[#EBEBF599] mt-0.5">
                    Please read before participating
                  </p>
                </div>
              </div>
            </div>

            {/* Guidelines list */}
            <div className="px-6 py-4 space-y-3">
              {GUIDELINES.map(({ Icon, text }, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-neutral-600 dark:text-[#EBEBF599]" />
                  </div>
                  <p className="text-[14px] text-neutral-700 dark:text-[#EBEBF5CC] leading-snug">
                    {text}
                  </p>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 pt-2">
              <button
                type="button"
                onClick={onAgree}
                className="w-full py-3.5 rounded-xl bg-med-blue text-white font-semibold text-[15px] hover:bg-blue-700 active:scale-[0.98] transition-all duration-150 shadow-sm cursor-pointer"
              >
                I Agree — Enter the Forum
              </button>
            </div>
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export default CommunityGuidelines;
