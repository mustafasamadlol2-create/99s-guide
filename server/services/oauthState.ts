export type OAuthFlowMode = "popup" | "redirect" | "inapp";

export interface ParsedOAuthState {
  token: string;
  mode: OAuthFlowMode;
}

const PKCE_CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function isValidPkceCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && PKCE_CODE_CHALLENGE_PATTERN.test(value);
}

/** Parse the small flow marker carried through the provider state value. */
export function parseOAuthState(rawState: unknown): ParsedOAuthState | null {
  if (typeof rawState !== "string" || !rawState) return null;

  if (rawState.startsWith("r:")) {
    return rawState.length > 2 ? { token: rawState.slice(2), mode: "redirect" } : null;
  }
  if (rawState.startsWith("i:")) {
    return rawState.length > 2 ? { token: rawState.slice(2), mode: "inapp" } : null;
  }
  return { token: rawState, mode: "popup" };
}

/**
 * A callback is bound either by the same-site state cookie or by the PKCE
 * handoff challenge that the client must prove before receiving a JWT.
 */
export function isOAuthStateBound(
  token: string,
  cookieToken: unknown,
  codeChallenge?: string,
): boolean {
  return cookieToken === token || Boolean(codeChallenge);
}

export function buildOAuthPendingQuery(token: string): string {
  return `oauth_pending=1&oauth_state=${encodeURIComponent(token)}`;
}
