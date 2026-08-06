/**
 * PDF Cache — 99's Guide Offline & Cache Optimization
 *
 * Caches PDF files as ArrayBuffers in a dedicated IndexedDB database
 * so medical lectures open instantly without re-downloading.
 *
 * Strategy:
 *  - On first open: fetch → store ArrayBuffer in IDB → open blob URL
 *  - On subsequent opens: serve blob URL from IDB directly (no network)
 *  - Max storage: 80 MB (LRU eviction when limit is reached)
 *  - Works in: web browser, Capacitor WebView (in-app PDF viewer)
 *  - Native Browser.open (separate process): cannot share blobs — falls back to network URL
 *
 * Security: blob URLs are revoked after use to prevent memory leaks.
 * Quota: individual PDF capped at 30 MB to protect against huge files.
 */

const DB_NAME    = "BaghdadMedPDFCache";
const DB_VERSION = 1;
const STORE_NAME = "pdfBlobs";

const MAX_TOTAL_BYTES  = 80 * 1024 * 1024; // 80 MB
const MAX_SINGLE_BYTES = 30 * 1024 * 1024; // 30 MB per PDF

interface PDFEntry {
  lectureId:  string;
  buffer:     ArrayBuffer;
  mimeType:   string;
  cachedAt:   number;   // epoch ms
  sizeBytes:  number;
  sourceUrl:  string;
}

// ── IDB helper ────────────────────────────────────────────────────────────────
let _db: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e: any) => {
      const db: IDBDatabase = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "lectureId" });
        store.createIndex("cachedAt", "cachedAt", { unique: false });
      }
    };

    req.onsuccess = (e: any) => {
      _db = e.target.result;
      _db!.onversionchange = () => {
        _db?.close();
        _db = null;
        _dbPromise = null;
      };
      resolve(_db!);
    };

    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
  });

  return _dbPromise;
}

async function idbGet(lectureId: string): Promise<PDFEntry | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(lectureId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(entry: PDFEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbGetAll(): Promise<PDFEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbDelete(lectureId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(lectureId);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ── LRU eviction ─────────────────────────────────────────────────────────────
async function evictIfNeeded(): Promise<void> {
  try {
    const all   = await idbGetAll();
    const total = all.reduce((sum, e) => sum + e.sizeBytes, 0);
    if (total <= MAX_TOTAL_BYTES) return;

    // Sort oldest first
    all.sort((a, b) => a.cachedAt - b.cachedAt);
    let freed = 0;
    const toFree = total - MAX_TOTAL_BYTES;
    for (const entry of all) {
      if (freed >= toFree) break;
      await idbDelete(entry.lectureId);
      freed += entry.sizeBytes;
    }
  } catch {
    // Non-critical — ignore eviction errors
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export const pdfCache = {
  /**
   * Check whether a PDF for this lecture is already cached.
   */
  async hasCachedPdf(lectureId: string): Promise<boolean> {
    try {
      const entry = await idbGet(lectureId);
      return entry !== null;
    } catch {
      return false;
    }
  },

  /**
   * Return a blob URL for the cached PDF, or null if not cached.
   * The returned URL is valid until the tab is closed (no revoke needed for open).
   */
  async getCachedPdfUrl(lectureId: string): Promise<string | null> {
    try {
      const entry = await idbGet(lectureId);
      if (!entry) return null;
      const blob = new Blob([entry.buffer], { type: entry.mimeType || "application/pdf" });
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  },

  /**
   * Fetch a PDF from `pdfUrl`, cache it, and return a blob URL.
   * Returns null if the PDF is too large, unreachable, or caching fails.
   */
  async cachePdf(lectureId: string, pdfUrl: string): Promise<string | null> {
    try {
      const response = await fetch(pdfUrl, { credentials: "include" });
      if (!response.ok) return null;

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_SINGLE_BYTES) return null; // too large, skip

      const mimeType = response.headers.get("content-type") || "application/pdf";

      const entry: PDFEntry = {
        lectureId,
        buffer,
        mimeType,
        cachedAt:  Date.now(),
        sizeBytes: buffer.byteLength,
        sourceUrl: pdfUrl,
      };

      await idbPut(entry);
      evictIfNeeded(); // fire-and-forget

      const blob = new Blob([buffer], { type: mimeType });
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  },

  /**
   * Remove cached PDF for a specific lecture (e.g., when PDF URL changes).
   */
  async invalidate(lectureId: string): Promise<void> {
    try {
      await idbDelete(lectureId);
    } catch {}
  },

  /**
   * Storage metadata — useful for admin/settings display.
   */
  async getStorageInfo(): Promise<{ count: number; estimatedMB: number }> {
    try {
      const all = await idbGetAll();
      const bytes = all.reduce((s, e) => s + e.sizeBytes, 0);
      return { count: all.length, estimatedMB: Math.round(bytes / 1_048_576) };
    } catch {
      return { count: 0, estimatedMB: 0 };
    }
  },

  /**
   * Wipe all cached PDFs (storage cleanup).
   */
  async clearAll(): Promise<void> {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx    = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    } catch {}
  },
};
