# PHASE 1 FINAL AUDIT REPORT

## 1. Executive Summary
- **Stack:** Frontend is React/Vite (`src/main.tsx`, `vite.config.ts`); backend is a single Express/Node application in `server.ts`, using Prisma PostgreSQL (`prisma/schema.prisma`).
- **Data Lifecycle:** Academic writes are PostgreSQL/Prisma-authoritative and asynchronously mirrored to Cloudflare D1 via `server.ts` helpers. Cloudflare R2 is the production-critical storage for PDFs and avatars, accessed by the Node server using compatibility-named functions (`server/services/supabaseStorage.ts`)—not Supabase Storage.
- **AI Readiness:** No AI integration exists. Future AI import must be additive, server-only, and use existing admin guards (`requireAdmin`). No MCQ/Flashcard bulk-create, update, or duplicate-detection routes exist. 

## 2. Repository Architecture
- **Backend:** `server.ts` manages all Express routes, `requireAdmin`/`requireUser` guards, Prisma interactions, and R2 storage logic.
- **Frontend:** Feature-based organization (`src/features/`), utilizing `src/core/api/apiClient.ts` for requests.
- **Storage/Cloudflare:** `server/services/supabaseStorage.ts` provides S3-compatible R2 client access. D1 is configured via `cloudflare-content-api/wrangler.jsonc` and `privateD1Sync.ts` as an optional read-mirror.
- **Auth:** JWT/Cookie-based with session version checks (`server.ts:6040-6084`).

## 3. Console Architecture
- **Root/UI:** `src/features/admin/components/ControlCenterView.tsx` houses the administrative console.
- **Rendering:** Navigation is handled by tab IDs (`data-console-tab-id`). Role protection is backend-enforced via `requireAdmin`.
- **Flow:** Users select a lecture by tree path (subject/track/dept) via `GET /api/lectures`, then POST to individual creation endpoints (`/api/mcqs`, `/api/flashcards`). No nested URL routes for content creation exist.

## 4. Lecture System
- **Database:** `model Lecture` (`prisma/schema.prisma:68-83`) contains `id`, `name`, `mainSubject`, `subSubject?`, `trackMode`, `department?`, `createdAt`.
- **Materials:** `model Material` (`prisma/schema.prisma:85-100`) stores metadata and `storagePath`. Videos are treated as materials.
- **Limits/Behavior:** `POST /api/lectures` requires `name`, `mainSubject`, `trackMode`. `DELETE` triggers `onDelete: Cascade` for MCQs, Flashcards, and Materials. No update route exists.

## 5. MCQ System
- **Database:** `model Mcq` (`prisma/schema.prisma:102-121`) has `question`, `optionA-D`, `correctAnswer`, `hint?`, `explanation?`, `sourceType`, `sourceRef`, `difficulty`, `lectureId`.
- **Absence:** Tags, ordering, subjectId/moduleId, createdBy, updatedBy, and unique constraints are missing.
- **Backend Lifecycle:** `POST /api/mcqs` (`server.ts:2992-3037`) enforces presence checks and normalizes answers to A-D. No validation schema, batch support, or duplicate detection exists.
- **Frontend:** `src/features/lectures/components/CreateMCQ.tsx` sends one JSON request per MCQ. No client-side schema library is used.

## 6. Flashcard / Anki System
- **Database:** `model Flashcard` (`prisma/schema.prisma:123-134`) stores `clinicalConcept`, `explanation`, `lectureId`.
- **Absence:** Tags, source, difficulty, author audit fields, and unique constraints are missing.
- **Backend Lifecycle:** `POST /api/flashcards` (`server.ts:2184-2235`) merges aliases (`front`/`back`) to canonical fields. Progress is tracked via `batch-progress` (`server.ts:2114-2139`), but content is single-create only.
- **Frontend:** `src/features/lectures/components/CreateAnki.tsx` handles manual entry.

