import type { FocusRuntimeState } from "./types";

/**
 * A previous plan/load response is not permission to resume a finished session.
 * Only the most recent server-confirmed runtime may expose a Resume action.
 */
export function confirmedCurrentFocusSession(
  state: Pick<FocusRuntimeState, "session" | "sessionAuthority">,
): FocusRuntimeState["session"] {
  const session = state.session;
  if (state.sessionAuthority !== "CANONICAL" || !session) return null;
  if (["COMPLETED", "ABANDONED", "EXPIRED"].includes(session.status)) return null;
  return session;
}
