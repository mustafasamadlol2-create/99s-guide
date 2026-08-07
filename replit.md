# 99's Guide (med99guide)

A full-stack medical student platform — MCQ bank, flashcards, lecture library, leaderboard, bulletin board, and real-time chat.

## Stack
- **Frontend**: React 19 + Vite 6, Tailwind CSS v4, Lucide icons, Framer Motion
- **Backend**: Express 4 + TypeScript (tsx), Socket.io for real-time features
- **Database**: PostgreSQL via Prisma ORM (Supabase-hosted)
- **Auth**: JWT sessions + Google OAuth (extensible to GitHub, Facebook, Apple)
- **Storage**: Local filesystem (AWS S3 optional)
- **Mobile**: Capacitor 8 (iOS & Android targets)

## Running on Replit

```
npm run dev
```

The `predev` script runs automatically before the server starts. It:
1. Syncs the Prisma schema (`prisma db push`) against `SUPABASE_DATABASE_URL`
2. Starts the Express + Vite dev server on port 5000

## Required Secrets (Replit Secrets)
| Key | Purpose |
|-----|---------|
| `SUPABASE_DATABASE_URL` | PostgreSQL connection string (Supabase pooler URL) |
| `JWT_SECRET` | Signs auth tokens |
| `SESSION_SECRET` | Express session signing |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |

## Optional Secrets
| Key | Purpose |
|-----|---------|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 file storage |
| `AWS_S3_BUCKET_NAME` / `AWS_REGION` | S3 bucket config |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_PORT` / `SMTP_FROM` | Email (password reset, notifications) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` | Facebook OAuth |

## Key directories
- `src/` — React frontend (features, components, core constants/seed data)
- `server/` — Express routes, services, middleware
- `server.ts` — Main server entry point
- `prisma/schema.prisma` — Database schema
- `scripts/predev.cjs` — First-run setup & Prisma sync

## User Preferences
- Keep existing project structure and stack; do not migrate or restructure unless explicitly asked.
