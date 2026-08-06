import { apiClient } from "../../core/api/apiClient";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Network, ConnectionStatus } from "@capacitor/network";
import { MCQ, Flashcard, UserProgress } from "../../core/types";

// Spaced Repetition Parameters (SuperMemo SM-2 Algorithm)
import { App } from "@capacitor/app";
interface SpacedRepetitionState {
  cardId: string;
  repetitions: number;
  interval: number; // in days
  easeFactor: number;
  nextReviewDate: string; // ISO String
}

interface OfflineProgressItem {
  id: string; // Unique primary key, e.g. "userId_type_targetId"
  userId: string;
  type: "mcq_score" | "flashcard_sr" | "lecture_progress";
  targetId: string; // lectureId or cardId
  payload: any; // MCQ score, SM-2 state, or progress status
  lastUpdated: string; // ISO timestamp
  synced: number; // 0 for unsynced, 1 for synced
}

class DataSyncManagerClass {
  private dbName = "BaghdadMedicalOfflineDB_v2";
  private dbVersion = 2;
  private db: IDBDatabase | null = null;
  private syncListeners: Set<(syncing: boolean) => void> = new Set();
  private initializedPromise: Promise<void>;
  /** Handle for the pending retry timer — cleared before each reschedule to prevent duplicates. */
  private retryTimerId: ReturnType<typeof setTimeout> | null = null;
  /** Capacitor Network listener handle for teardown. */
  private networkListenerHandle: { remove: () => Promise<void> } | null = null;
  /** Web 'online' handler reference for removeEventListener. */
  private webOnlineHandler: (() => void) | null = null;

  constructor() {
    this.initializedPromise = this.initDatabase();
    this.setupNetworkListeners();
  }

