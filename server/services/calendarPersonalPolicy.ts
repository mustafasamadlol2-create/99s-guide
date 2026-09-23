/**
 * Compatibility boundary for the retired user-personal calendar field.
 *
 * Old clients may send arbitrary calendarEvents values during auth sync. The
 * field remains parseable in the response, but no value is accepted for
 * persistence or returned as a user-owned Schedule payload.
 */
export function deprecateLegacyCalendarEvents(_value: unknown): [] {
  return [];
}