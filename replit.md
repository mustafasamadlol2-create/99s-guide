# med99guide

A full-stack Progressive Web App (PWA) for medical education — lectures, flashcards, MCQs, Q&A, and progress tracking — built with React + Express + Prisma + TypeScript.

## Stack

- **Frontend**: React 19, Vite, Tailwind CSS 4, Lucide icons, Motion
- **Backend**: Express 4 (TypeScript), Socket.IO, Prisma 5 (PostgreSQL)
- **Auth**: JWT + session cookies; OAuth providers (Google, GitHub, Facebook, Apple) are optional
- **Storage**: Local filesystem by default; AWS S3 when credentials are configured
- **Email**: Nodemailer (SMTP); optional — app runs without it
- **Mobile**: Capacitor configured for iOS / Android wrapping

## How to run

```
npm run dev
```

- The `predev` script runs automatically before `dev`: it loads `.env`, runs `prisma db push` (syncs schema to the database), and auto-generates `JWT_SECRET` / `SESSION_SECRET` if missing.
- Server starts on **port 5000** (Express + Vite middleware combined in development).
- In production (`npm run build && npm start`), Vite builds to `dist/` and Express serves it statically.

## Environment variables

Required to run:
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs auth tokens (auto-generated if absent) |
| `SESSION_SECRET` | Signs session cookies (auto-generated if absent) |

Optional (features degrade gracefully when absent):
| Variable | Purpose |
|---|---|
| `DIRECT_URL` | Prisma direct connection (falls back to `DATABASE_URL`) |
| `SMTP_*` | Email notifications |
| `AWS_*` | S3 file uploads (falls back to local storage) |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth |
| `GITHUB_CLIENT_ID/SECRET` | GitHub OAuth |
| `FACEBOOK_CLIENT_ID/SECRET` | Facebook OAuth |
| `APPLE_*` | Apple OAuth |
| `ADMIN_INITIAL_PASSWORD` | Seeds the first admin account |
| `VITE_API_BASE_URL` | Override API base URL in the frontend |

## Database

Prisma schema is in `prisma/schema.prisma`. Uses Replit's built-in PostgreSQL (or any PostgreSQL URL in `DATABASE_URL`). Schema is automatically pushed on each `npm run dev` start via the predev script.

## User preferences

- Keep the project's existing Express + Vite combined-server structure.
- Do not restructure or migrate the stack unless explicitly requested.
