/**
 * Classic 99 semantic token metadata.
 *
 * CSS is the only source of actual render values. This module deliberately
 * contains names, categories, and implementation metadata only so a future
 * theme engine cannot drift from the stylesheet by maintaining a second
 * palette in TypeScript.
 */

export const IMPLEMENTED_THEME_IDS = ["classic-99", "ocean"] as const;
export type ImplementedThemeId = (typeof IMPLEMENTED_THEME_IDS)[number];

export const THEMEABLE_TOKEN_NAMES = [
  "semantic-background-page",
  "semantic-background-grouped",
  "semantic-surface-primary",
  "semantic-surface-elevated",
  "semantic-surface-muted",
  "semantic-content-primary",
  "semantic-content-secondary",
  "semantic-content-subtle",
  "semantic-border-default",
  "semantic-border-strong",
  "semantic-action-accent",
  "semantic-action-accent-soft",
  "semantic-focus-ring",
  "semantic-navigation-active-background",
  "semantic-navigation-active-foreground",
  "semantic-glass-surface",
  "semantic-glass-border",
  "semantic-shadow-generic",
  "semantic-hero-background",
  "semantic-hero-glow-primary",
  "semantic-hero-glow-secondary",
  "semantic-chrome-content-primary",
  "semantic-chrome-content-secondary",
  "semantic-chrome-content-subtle",
  "semantic-chrome-content-muted",
  "semantic-chrome-surface-active",
  "semantic-chrome-surface-hover",
  "semantic-navigation-tab-active",
  "semantic-navigation-tab-inactive",
] as const;

export type ThemeableTokenName = (typeof THEMEABLE_TOKEN_NAMES)[number];

/**
 * These roles are intentionally outside the appearance token list. They
 * retain status/domain meaning and must not be derived from a future theme
 * accent.
 */
export const FIXED_SEMANTIC_TOKEN_NAMES = [
  "status-error",
  "status-success",
  "status-warning",
  "status-offline",
  "status-online",
  "action-destructive",
  "validation-error",
] as const;

export type FixedSemanticTokenName =
  (typeof FIXED_SEMANTIC_TOKEN_NAMES)[number];