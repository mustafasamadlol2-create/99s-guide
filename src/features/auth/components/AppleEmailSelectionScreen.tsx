import { useState } from "react";

interface AppleEmailSelectionProps {
  userName: string;
  appleEmail: string;
  onSelect: (choice: "apple" | "university", universityEmail?: string) => void;
}

export function AppleEmailSelectionScreen({ userName, appleEmail, onSelect }: AppleEmailSelectionProps) {
  const [choice, setChoice] = useState<"apple" | "university">("apple");
  const [universityEmail, setUniversityEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isRelay = appleEmail.includes("privaterelay");

  const handleSubmit = async () => {
    setError("");
    if (choice === "university") {
      const clean = universityEmail.trim().toLowerCase();
      if (!clean) {
        setError("Please enter your university email.");
        return;
      }
      if (!clean.endsWith("@comed.uobaghdad.edu.iq")) {
        setError("Only @comed.uobaghdad.edu.iq emails are accepted.");
        return;
      }
    }
    setLoading(true);
    try {
      await onSelect(choice, choice === "university" ? universityEmail.trim().toLowerCase() : undefined);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#F8F9FC] dark:bg-[#000000] px-6">
      <div className="w-full max-w-[380px]">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 mx-auto mb-4 flex items-center justify-center">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-[20px] font-semibold text-neutral-900 dark:text-white mb-2">
            Choose your email
          </h1>
          <p className="text-[14px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
            Choose the email you&apos;d like to use with your 99 Guide account.
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3 mb-6">
          {/* Apple email option */}
          <button
            onClick={() => { setChoice("apple"); setError(""); }}
            className={`w-full text-left p-4 rounded-2xl border-2 transition-all duration-200 ${
              choice === "apple"
                ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                choice === "apple" ? "border-amber-500 bg-amber-500" : "border-neutral-300 dark:border-neutral-600"
              }`}>
                {choice === "apple" && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-neutral-900 dark:text-white">
                  Use my Apple email
                </p>
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                  {appleEmail}
                </p>
              </div>
            </div>
          </button>

          {/* University email option */}
          <button
            onClick={() => { setChoice("university"); setError(""); }}
            className={`w-full text-left p-4 rounded-2xl border-2 transition-all duration-200 ${
              choice === "university"
                ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                choice === "university" ? "border-amber-500 bg-amber-500" : "border-neutral-300 dark:border-neutral-600"
              }`}>
                {choice === "university" && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-neutral-900 dark:text-white">
                  Use my university email
                </p>
              </div>
            </div>
            {choice === "university" && (
              <div className="mt-3 ml-8">
                <input
                  type="email"
                  value={universityEmail}
                  onChange={(e) => { setUniversityEmail(e.target.value); setError(""); }}
                  placeholder="yourname@comed.uobaghdad.edu.iq"
                  className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white text-[14px] placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  autoComplete="email"
                />
              </div>
            )}
          </button>
        </div>

        {/* Info note */}
        {isRelay && choice === "apple" && (
          <p className="text-[12px] text-neutral-400 dark:text-neutral-500 text-center mb-4 px-2">
            Apple may provide a private relay address to protect your email. This is normal and expected.
          </p>
        )}

        {/* Error */}
        {error && (
          <p className="text-[13px] text-red-500 text-center mb-4">{error}</p>
        )}

        {/* Continue button */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold text-[15px] transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
        >
          {loading ? "Setting up..." : "Continue"}
        </button>

        {/* Skip for now */}
        <button
          onClick={() => onSelect("apple")}
          className="w-full py-3 text-[13px] text-neutral-500 dark:text-neutral-400 text-center mt-2"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