## 7. File Upload System
- **Backend:** `POST /api/materials/upload` (`server.ts:2551-2742`) stages files in `MATERIALS_UPLOADS_DIR` (local disk).
- **Storage:** Uses `uploadPdfToSupabaseStorage` (`server/services/supabaseStorage.ts:256-285`), which interacts with Cloudflare R2 via S3-compatible credentials.
- **Limits:** 50 MiB, `application/pdf` MIME check, and `%PDF-` magic byte validation.
- **Metadata:** SQL `Material` row contains `storagePath`; `fileData` is explicitly stored as `null`. R2 objects are deleted on lecture/material cascade or manual replacement.

## 8. Cloudflare Integration
- Main application utilizes Cloudflare R2 for storage of PDF materials and user avatars via an S3-compatible API. The Node server handles all upload/download orchestration (`server/services/supabaseStorage.ts`), not the Cloudflare Worker bindings.
- **R2 Production Usage:** `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` are used by the Node server to write to `materials/<lectureId>/<materialId>.pdf` and `avatars/<userId>/<sha256>.<ext>`.
- **Cloudflare Worker Role:** The content worker (`cloudflare-content-api/wrangler.jsonc`) provides a D1 mirror and avatar delivery endpoints; it is not the authoritative upload path.
- **Mirroring:** D1 is a read/mirror subset configured via `CONTENT_D1_*_READS_ENABLED` feature flags. R2 is production-critical and authoritative for binary persistence; D1 content schema specifically omits binary `Material.fileData`.

## 9. SQL / Supabase / PostgreSQL Architecture
- **Canonical Store:** PostgreSQL (accessed via Prisma, `prisma/schema.prisma`) is the authoritative source for structured models: `Lecture`, `Material` (metadata only), `Mcq`, and `Flashcard`.
- **Binaries:** PDF/Image bytes are stored in R2. PostgreSQL `Material` rows store the `storagePath` and currently set `fileData` to `null` on new uploads.
- **Legacy Path:** PostgreSQL `fileData` (Bytea) remains for legacy migration fallback. The application resolves retrieval priority: R2 Signed URL → local `/uploads` → PostgreSQL Bytea.
- **Deployment:** The repository references Supabase through environment variables (`SUPABASE_DATABASE_URL`), but the physical storage implementation relies on direct S3-compatible R2 calls.

## 10. Authentication & Authorization
- **Guards:** Backend routes use `requireAdmin` (allows `admin`/`owner` roles), `requireOwner` (strictly `owner`), and `requireUser`.
- **Middleware:** Authorization is enforced via HS256 JWTs (`server.ts:5707`), checking `sessionVersion` and ban status.
- **AI Integration:** Recommended implementation uses existing `requireAdmin` guards to protect all new generation/preview/import endpoints. No new RBAC system should be created.

## 11. Existing Bulk Operations
- **Content:** No MCQ/Flashcard bulk-create, mass-publish, or CSV import routes exist.
- **Patterns:** The only relevant bulk pattern is `POST /api/flashcards/batch-progress`, which performs a Prisma `$transaction` of upsert operations.
- **Limitations:** Any future AI batch import must implement a similar transactional contract. Maximum safe batch size is currently undefined; 25 is the D1 outbox sync batch limit.

## 12. Duplicate Handling
- **Status:** No existing MCQ/Flashcard content duplicate detection or unique constraints exist.
- **Database:** Tables only enforce a generated `id` UUID. Indexes (`question`, `clinicalConcept`) are non-unique.
- **Existing Logic:** MCQ/Flashcard POST routes perform no comparison before insertion. Grading endpoints de-duplicate submission IDs only during the specific request lifecycle (`server.ts:3063`).

## 13. Validation Schemas
- **Approach:** Hand-written validation in `server.ts` routes and frontend forms. No Zod, Joi, or JSON-schema libraries are present.
- **Rules:** Server-side checks are limited to `truthy` presence checks and basic enums (e.g., MCQ answers restricted to A/B/C/D). No length limits, whitespace normalization, or content-type schemas exist for imports.

## 14. UI Components We Can Reuse
- **Forms:** `CreateMCQ.tsx` and `CreateAnki.tsx` provide the standard pattern for single-row admin entry.
- **UI:** Reusable building blocks include `FormError`, `Skeleton`, `QuickMuteModal`, and the `sonner` toast library.
- **API:** `src/core/api/apiClient.ts` handles standard request/retry/error patterns.
- **Gap:** No canonical, library-based dropzone or batch-import table component exists.

