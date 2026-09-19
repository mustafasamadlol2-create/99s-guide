export type PersonalizationHydrationPhase =
  | "signed-out"
  | "loading"
  | "ready"
  | "fallback";

/**
 * Loading may preserve the document only when the document was most recently
 * owned by the same active account. A new account must cross the default
 * boundary before its cache is allowed to hydrate.
 */
export function shouldPreservePersonalizationDuringHydration(
  previousOwnerUserId: string | null,
  activeUserId: string | null,
  hydrationPhase: PersonalizationHydrationPhase,
): boolean {
  return (
    hydrationPhase === "loading" &&
    activeUserId !== null &&
    previousOwnerUserId === activeUserId
  );
}