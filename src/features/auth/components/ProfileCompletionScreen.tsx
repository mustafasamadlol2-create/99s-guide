import React, { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import AnimatedField from "./AnimatedField";
import AuthBackground from "./AuthBackground";
import AppLogo from "../../../components/ui/AppLogo";
import { SignaturePad } from "../../../components/ui/SignaturePad";
import InteractiveAvatar from "../../profile/components/InteractiveAvatar";
import { AuthSpinner, AuthErrorMessage } from "../ui";
import { CARD_V, LOGO_V, STAGGER_V, FIELD_V } from "../motionConfig";

export default function ProfileCompletionScreen({
  user,
  onComplete,
}: {
  user: any;
  onComplete: (data: { name: string; studentGroup: string; signature: string | null; avatar?: string }) => Promise<void>;
}) {
  const reduce = !!useReducedMotion();
  const [name, setName] = useState(user?.name || "");
  const [studentGroup, setStudentGroup] = useState(user?.studentGroup || "A");
  const [signature, setSignature] = useState<string | null>(user?.signature || null);
  const [avatar, setAvatar] = useState<string>(user?.avatarUrl || user?.avatar || "");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!["A", "B", "C", "D"].includes(studentGroup)) {
      setError("Please select your academic group.");
      return;
    }
    if (!signature) {
      setError("Please add and save your digital signature.");
      return;
    }

    setError("");
    setIsLoading(true);
    try {
      await onComplete({
        name: name.trim(),
        studentGroup,
        signature,
        avatar: avatar || undefined,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to save profile. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#F8F9FC] dark:bg-[#1C1C1E] ios-scrollable"
    >
      <div
        className="relative min-h-[100dvh] w-full flex flex-col justify-start items-center px-4 sm:px-6 md:px-8 auth-scroll-column"
        style={{ zIndex: 1, paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}
      >
        <AuthBackground />
        <div className="flex-grow shrink-0 min-h-[20px] max-h-[8vh]" />

        <div className="w-full max-w-[400px] sm:max-w-[440px] md:max-w-[540px] lg:max-w-[620px] pb-8 shrink-0 flex flex-col items-center">
          <motion.div
            layout={!reduce}
            layoutRoot
            variants={reduce ? undefined : CARD_V}
            initial={reduce ? false : "hidden"}
            animate="visible"
            className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E4E4E7] dark:border-[#333333] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.10)] dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.35)] rounded-[32px] sm:rounded-[36px] md:rounded-[40px] px-5 sm:px-7 md:px-9 lg:px-11 pb-10 sm:pb-12 md:pb-14 overflow-hidden"
          >
            <motion.div variants={reduce ? undefined : LOGO_V} className="pt-8 sm:pt-10 flex justify-center pb-5 sm:pb-6">
              <AppLogo size="xl" />
            </motion.div>

            <motion.div variants={reduce ? undefined : LOGO_V} className="text-center px-2 pb-6 sm:pb-8">
              <h1 className="text-xl sm:text-2xl md:text-[28px] font-bold text-med-dark dark:text-white tracking-tight mb-2 sm:mb-3">
                Complete Your Profile
              </h1>
              <p className="text-[13px] sm:text-[14.5px] md:text-[15px] text-secondary-label dark:text-[#EBEBF599] leading-relaxed">
                Welcome to 99&apos;s Guide. Please verify your details and upload a photo.
              </p>
            </motion.div>

            <AuthErrorMessage error={error} shakeKey={error ? 1 : 0} />

            <motion.form onSubmit={handleSubmit}>
              <motion.div
                variants={reduce ? undefined : STAGGER_V}
                initial={reduce ? false : "hidden"}
                animate="visible"
                className="space-y-4 md:space-y-5"
              >
                <motion.div variants={FIELD_V as any} className="flex flex-col items-center justify-center pb-2">
                  <InteractiveAvatar
                    avatarUrl={avatar}
                    name={name || "User"}
                    onAvatarChange={setAvatar}
                    isEditable
                  />
                  <p className="text-[11px] font-medium text-med-muted dark:text-[#EBEBF560] mt-3 uppercase tracking-wider">
                    Profile Picture
                  </p>
                </motion.div>

                <AnimatedField
                  label="Full Name"
                  id="profile-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  icon={null}
                />

                <motion.div variants={FIELD_V as any} className="relative z-20">
                  <div className="relative rounded-xl border border-[#E4E4E7] dark:border-[#333333] bg-white/50 dark:bg-black/50 p-3.5 flex flex-col gap-1">
                    <label htmlFor="profile-group" className="text-[10px] font-semibold uppercase tracking-wider text-med-muted dark:text-[#EBEBF560]">
                      Academic Group
                    </label>
                    <select
                      id="profile-group"
                      value={studentGroup}
                      onChange={(e) => setStudentGroup(e.target.value)}
                      className="w-full bg-transparent text-[15px] sm:text-[16px] text-med-dark dark:text-white font-medium appearance-none outline-none cursor-pointer pr-8"
                    >
                      <option value="A" className="text-med-dark bg-white dark:bg-neutral-900">Group A</option>
                      <option value="B" className="text-med-dark bg-white dark:bg-neutral-900">Group B</option>
                      <option value="C" className="text-med-dark bg-white dark:bg-neutral-900">Group C</option>
                      <option value="D" className="text-med-dark bg-white dark:bg-neutral-900">Group D</option>
                    </select>
                    <div className="absolute right-4 top-1/2 pointer-events-none mt-[2px]">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" className="stroke-med-muted dark:stroke-[#EBEBF560]">
                        <path d="M1 1.5L6 6.5L11 1.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                </motion.div>

                <motion.div variants={FIELD_V as any} className="relative">
                  <div className="relative rounded-xl border border-[#E4E4E7] dark:border-[#333333] bg-white/50 dark:bg-black/50 p-4">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-med-muted dark:text-[#EBEBF560] mb-3">
                      Digital Signature
                    </label>
                    {signature ? (
                      <div className="flex flex-col items-center">
                        <img
                          src={signature}
                          alt="Signature"
                          className="h-24 sm:h-32 object-contain bg-white dark:bg-neutral-800 rounded-xl p-2 border border-neutral-200 dark:border-neutral-700"
                        />
                        <button
                          type="button"
                          onClick={() => setSignature(null)}
                          className="mt-3 text-sm font-medium text-blue-500 hover:underline"
                        >
                          Redraw Signature
                        </button>
                      </div>
                    ) : (
                      <SignaturePad onSave={setSignature} hideCancel />
                    )}
                  </div>
                </motion.div>

                <motion.div variants={FIELD_V as any} className="pt-2 sm:pt-3 pb-1">
                  <motion.button
                    type="submit"
                    disabled={isLoading || !signature}
                    whileHover={reduce || isLoading || !signature ? {} : { scale: 1.015 }}
                    whileTap={reduce || isLoading || !signature ? {} : { scale: 0.985 }}
                    className="relative w-full h-[52px] sm:h-[56px] bg-[#1C1C1E] dark:bg-amber-400 text-white dark:text-[#000000] font-semibold text-[15.5px] sm:text-[16.5px] rounded-xl flex items-center justify-center overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed group transition-shadow duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_16px_rgba(0,0,0,0.15)] dark:shadow-none"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <AuthSpinner size="md" className="text-current" /> Completing Registration...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        Complete Registration <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    )}
                  </motion.button>
                </motion.div>
              </motion.div>
            </motion.form>
          </motion.div>
        </div>
        <div className="flex-grow shrink-[2] min-h-[20px]" />
      </div>
    </motion.div>
  );
}
