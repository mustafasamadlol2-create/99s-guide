# Running 99's Guide on Replit

- The existing app uses React/Vite and an Express API in one Node process. Run the **Start application** workflow (`PORT=5000 npm run dev`) to open the web preview.
- Use Node.js 22. Dependencies are installed with npm; `npm install` also generates the Prisma client.
- Development uses the workspace's PostgreSQL `DATABASE_URL`. The app supplies `DIRECT_URL` from `DATABASE_URL` at runtime. For one-off Prisma commands, use `DIRECT_URL="$DATABASE_URL" npm run migrate:deploy` (or the relevant Prisma command).
- The development database was initialized from the repository's migrations and then synced to the current Prisma schema with `DIRECT_URL="$DATABASE_URL" npx prisma db push`. Do not enable `PRISMA_DB_PUSH` on a shared or production database. The original imported external database, if any, was not connected or copied.
- `JWT_SECRET` is not configured: development generates a temporary signing key, so sessions expire after a server restart. Configure it securely before using persistent sessions. Optional OAuth, SMTP, Supabase Storage, and Cloudflare AI integrations remain unconfigured; those features require their own credentials and services.
- Production setup is different: follow the README's required environment variables and migration procedure; do not use development schema sync against production.