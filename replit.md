# Running 99's Guide on Replit

- The existing app uses React/Vite and an Express API in one Node process. Run the **Start application** workflow (`PORT=5000 npm run dev`) to open the web preview.
- Use Node.js 22. Dependencies are installed with npm; `npm install` also generates the Prisma client.
- Development uses `SUPABASE_DATABASE_URL` when configured; it takes priority over the Replit-provided `DATABASE_URL`. Otherwise, the app uses the workspace database. Runtime setup points `DIRECT_URL` at the selected app database; one-off Prisma commands must target that same database.
- `prisma db push` is opt-in through `PRISMA_DB_PUSH=true` and must not be used against a shared or production database. Compare local and database migration histories before applying migrations; if they differ, avoid broad schema syncs and apply only the intended change.
- `JWT_SECRET` is not configured: development generates a temporary signing key, so sessions expire after a server restart. Configure it securely before using persistent sessions. Optional OAuth, SMTP, Supabase Storage, and Cloudflare AI integrations remain unconfigured; those features require their own credentials and services.
- Production setup is different: follow the README's required environment variables and migration procedure; do not use development schema sync against production.