## 15. Existing PDF/Image/Text Utilities
- **PDF:** Limited to `multer` multipart handling, extension validation, and `%PDF-` magic byte check (`server.ts:1406-1411`). No parsing or extraction libraries (like `pdf-lib` or `pdf.js`) are currently implemented.
- **Image:** Avatar-only utility for JPEG/PNG/WebP, involving byte-signature validation, SHA-256 hashing, and R2 storage (`server/services/supabaseStorage.ts:88-209`). No OCR capability exists.
- **Text:** No existing utilities; text should be handled via standard JSON request bodies.

## 16. Recommended AI Module Location
Backend-only: `server/services/ai/`. All AI provider logic, including Gemini outbound adapters, should reside in this server-side module to maintain consistency with the existing `server/services/` architectural convention.

## 17. Secret Management
`GEMINI_API_KEY` must be configured as a server-side runtime secret (e.g., via Replit/production environment secrets). It must be accessed exclusively by the backend `server/services/ai/` module and never exposed via `VITE_*` prefixes, frontend code, client responses, or logs.

## 18. Recommended Input Handling
- **PDF:** Reuse the existing admin-authenticated multipart route pattern (`/api/materials/upload`) for initial connectivity, but implement a separate transient-only endpoint. Stream/stage input with bounded size, perform `%PDF-` magic-byte validation, and process via a temporary lifecycle (deleting via `finally` block). Do not persist as `Material` rows.
- **Image:** Add a distinct endpoint using strict JPEG/PNG/WebP magic-byte validation and size bounds. Do not route through the existing avatar update path.
- **Text:** Accept as a JSON body with an explicit character/byte cap. Persistence is not justified by current architecture; maintain request-scope unless audit requirements are defined.

## 19. Storage Recommendation
Production educational content persists in PostgreSQL (metadata) and R2 (PDF/Avatar binaries). AI-generated temporary inputs must be ephemeral. If asynchronous processing requires persistence, use a dedicated R2 prefix with a managed TTL or explicit cleanup—not `Material.fileData`, D1, or permanent `Lecture` related rows. 

## 20. Required Database Changes
- **Definitely required:** None for a synchronous MVP.
- **Optional:** If asynchronous processing/audit is adopted, a new metadata model for AI jobs/sources (status, owner, lecture, input type, timestamps, error logs, cleanup keys).
- **Unnecessary:** Changes to `Lecture`, `Mcq`, or `Flashcard` core schemas. Existing fields support AI-imported content.

## 21. Required Backend Changes
- Implement `server/services/ai/` provider abstraction.
- Add strict JSON schema validation for AI outputs to enforce constraints (e.g., A/B/C/D answer normalization).
- Register admin-protected preview and import endpoints in `server.ts` or `server/services/ai/aiRoutes.ts`.
- Implement bounded resource limits, `AbortController` timeouts, and sanitized logging.
- Use atomic, bounded Prisma transactions for import; do not allow provider responses to trigger unvalidated writes.

## 22. Required Frontend Changes
- Add additive admin UI within the existing `ControlCenterView` (e.g., `AIContentImport.tsx`).
- Reuse `apiClient` for preview/import requests.
- Implement editable review states and duplicate warning indicators before finalizing imports.
- Maintain existing PWA/Capacitor responsive patterns and `FormError`/`Skeleton` component library.

## 23. Security Risks
- **Provider/API:** Leakage of `GEMINI_API_KEY` through logging or frontend exposure.
- **Injection/Malware:** Malicious PDF/image uploads; prompt injection; SSRF if remote URLs were enabled (must be disabled).
- **Privilege:** Unauthorized access or duplicate re-imports; risk mitigated by strictly enforcing `requireAdmin` and standardizing idempotency.
- **Data:** Excessive logging of PII or educational content.
- **Denial of Service:** Oversized requests; lack of explicit concurrency/rate limits on AI endpoints.

