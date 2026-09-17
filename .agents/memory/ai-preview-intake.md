---
name: AI preview intake
description: Durable design rule for large AI preview uploads and cancellation-safe cleanup.
---

HTTP binary preview intake should adopt disk-backed files as trusted temporary capabilities, not expose paths or copy large buffers into memory. Keep signature, MIME, size, hashing, and ownership checks in the shared input service; make upload, prepared-input, provider-media, and request-abort lifecycles independently idempotent.

**Why:** Synchronous admin previews accept large PDFs and image batches, so raw paths or memory storage would weaken the Phase 3A trust boundary and make disconnect cleanup unreliable.

**How to apply:** Future AI HTTP work should inject test doubles, preserve ordered multipart files, propagate the request signal into provider calls, and release every temporary resource and concurrency slot in `finally`.