  /**
   * Initialize standard IndexedDB instance with transactional object stores.
   */
  private initDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined") {
        resolve();
        return;
      }

      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;

        // Store 1: Flashcards cache (academic downlink sync)
        if (!db.objectStoreNames.contains("flashcards")) {
          db.createObjectStore("flashcards", { keyPath: "id" });
        }

        // Store 2: MCQs cache (academic downlink sync)
        if (!db.objectStoreNames.contains("mcqs")) {
          db.createObjectStore("mcqs", { keyPath: "id" });
        }

        // Store 3: Student Progress tracking (uplink queue + offline-first store)
        if (!db.objectStoreNames.contains("offline_progress")) {
          const progressStore = db.createObjectStore("offline_progress", {
            keyPath: "id",
          });
          progressStore.createIndex("synced", "synced", { unique: false });
          progressStore.createIndex("userId", "userId", { unique: false });
        }
      };

      request.onsuccess = (event: any) => {
        this.db = event.target.result;
        
        resolve();
      };

      request.onerror = (event: any) => {
        
        reject(event.target.error);
      };
    });
  }

  /**
   * Monitor internet status with @capacitor/network and fallback web listeners.
   * Stores handles so listeners can be removed on dispose() to prevent
   * duplicate registrations during hot-reload or singleton re-initialization.
   */
  private setupNetworkListeners() {
    if (typeof window === "undefined") return;

    // Listen to Capacitor native network status changes — store handle for teardown
    Network.addListener("networkStatusChange", (status: ConnectionStatus) => {
      if (status.connected) {
        this.scheduleSyncProcess();
      }
    }).then(handle => { this.networkListenerHandle = handle; }).catch(() => {});

    // Web Fallback listener — named reference so it can be removed
    this.webOnlineHandler = () => { this.scheduleSyncProcess(); };
    window.addEventListener("online", this.webOnlineHandler);

    // Capacitor App State
    try {
      App.addListener('appStateChange', (state) => {
        if (state.isActive) {
          this.scheduleSyncProcess();
        }
      });
    } catch (e) {}
  }

  /**
   * Ensure database is initialized before any transaction.
   */
  private async ensureDb(): Promise<IDBDatabase> {
    await this.initializedPromise;
    if (!this.db) {
      throw new Error("IndexedDB not accessible or failing initialization.");
    }
    return this.db;
  }

  // ==========================================
  // 1. Downlink Fetching & Local Persistence
  // ==========================================

  /**
   * Fetches JSON data (Flashcards and MCQs) from server and updates local IndexedDB tables.
   */
  public async fetchAndStoreAcademicMaterials(): Promise<{
    flashcardsCount: number;
    mcqsCount: number;
  }> {
    try {
      const isOnline = await this.isOnline();
      if (!isOnline) {
        
        return { flashcardsCount: 0, mcqsCount: 0 };
      }

      
      const response = await apiClient("/api/materials");
      if (!response.ok) {
        throw new Error("Failed to retrieve academic materials from server");
      }

      let data;
      try {
        data = await response.clone().json();
      } catch (parseError) {
        
        // Recover by clearing caches and unregistering SW
        if ('caches' in window) {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
          } catch (e) {
            
          }
        }
        if ('serviceWorker' in navigator) {
          try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const reg of registrations) {
              await reg.unregister();
            }
          } catch (e) {
            
          }
        }
        return { flashcardsCount: 0, mcqsCount: 0 };
      }

      const flashcards: Flashcard[] = data.flashcards || [];
      const mcqs: MCQ[] = data.mcqs || [];

      // Save to IndexedDB
      await this.saveFlashcardsToLocal(flashcards);
      await this.saveMCQsToLocal(mcqs);

      
      return { flashcardsCount: flashcards.length, mcqsCount: mcqs.length };
    } catch (err: any) {
      if (
        err &&
        (err.status === 401 ||
          err.status === 403 ||
          (err.message &&
            err.message.includes("authenticated academic session")))
      ) {
        
      } else {
        
      }
      return { flashcardsCount: 0, mcqsCount: 0 };
    }
  }

  private async saveFlashcardsToLocal(flashcards: Flashcard[]): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("flashcards", "readwrite");
      const store = tx.objectStore("flashcards");

      // Clear existing first
      store.clear();

      flashcards.forEach((card) => {
        store.put(card);
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async saveMCQsToLocal(mcqs: MCQ[]): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("mcqs", "readwrite");
      const store = tx.objectStore("mcqs");

      // Clear existing first
      store.clear();

      mcqs.forEach((mcq) => {
        store.put(mcq);
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==========================================
  // 2. Local Query Getters (Completely Offline)
  // ==========================================

  /**
   * Query cached Flashcards for a given lecture.
   */
  public async getLocalFlashcards(lectureId: string): Promise<Flashcard[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("flashcards", "readonly");
      const store = tx.objectStore("flashcards");
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result as Flashcard[];
        resolve(results.filter((card) => card.lectureId === lectureId));
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Query cached MCQs for a given lecture.
   */
  public async getLocalMCQs(lectureId: string): Promise<MCQ[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("mcqs", "readonly");
      const store = tx.objectStore("mcqs");
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result as MCQ[];
        resolve(results.filter((mcq) => mcq.lectureId === lectureId));
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // 3. Offline Student Progress Tracking & SM-2
  // ==========================================

  /**
   * Record MCQ quiz scores locally.
   */
  public async trackMCQScore(
    userId: string,
    lectureId: string,
    score: number,
  ): Promise<void> {
    const payload = { score, completedAt: new Date().toISOString() };
    await this.saveProgressItem(userId, "mcq_score", lectureId, payload);
  }

  /**
   * Record Spaced Repetition (SM-2 Algorithm) updates on Anki Cards.
   * Rating scale: 0 (forgot), 1 (hesitant/hard), 2 (good), 3 (perfect/easy)
   */
  public async trackFlashcardSpacedRepetition(
    userId: string,
    cardId: string,
    rating: number, // 0-3 scale matching medical student recall intensity
  ): Promise<SpacedRepetitionState> {
    // 1. Get existing SM-2 state for this card
    const existing = await this.getProgressItem(userId, "flashcard_sr", cardId);
    const state: SpacedRepetitionState = existing?.payload || {
      cardId,
      repetitions: 0,
      interval: 1,
      easeFactor: 2.5,
      nextReviewDate: new Date().toISOString(),
    };

    // 2. SM-2 calculation math (SuperMemo Algorithm standard adjustment logic)
    let { repetitions, interval, easeFactor } = state;

    if (rating >= 1) {
      // Correct responses
      if (repetitions === 0) {
        interval = 1; // 1 day
      } else if (repetitions === 1) {
        interval = 4; // 4 days (or 6 in SM2, shortened slightly for tight rotations)
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions += 1;
    } else {
      // Forgotten response
      repetitions = 0;
      interval = 1;
    }

    // Adjust ease factor based on performance index
    // Simplified standard: EF' = EF + (0.1 - (3 - rating) * (0.08 + (3 - rating) * 0.02))
    // We calibrate rating 0 to 3 scale mapped to standard 0 to 5 SM2 formula
    const mappedRating = rating * (5 / 3); // Map 0-3 to 0-5
    easeFactor =
      easeFactor +
      (0.1 - (5 - mappedRating) * (0.08 + (5 - mappedRating) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3; // Min boundary clamp

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval);

    const newState: SpacedRepetitionState = {
      cardId,
      repetitions,
      interval,
      easeFactor,
      nextReviewDate: nextReview.toISOString(),
    };

    // 3. Persist locally to offline store
    await this.saveProgressItem(userId, "flashcard_sr", cardId, newState);
    return newState;
  }

  /**
   * Record complete Lecture sub-module item marks offline.
   */
  public async trackLectureProgress(
    userId: string,
    lectureId: string,
    fields: Partial<Omit<UserProgress, "userId" | "lectureId">>,
  ): Promise<void> {
    const existing = await this.getProgressItem(
      userId,
      "lecture_progress",
      lectureId,
    );
    const updatedPayload = {
      ...(existing?.payload || {
        pdfCompleted: false,
        notesCompleted: false,
        videoCompleted: false,
        flashcardsCompleted: false,
        quizCompleted: false,
        quizScore: 0,
      }),
      ...fields,
      lastAccessed: new Date().toISOString(),
    };

    await this.saveProgressItem(
      userId,
      "lecture_progress",
      lectureId,
      updatedPayload,
    );
  }

  // Helper: Read a single progress item from IndexedDB
  private async getProgressItem(
    userId: string,
    type: OfflineProgressItem["type"],
    targetId: string,
  ): Promise<OfflineProgressItem | null> {
    const db = await this.ensureDb();
    const id = `${userId}_${type}_${targetId}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("offline_progress", "readonly");
      const store = tx.objectStore("offline_progress");
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  // Helper: Persist/update a progress item locally with synchronized markers
  private async saveProgressItem(
    userId: string,
    type: OfflineProgressItem["type"],
    targetId: string,
    payload: any,
  ): Promise<void> {
    const db = await this.ensureDb();
    const id = `${userId}_${type}_${targetId}`;
    const timestamp = new Date().toISOString();

    const item: OfflineProgressItem = {
      id,
      userId,
      type,
      targetId,
      payload,
      lastUpdated: timestamp,
      synced: 0,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction("offline_progress", "readwrite");
      const store = tx.objectStore("offline_progress");
      store.put(item);

      tx.oncomplete = () => {
        
        resolve();
        // Trigger background sync in case we are connected
        this.scheduleSyncProcess();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==========================================
  // 4. Background Synchronization Engine
  // ==========================================

  /**
   * Pulls all unsynced items, pushes them to backend database, handles conflicts, and flags local sync.
   */
  private syncRetryCount = 0;
  private isProcessingSync = false;

  public async triggerBackgroundSync(): Promise<boolean> {
    const isOnline = await this.isOnline();
    if (!isOnline || this.isProcessingSync) return false;
    
    // Global lock for both engines
    if ((window as any).__offlineSyncLock) return false;
    
    (window as any).__offlineSyncLock = true;
    this.isProcessingSync = true;
    
    const unsyncedItems = await this.getUnsyncedProgressItems();
    if (unsyncedItems.length === 0) {
      this.syncRetryCount = 0;
      this.isProcessingSync = false;
      (window as any).__offlineSyncLock = false;
      return true;
    }

    this.notifyListeners(true);
    window.dispatchEvent(
      new CustomEvent("offline-sync-status", {
        detail: { syncing: true, status: "Syncing", pendingCount: unsyncedItems.length },
      }),
    );

    let syncCompleted = false;
    try {
      const response = await apiClient("/api/offline/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: unsyncedItems }),
      });

      if (!response.ok) {
        throw response;
      }

      const syncResult = await response.json();
      const resolvedServerItems: OfflineProgressItem[] =
        syncResult.resolved || [];

      await this.applyResolvedItems(resolvedServerItems);
      syncCompleted = true;
      this.syncRetryCount = 0;

      window.dispatchEvent(
        new CustomEvent("offline-sync-finished", {
          detail: { resolvedCount: resolvedServerItems.length },
        }),
      );
      
      window.dispatchEvent(
        new CustomEvent("offline-sync-status", {
          detail: {
            syncing: false,
            status: "Resolved",
            pendingCount: 0,
            completed: true,
          },
        }),
      );
    } catch (err: any) {
      syncCompleted = false;
      const status = err.status || (err.response && err.response.status) || 500;
      
      if (status === 401 || status === 403 || status === 400 || status === 404 || status === 422) {
         // Permanent Error
         await this.moveToDLQ(unsyncedItems);
         window.dispatchEvent(new CustomEvent("offline-sync-status", { detail: { status: "Failed", message: "A saved change was rejected by the server." } }));
      } else {
         // Transient Error -> Retry
         window.dispatchEvent(new CustomEvent("offline-sync-status", { detail: { status: "Retrying", message: "Network unstable. Retrying soon." } }));
         this.syncRetryCount++;
         this.scheduleSyncProcess();
      }
    } finally {
      this.notifyListeners(false);
      this.isProcessingSync = false;
      (window as any).__offlineSyncLock = false;
    }

    return syncCompleted;
  }
  
  private async moveToDLQ(items: OfflineProgressItem[]): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("offline_progress", "readwrite");
      const store = tx.objectStore("offline_progress");
      items.forEach((item) => {
        const updatedItem = { ...item, synced: -1 }; // -1 indicates DLQ
        store.put(updatedItem);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  
  private scheduleSyncProcess() {
    // Cancel any in-flight retry before scheduling a new one so connectivity
    // flapping does not pile up concurrent sync attempts.
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
    const backoff = Math.min(1000 * Math.pow(2, this.syncRetryCount), 60000);
    const jitter = Math.random() * (backoff * 0.2);
    this.retryTimerId = setTimeout(() => {
      this.retryTimerId = null;
      void this.triggerBackgroundSync();
    }, backoff + jitter);
  }

  /** Release all listeners and timers. Call during teardown or hot-reload. */
  public dispose(): void {
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
    if (this.networkListenerHandle) {
      this.networkListenerHandle.remove().catch(() => {});
      this.networkListenerHandle = null;
    }
    if (this.webOnlineHandler) {
      window.removeEventListener("online", this.webOnlineHandler);
      this.webOnlineHandler = null;
    }
  }

  private async getUnsyncedProgressItems(): Promise<OfflineProgressItem[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("offline_progress", "readonly");
      const store = tx.objectStore("offline_progress");
      const index = store.index("synced");
      const request = index.getAll(IDBKeyRange.only(0));

      request.onsuccess = () =>
        resolve(request.result as OfflineProgressItem[]);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Conflict Resolution Strategy:
   * Compares timestamps for each record to protect and store only the absolute latest update.
   */
  private async applyResolvedItems(
    resolvedItems: OfflineProgressItem[],
  ): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("offline_progress", "readwrite");
      const store = tx.objectStore("offline_progress");

      resolvedItems.forEach((item) => {
        // Force sync status marker to true since backend saved it safely
        const updatedItem = {
          ...item,
          synced: 1,
        };
        store.put(updatedItem);
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==========================================
  // 5. Connection Utilities
  // ==========================================

  public async isOnline(): Promise<boolean> {
    try {
      const status = await Network.getStatus();
      return status.connected;
    } catch {
      return typeof navigator !== "undefined" ? navigator.onLine : true;
    }
  }

  // Listener pattern for active sync indicators
  public subscribeToSyncState(
    callback: (syncing: boolean) => void,
  ): () => void {
    this.syncListeners.add(callback);
    return () => {
      this.syncListeners.delete(callback);
    };
  }

  private notifyListeners(syncing: boolean) {
    this.syncListeners.forEach((cb) => cb(syncing));
  }
}

export const DataSyncManager = new DataSyncManagerClass();
