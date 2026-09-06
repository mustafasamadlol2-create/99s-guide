/**
 * AuthSpinner — accessible CSS-animated loading indicator.
 *
 * Always aria-hidden because it lives inside elements that carry their
 * own aria-busy / aria-label / role="status" context.
 */

export type SpinnerSize = "xs" | "sm" | "md" | "lg";

const SIZE_MAP: Record<SpinnerSize, string> = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

interface AuthSpinnerProps {
  size?:      SpinnerSize;
  className?: string;
}

export function AuthSpinner({ size = "sm", className = "" }: AuthSpinnerProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`animate-spin text-current shrink-0 ${SIZE_MAP[size]} ${className}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12" cy="12" r="10"
        stroke="currentColor" strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