## 24. Production Regression Risks
- **Auth/Session Integrity**: Modifying `requireAdmin` or `server.ts` session management threatens web, iOS (bearer), and OAuth authentication flows.
- **Content Sync Divergence**: Existing content is managed via a transactional Prisma write followed by D1 sync; new import paths must use the same atomicity or risk content divergence.
- **Cache Invalidation**: The existing API cache (`src/core/api/apiClient.ts`) relies on URL-based TTLs; new bulk content must explicitly invalidate Console lecture detail caches or stale content will persist for users.
- **Storage/Lifecycle**: Reusing the R2-backed `uploadPdfToSupabaseStorage` service path for temporary AI inputs poses a risk of unintended object persistence if cleanup is not guaranteed by `finally` blocks, as current upload routes are designed for permanent `Material` row replacement.
- **Client-side Mutations**: The application lacks idempotency tokens for mutations; network retries on AI import routes could lead to duplicate content creation if implemented without strict client-to-server transaction mapping.

## 25. Blockers / Unknowns
- **Gemini API Contract**: File upload limits, model-specific token/rate quotas, and response schema consistency for the Gemini provider are not conclusively determined from the repository.
- **Deployment Constraints**: Production request body size limits, timeout thresholds for the reverse proxy (Render/Replit), and R2 lifecycle/TTL configuration are not conclusively determined from the repository.
- **Auth/RBAC Coverage**: While `requireAdmin` is used for content, the repository lacks a comprehensive audit of all potential privilege escalation paths for new endpoints.
- **Persistence Strategy**: Whether the project requires a formal asynchronous job/audit system for AI imports remains unconfirmed; synchronous creation is the only pattern currently supported.
- **Environment Secrets**: The production secret manager and exact rotation policy for potential API keys are unknown.

## 26. Proposed Integration Map
Admin Console (`ControlCenterView`) → New AI Import UI → `apiClient` admin-protected endpoint → Express `requireAdmin` → bounded multipart/text intake → `AIContentService` (server-only provider abstraction) → Gemini Adapter → Strict validation schema → Editable review UI → Duplicate detection against selected Lecture → Explicit import endpoint → Bounded transaction (Prisma `$transaction` using `createMany`-like logic) → Database (`Mcq`/`Flashcard` rows) → D1 sync + cache invalidation + `materials_updated` broadcast.

## 27. Exact Files Expected to Change in Future Phases

| File | Current Responsibility | Expected Future Change | Phase |
| :--- | :--- | :--- | :--- |
| `server.ts` | Central Express routes/middleware | Register/delegate AI routes; preserve existing guards | 2 |
| `src/features/lectures/components/CreateMCQ.tsx` | Manual MCQ creation | Integrate AI preview/review launch | 2 |
| `src/features/lectures/components/CreateAnki.tsx` | Manual card creation | Integrate AI preview/review launch | 2 |
| `src/core/api/apiClient.ts` | Frontend API wrapper | Add support for AI import/progress semantics | 2 |
| `.env.example` | Environment documentation | Add server-only `GEMINI_API_KEY` documentation | 2 |

## 28. Exact New Files Likely Needed

| Proposed File | Responsibility | Phase |
| :--- | :--- | :--- |
| `server/services/ai/AIContentService.ts` | Provider orchestration and logic | 2 |
| `server/services/ai/GeminiProvider.ts` | Server-only Gemini HTTPS adapter | 2 |
| `server/services/ai/schemas.ts` | Strict MCQ/Flashcard validation | 2 |
| `src/features/lectures/components/AIContentImport.tsx` | AI import and review UI | 2 |

## 29. Phase 2 Recommendation
Implement a narrow synchronous admin-only preview MVP: create a backend-only AI module using `server/services/` to communicate with the Gemini API, utilizing `requireAdmin` to gate access. Require strict validation of Gemini output against the current `Mcq` and `Flashcard` schema models using a server-side validation layer. Implement an editable review interface before final insertion into the database. Ensure all temporary file inputs are handled via `finally` blocks to prevent R2 orphan accumulation. Preserve the existing manual creation flow as the canonical persistence path. Do not implement asynchronous job queues or schema migrations in Phase 2 unless performance requirements dictate a move away from synchronous transactions.

**PHASE 1 STATUS: AUDIT COMPLETE — READY FOR ARCHITECT REVIEW**
