# Prompt 7 legacy planner removal map

This map records the verified calendar paths before the Prompt 7 changes.

## Academic Schedule path

- Student read: `GET /api/calendar/events` in `server.ts`, then `fetchCalendarEvents` in `src/App.tsx`, then `CalendarView`.
- Admin/owner write: `ManageCalendar` and `CalendarScheduleImporter` in the Control Center call the academic calendar REST routes in `server.ts`.
- Authorization: academic `POST`, `PUT`, and `DELETE /api/calendar/events` use the existing `requireAdmin` middleware.
- Realtime: `calendar_updated` is emitted by academic mutations and reconciled by the socket listener in `src/App.tsx`.

## Legacy personal planner paths

- Creation: `useCalendar.handleCreateTaskSubmit` created `task_*` events with `isPublic: false`; `CalendarView` passed the callback into the day view; `App.handleAddNewEvent` persisted or queued them.
- Local persistence/hydration: `calendar_events` and the account-scoped calendar cache were read by `App` and `OfflineEngine`.
- Full sync: `/api/auth/sync` accepted `calendarEvents` and upserted user-owned PostgreSQL `CalendarEvent` rows.
- User service: `UserService.getCalendarEvents` read personal PostgreSQL/private-D1 rows and `getFullUserData` returned them as `calendarEvents`; save/delete helpers were legacy-only.
- Offline: `OfflineEngine` generated and replayed `ADD_EVENT`/`DELETE_EVENT` mutations.
- Private D1: `UserCalendarEvent` Worker schema, read handler, and mirror drain support remain for compatibility with existing rows/outbox entries.

## Prompt 7 boundaries

- Keep `CalendarEvent.userId`, existing PostgreSQL/D1 rows, schemas, migrations, academic import, target-group filtering, notifications, socket events, and all Study Engine projections unchanged.
- Stop new personal writes, personal reads/hydration, personal UI callbacks, and old queued personal mutation replay.