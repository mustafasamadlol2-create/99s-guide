---
name: Safari hidden-tab animation rule
description: Why entrance animations must never gate visibility in this app's display:none tab architecture
---
# Safari hidden-tab animation rule

Tab pages in this app stay mounted and are hidden with inline `display:none` (App.tsx tab wrappers). Safari/iPadOS cancels CSS animations inside `display:none` subtrees and often fails to restart them (or re-apply a `forwards` fill) when the subtree is shown again.

**Rule:** never make an element's resting visibility depend on a one-shot CSS animation. Base state must be visible (opacity 1); animate FROM hidden using `animation-fill-mode: backwards` so the 0% keyframe covers any stagger delay. If the animation is cancelled or never re-runs, the element safely rests visible.

**Why:** Aug 2026 bug — dashboard cards (`.ios-staggered-card`, base `opacity:0` + `forwards`) went permanently invisible after navigating away and back on iPad; a resize forced style recalc and "magically" restored them.

**How to apply:** when adding entrance/stagger animations to anything rendered inside the tab shell, use visible base + `backwards` fill; audit any `opacity:0` base + `forwards` pattern. Related viewport lessons: children of the fixed 100dvh `#root` must use `h-full`, never `100svh`; LaunchScreen centers via `visualViewport` offsets.
