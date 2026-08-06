# 99's Guide

A full-stack medical study platform for students. Features MCQs, flashcards, lecture videos, a real-time chat via Socket.IO, a Q&A system, leaderboards, a calendar, admin moderation tools, and optional mobile builds via Capacitor (iOS/Android).

## Stack

- **Frontend**: React 19 + Vite + Tailwind CSS v4
- **Backend**: Express (TypeScript, `tsx` for dev)
- **Database**: PostgreSQL via Prisma ORM (Replit's managed DB)
- **Real-time**: Socket.IO
- **Auth**: JWT + bcrypt; optional OAuth (Google, Facebook, GitHub, Apple)
- **Storage**: Local filesystem by default; AWS S3 when credentials are configured
- **Mobile**: Capacitor (iOS/Android) — separate build step

## How to run

```
npm run dev
```

- The `predev` script runs automatically: syncs Prisma schema and generates the client.
- Server starts on **port 5000**.
- Vite middleware is integrated into the Express server (no separate frontend process needed).

## Environment variables

Required:
- `DATABASE_URL` — injected automatically by Replit's managed PostgreSQL
- `JWT_SECRET` — Replit Secret (set)
- `SESSION_SECRET` — Replit Secret (set)
- `ADMIN_INITIAL_PASSWORD` — Replit Secret (set); used to seed the first admin account

Optional (features degrade gracefully without them):
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, `AWS_REGION` — S3 file uploads
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` — email notifications
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` — Facebook OAuth
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth
- `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` — Apple Sign-In

## Database

Replit's built-in PostgreSQL is used. Schema is managed with Prisma; `prisma db push` runs automatically on every `npm run dev` via the predev script.

## Notes

- `prisma/schema.prisma` uses a single `url` field (no `directUrl`) since Replit's DB is a direct connection.
- CORS is open in development; tightened to specific origins in production.
- Seed data (subjects, MCQs, flashcards, videos) is loaded from `src/core/constants/seedData.ts` on first run.

## User preferences
