/**
 * AuthLabel — typography component for form section labels,
 * captions, and muted helper text in auth screens.
 *
 * Variants
 *   section  — UPPERCASE, semibold, muted  (e.g. "Academic Group")
 *   caption  — small, muted                (e.g. helper text)
 *   muted    — secondary-label colour      (e.g. subtitles)
 *
 * Polymorphic: use the `as` prop to render any element
 * (default "label" for form labels, "p" for paragraphs, etc.)
 */

import React from "react";

export type AuthLabelVariant = "section" | "caption" | "muted";

type Tag = React.ElementType;

interface AuthLabelProps {
  as?:        Tag;
  variant?:   AuthLabelVariant;
  children:   React.ReactNode;
  className?: string;
  [key: string]: unknown;
}

const VARIANT_CLASSES: Record<AuthLabelVariant, string> = {
  section: "block text-subhead font-semibold uppercase tracking-wide mb-1.5 text-med-muted dark:text-white/60",
  caption: "text-caption text-med-muted dark:text-white/45",
  muted:   "text-secondary-label dark:text-[#EBEBF599] font-medium",
};

export function AuthLabel({
  as: Tag = "label",
  variant   = "section",
  children,
  className = "",
  ...rest
}: AuthLabelProps) {
  return (
    <Tag
      className={`${VARIANT_CLASSES[variant]} ${className}`}
      {...(rest as any)}
    >
      {children}
    </Tag>
  );
}
