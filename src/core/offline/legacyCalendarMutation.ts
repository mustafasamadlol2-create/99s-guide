export type LegacyCalendarMutation = {
  type: string;
  payload: any;
};

/** Classifies only the retired personal-planner queue shapes. */
export function isLegacyPersonalCalendarMutation(
  mutation: LegacyCalendarMutation,
): boolean {
  if (mutation.type === "DELETE_EVENT") {
    const eventId = typeof mutation.payload === "string"
      ? mutation.payload
      : mutation.payload?.id;
    return (typeof eventId === "string" && eventId.startsWith("task_")) ||
      mutation.payload?.userId != null ||
      mutation.payload?.isPublic === false;
  }

  if (mutation.type !== "ADD_EVENT") return false;
  const payload = mutation.payload || {};
  return payload.isPublic === false ||
    payload.userId != null ||
    String(payload.id || "").startsWith("task_") ||
    (payload.eventType == null && (payload.date != null || payload.time != null)) ||
    ["PERSONAL", "TASK", "OTHER"].includes(String(payload.eventType || payload.type || "").toUpperCase());
}