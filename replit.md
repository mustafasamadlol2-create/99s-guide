# Replit development

- Runtime: Node.js 22.
- Start the app with the configured **Start application** workflow (or the Run button).
- The workflow runs `PORT=5000 DIRECT_URL="$DATABASE_URL" JWT_SECRET="$SESSION_SECRET" PRISMA_DB_PUSH=true npm run dev`.
- Replit provides the development PostgreSQL `DATABASE_URL`; the workflow uses the same connection for Prisma's `DIRECT_URL` and syncs the checked-in schema before startup.
- The existing Replit `SESSION_SECRET` is also supplied as the development `JWT_SECRET`, so sessions survive workflow restarts without storing credentials in project files.
- OAuth, SMTP email, Supabase storage, S3 storage, and Cloudflare D1 mirroring remain optional and are not configured.