import { safeJsonParse } from "../../core/utils/safeJson";
import { SecureStorage } from "../utils/secureStorage";
import { apiClient } from "../../core/api/apiClient";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { accountStorageKey } from "../storage/accountData";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  User,
  Subject,
  Lecture,
  UserProgress,
  CalendarEvent,
  PointsLog,
} from "../../core/types";

interface UnsyncedMutation {
  id: string;
  type:
    | "UPDATE_PROFILE"
    | "UPDATE_PROGRESS"
    | "ADD_EVENT"
    | "DELETE_EVENT"
    | "SYNC_ALL";
  payload: any;
  timestamp: string;
  /** Number of times this mutation has been attempted. */
  attempts?: number;
  /** Terminal state marker once a mutation lands in the dead-letter queue. */
  status?: "pending" | "failed";
  lastError?: string;
}

class OfflineEngineClass {
  private listeners: Set<(online: boolean) => void> = new Set();
  private isOnlineState: boolean = typeof navigator === "undefined" ? true : navigator.onLine;
  private isSyncPaused: boolean = false;
  /** Handle for the periodic ping interval so it can be cleared on dispose. */
  private pingIntervalId: ReturnType<typeof setInterval> | null = null;
  /** Handle for the pending retry timer to prevent duplicate schedules. */
  private retryTimerId: ReturnType<typeof setTimeout> | null = null;
  /** Do not show offline UI for a single transient health-check failure. */
  private consecutivePingFailures = 0;
  private readonly PING_FAILURES_BEFORE_OFFLINE = 2;

  public setSyncPaused(paused: boolean) {
    this.isSyncPaused = paused;
  }

  constructor() {
    
    if (typeof window !== "undefined") {
      try {
        CapacitorApp.addListener('appStateChange', (state) => {
          if (!state.isActive) {
            this.setSyncPaused(true);
          } else {
            this.setSyncPaused(false);
            if (this.isOnlineState) {
              this.scheduleQueueProcess();
            }
          }
        });
      } catch (e) {}

      if (Capacitor.isNativePlatform()) {
        // On native (iOS/Android) use the Capacitor Network plugin.
        // window online/offline events are unreliable inside WKWebView.
        Network.addListener("networkStatusChange", (status) => {
          this.handleConnectivityChange(status.connected);
        });

        // Seed the initial state from the native layer on startup.
        Network.getStatus().then((status) => {
          this.handleConnectivityChange(status.connected);
        }).catch(() => {});
      } else {
        // On web, browser events + periodic server ping work well.
        window.addEventListener("online", () =>
          this.handleConnectivityChange(true),
        );
        window.addEventListener("offline", () =>
          this.handleConnectivityChange(false),
        );

        // Periodically verify real connectivity with a lightweight server ping.
        // Only on web — on native the Network plugin handles this accurately.
        this.pingIntervalId = setInterval(() => this.pingServer(), 25000);
      }
    }
  }

  // --- Connectivity Management ---
  public isOnline(): boolean {
    return this.isOnlineState;
  }

  public subscribe(callback: (online: boolean) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private handleConnectivityChange(online: boolean) {
    if (online) this.consecutivePingFailures = 0;
    if (this.isOnlineState !== online) {
      this.isOnlineState = online;
      this.listeners.forEach((cb) => cb(online));
      if (online) {
        this.scheduleQueueProcess();
      } else {
        
      }
    } }

  private async pingServer() {
    // Skip while the tab is hidden — background pings are pure waste.
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const response = await apiClient("/api/health", {
        method: "HEAD",
        cache: "no-cache",
        retries: 0,
        timeoutMs: 8_000,
        silent: true,
      });
      if (response.ok) {
        this.consecutivePingFailures = 0;
        this.handleConnectivityChange(true);
        return;
      }
    } catch {
      // Count below. A single brief timeout must not flip the entire app offline.
    }

    this.consecutivePingFailures += 1;
    if (this.consecutivePingFailures >= this.PING_FAILURES_BEFORE_OFFLINE) {
      this.handleConnectivityChange(false);
    }
  }

  // --- Local Cache Getters and Setters ---
  public async getCachedUser(): Promise<User | null> {
    try {
      const saved = await SecureStorage.get("logged_user");
      return saved ? safeJsonParse(saved, null) : null;
    } catch {
      return null;
    }
  }

  public setCachedUser(user: User | null): void {
    if (user) {
      try { SecureStorage.set("logged_user", JSON.stringify(user)); } catch(e){}
    } else {
      SecureStorage.remove("logged_user");
    }
  }

  public getCachedSubjects(): Subject[] {
    try {
      const saved = localStorage.getItem("subjects_catalog_cache");
      return saved ? safeJsonParse<Subject[]>(saved, []) : [];
    } catch {
      return [];
    }
  }

  public setCachedSubjects(subjects: Subject[]): void {
    try { localStorage.setItem("subjects_catalog_cache", JSON.stringify(subjects)); } catch(e){}
  }

  public getCachedLectures(): Record<string, any> {
    try {
      const saved = localStorage.getItem("detailed_lectures_cache");
      return saved ? safeJsonParse<Record<string, any>>(saved, {}) : {};
    } catch {
      return {};
    }
  }

  public setCachedLecture(lectureId: string, lecture: any): void {
    const cache = this.getCachedLectures();
    cache[lectureId] = {
      ...lecture,
      cachedAt: new Date().toISOString(),
    };
    try { localStorage.setItem("detailed_lectures_cache", JSON.stringify(cache)); } catch(e){}
  }

  public getCachedCalendarEvents(): CalendarEvent[] {
    try {
      const saved = localStorage.getItem(accountStorageKey("calendar_events"));
      return saved ? safeJsonParse<CalendarEvent[]>(saved, []) : [];
    } catch {
      return [];
    }
  }

  public setCachedCalendarEvents(events: CalendarEvent[]): void {
    try { localStorage.setItem(accountStorageKey("calendar_events"), JSON.stringify(events)); } catch(e){}
  }

  public getCachedProgress(): UserProgress[] {
    try {
      const saved = localStorage.getItem(accountStorageKey("progress_db"));
      return saved ? safeJsonParse<UserProgress[]>(saved, []) : [];
    } catch {
      return [];
    }
  }

  public setCachedProgress(progress: UserProgress[]): void {
    try { localStorage.setItem(accountStorageKey("progress_db"), JSON.stringify(progress)); } catch(e){}
  }

  public getCachedPointsLogs(): PointsLog[] {
    try {
      const saved = localStorage.getItem(accountStorageKey("points_log"));
      return saved ? safeJsonParse<PointsLog[]>(saved, []) : [];
    } catch {
      return [];
    }
  }

  public setCachedPointsLogs(logs: PointsLog[]): void {
    try { localStorage.setItem(accountStorageKey("points_log"), JSON.stringify(logs)); } catch(e){}
  }

  // --- Queue Failed Requests (Queue and Background Sync) ---

  private inMemoryQueue: UnsyncedMutation[] | null = null;
  private inMemoryDeadLetterQueue: UnsyncedMutation[] | null = null;
  private deadLetterDbPromise: Promise<IDBDatabase> | null = null;
  private deadLetterDb: IDBDatabase | null = null;
  private syncRetryCount = 0;
  private isProcessingQueue = false;

  /** Cap on consecutive transient retries before a mutation is terminal in the DLQ. */
  private readonly MAX_SYNC_ATTEMPTS = 5;

  private openDeadLetterDb(): Promise<IDBDatabase> {
    if (this.deadLetterDbPromise) return this.deadLetterDbPromise;
    this.deadLetterDbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open("BaghdadMedicalOfflineMutations", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("deadLetters")) {
          db.createObjectStore("deadLetters", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("pending")) {
          db.createObjectStore("pending", { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        this.deadLetterDb = request.result;
        this.deadLetterDb.onversionchange = () => {
          this.deadLetterDb?.close();
          this.deadLetterDb = null;
          this.deadLetterDbPromise = null;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
    return this.deadLetterDbPromise;
  }

  private async persistDeadLetter(mutation: UnsyncedMutation): Promise<void> {
    try {
      const db = await this.openDeadLetterDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("deadLetters", "readwrite");
        tx.objectStore("deadLetters").put(mutation);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // The in-memory fallback remains active and the caller emits a visible
      // recovery warning. It is only used when IndexedDB itself is unavailable.
    }
  }

  private async hydrateDeadLetters(): Promise<void> {
    try {
      const db = await this.openDeadLetterDb();
      const stored = await new Promise<UnsyncedMutation[]>((resolve, reject) => {
        const tx = db.transaction("deadLetters", "readonly");
        const request = tx.objectStore("deadLetters").getAll();
        request.onsuccess = () => resolve(request.result as UnsyncedMutation[]);
        request.onerror = () => reject(request.error);
      });
      if (stored.length === 0) return;
      const merged = new Map(this.getDeadLetterQueue().map((item) => [item.id, item]));
      stored.forEach((item) => merged.set(item.id, item));
      this.inMemoryDeadLetterQueue = Array.from(merged.values());
      try { localStorage.setItem(accountStorageKey("offline_dlq"), JSON.stringify(this.inMemoryDeadLetterQueue)); } catch { /* IDB remains durable */ }
    } catch {
      // LocalStorage/in-memory behavior remains available as a compatibility path.
    }
  }

  private async removePersistentDeadLetters(ids: string[]): Promise<void> {
    try {
      const db = await this.openDeadLetterDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("deadLetters", "readwrite");
        const store = tx.objectStore("deadLetters");
        ids.forEach((id) => store.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch { /* best effort; active queue remains the source of truth */ }
  }

  private async persistPendingQueue(queue: UnsyncedMutation[]): Promise<void> {
    try {
      const db = await this.openDeadLetterDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("pending", "readwrite");
        const store = tx.objectStore("pending");
        store.clear();
        queue.forEach((item) => store.put(item));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch { /* localStorage remains the fast path */ }
  }

  private async hydratePendingQueue(): Promise<void> {
    try {
      const db = await this.openDeadLetterDb();
      const stored = await new Promise<UnsyncedMutation[]>((resolve, reject) => {
        const tx = db.transaction("pending", "readonly");
        const request = tx.objectStore("pending").getAll();
        request.onsuccess = () => resolve(request.result as UnsyncedMutation[]);
        request.onerror = () => reject(request.error);
      });
      if (stored.length === 0) return;
      const merged = new Map(this.getMutationQueue().map((item) => [item.id, item]));
      stored.forEach((item) => merged.set(item.id, item));
      this.inMemoryQueue = Array.from(merged.values());
    } catch { /* localStorage remains the compatibility path */ }
  }

  private async clearPendingQueue(): Promise<void> {
    try {
      const db = await this.openDeadLetterDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("pending", "readwrite");
        tx.objectStore("pending").clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch { /* best effort */ }
  }

  public getDeadLetterQueue(): UnsyncedMutation[] {
    if (this.inMemoryDeadLetterQueue) return this.inMemoryDeadLetterQueue;
    try {
      const saved = localStorage.getItem(accountStorageKey("offline_dlq"));
      return saved ? safeJsonParse<UnsyncedMutation[]>(saved, []) : [];
    } catch {
      return [];
    }
  }

  public addToDLQ(mutation: UnsyncedMutation): void {
    const dlq = this.getDeadLetterQueue();
    dlq.push(mutation);
    try {
      localStorage.setItem(accountStorageKey("offline_dlq"), JSON.stringify(dlq));
      this.inMemoryDeadLetterQueue = null;
    } catch(e) {
      this.inMemoryDeadLetterQueue = dlq;
    }
    void this.persistDeadLetter(mutation);
  }

  private persistQueue(queue: UnsyncedMutation[]): boolean {
    try { 
      localStorage.setItem(accountStorageKey("offline_mutations_queue"), JSON.stringify(queue));
      this.inMemoryQueue = null;
      void this.clearPendingQueue();
      return true;
    } catch(e: any) {
      if (e.name === "QuotaExceededError" || e.code === 22) {
        this.inMemoryQueue = queue; // Keep in memory
      }
      void this.persistPendingQueue(queue);
      return false;
    }
  }

  public getMutationQueue(): UnsyncedMutation[] {
    if (this.inMemoryQueue) return this.inMemoryQueue;
    try {
      const saved = localStorage.getItem(accountStorageKey("offline_mutations_queue"));
      if (!saved) return [];
      const parsed = safeJsonParse<UnsyncedMutation[]>(saved, []);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public addToQueue(
    mutation: Omit<UnsyncedMutation, "id" | "timestamp">,
  ): void {
    const queue = this.getMutationQueue();
    const newMutation: UnsyncedMutation = {
      ...mutation,
      id: `mut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
    };
    queue.push(newMutation);
    this.persistQueue(queue);
    
    // Attempt sync soon
    if (this.isOnlineState && !this.isSyncPaused) {
      this.scheduleQueueProcess();
    }
  }

  public scheduleQueueProcess() {
    // Cancel any pending retry before scheduling a new one to prevent duplicate
    // concurrent sync attempts during connectivity flapping.
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
    const backoff = Math.min(1000 * Math.pow(2, this.syncRetryCount), 60000);
    const jitter = Math.random() * (backoff * 0.2);
    this.retryTimerId = setTimeout(() => {
      this.retryTimerId = null;
      if (this.isOnlineState && !this.isSyncPaused) {
        void this.processQueue();
      }
    }, backoff + jitter);
  }

  /** Release all timers and listeners. Call during hot-reload or teardown. */
  public dispose(): void {
    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
  }
  public clearQueue(): void {
    localStorage.removeItem(accountStorageKey("offline_mutations_queue"));
  }

  /** Remove the account's pending/dead-letter database and in-memory queues. */
  public async clearAccountStorage(): Promise<void> {
    this.setSyncPaused(true);
    this.inMemoryQueue = [];
    this.inMemoryDeadLetterQueue = [];
    this.syncRetryCount = 0;
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
    try {
      this.deadLetterDb?.close();
      this.deadLetterDb = null;
      this.deadLetterDbPromise = null;
      if (typeof indexedDB === "undefined") return;
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("BaghdadMedicalOfflineMutations");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    } catch {
      // Local cleanup is best effort and must not block logout/deletion.
    }
  }

  /**
   * Conflict Resolution with Timestamp Tracking:
   * Safely merges progress items by picking the newest 'lastAccessed'
   */
  public resolveConflicts(
    localProgress: UserProgress[],
    serverProgress: UserProgress[],
  ): UserProgress[] {
    const merged = new Map<string, UserProgress>();
    
    // Seed with server changes
    serverProgress.forEach((item) => merged.set(item.lectureId, item));
    
    const now = Date.now();
    const CLOCK_SKEW_THRESHOLD = 60000; // 1 minute future skew allowed
    
    // Merge local changes if they are newer and plausible
    localProgress.forEach((localItem) => {
      const serverItem = merged.get(localItem.lectureId);
      if (!serverItem) {
        merged.set(localItem.lectureId, localItem);
      } else {
        const localTime = new Date(localItem.lastAccessed || 0).getTime();
        const serverTime = new Date(serverItem.lastAccessed || 0).getTime();
        
        // Impossible future timestamp -> likely clock skew. Prefer server time.
        if (localTime > now + CLOCK_SKEW_THRESHOLD) {
           // Skip local, trust server
           return;
        }
        
        if (localTime > serverTime) {
          merged.set(localItem.lectureId, localItem);
        }
      }
    });
    return Array.from(merged.values());
  }

  /**
   * Automatic background synchronization logic:
   * Processes all pending mutations in structural sequence.
   */

  public async processQueue(): Promise<boolean> {
    if (!this.isOnlineState || this.isSyncPaused || this.isProcessingQueue) return false;
    
    // Global lock for both engines
    if ((window as any).__offlineSyncLock) return false;
    
    (window as any).__offlineSyncLock = true;
    this.isProcessingQueue = true;
    
    let processedAny = false;
    
    try {
      await this.hydrateDeadLetters();
      await this.hydratePendingQueue();
      const queue = this.getMutationQueue();
      if (queue.length === 0) {
        this.syncRetryCount = 0;
        return true;
      }
      
      const remaining: UnsyncedMutation[] = [];
      const deadLettered: UnsyncedMutation[] = [];
      
      window.dispatchEvent(
        new CustomEvent("offline-sync-status", {
          detail: { syncing: true, status: "Syncing", pendingCount: queue.length },
        }),
      );

      for (const mutation of queue) {
        try {
          let request: Promise<Response>;
          switch (mutation.type) {
            case "UPDATE_PROFILE":
              request = apiClient("/api/auth/update-profile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(mutation.payload),
                // Queue surfaces its own offline-sync-status toasts — avoid
                // duplicate global error toasts for the same failure.
                silent: true,
              });
              break;
            case "UPDATE_PROGRESS":
              request = apiClient("/api/auth/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userId: mutation.payload.userId,
                  progress: mutation.payload.progress,
                  pointsLogs: mutation.payload.pointsLogs || [],
                }),
                silent: true,
              });
              break;
            case "ADD_EVENT":
              request = apiClient("/api/calendar/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // clientId makes retried creates idempotent on the server side:
                // a duplicate that committed before a dropped response is not re-created.
                body: JSON.stringify({ ...mutation.payload, clientId: mutation.id }),
                silent: true,
              });
              break;
            case "DELETE_EVENT":
              request = apiClient(
                `/api/calendar/events/${mutation.payload}`,
                {
                  method: "DELETE",
                  silent: true,
                },
              );
              break;
            default:
              // Unknown mutation type — never discard silently. Preserve the data
              // in the DLQ so it can be inspected/recovered instead of being lost.
              this.addToDLQ({
                ...mutation,
                attempts: (mutation.attempts || 0) + 1,
                status: "failed",
                lastError: `Unknown mutation type: ${mutation.type}`,
              });
              deadLettered.push(mutation);
              continue;
          }

          const response = await request;
          if (!response.ok) throw response;
        } catch (err: any) {
          const status = err.status || (err.response && err.response.status) || 500;
          const attempts = (mutation.attempts || 0) + 1;

          if (status === 401 || status === 403 || status === 400 || status === 404 || status === 413 || status === 422) {
            // Permanent error -> terminal DLQ state. The change is preserved and
            // surfaced, but it must NEVER be reported as a successful sync.
            this.addToDLQ({
              ...mutation,
              attempts,
              status: "failed",
              lastError: `Rejected by server (HTTP ${status}).`,
            });
            deadLettered.push(mutation);
          } else if (attempts >= this.MAX_SYNC_ATTEMPTS) {
            // Transient error that exhausted the retry cap -> terminal DLQ state.
            // Prevents infinite retry loops while keeping the data for recovery.
            this.addToDLQ({
              ...mutation,
              attempts,
              status: "failed",
              lastError: `Could not sync after ${attempts} attempts.`,
            });
            deadLettered.push(mutation);
          } else {
            // Transient error -> retry with backoff, carrying the attempt count.
            remaining.push({ ...mutation, attempts });
            // Skip the rest of the queue this cycle to avoid hammering a flaky server.
            for (let j = queue.indexOf(mutation) + 1; j < queue.length; j++) {
              remaining.push(queue[j]);
            }
            break;
          }
        }
      }

      this.persistQueue(remaining);

      const fullyResolved = remaining.length === 0;
      const hasFailures = deadLettered.length > 0;

      window.dispatchEvent(
        new CustomEvent("offline-sync-status", {
          detail: {
            syncing: false,
            status: hasFailures ? "Failed" : fullyResolved ? "Resolved" : "Retrying",
            pendingCount: remaining.length,
            rejectedCount: deadLettered.length,
            completed: fullyResolved && !hasFailures,
          },
        }),
      );

      if (hasFailures) {
        // Deterministic failure surfacing: DLQ contents stay queryable for review.
        window.dispatchEvent(
          new CustomEvent("offline-sync-error", {
            detail: {
              message: `${deadLettered.length} saved change(s) were rejected and moved to the dead-letter queue for review.`,
              rejectedCount: deadLettered.length,
            },
          }),
        );
      }

      if (fullyResolved && !hasFailures) {
        this.syncRetryCount = 0;
        window.dispatchEvent(new Event("offline-sync-completed"));
        processedAny = true;
      } else {
        this.syncRetryCount++;
        this.scheduleQueueProcess();
      }
    } finally {
      this.isProcessingQueue = false;
      (window as any).__offlineSyncLock = false;
    }
    
    return processedAny;
  }

  /**
   * Requeues dead-lettered mutations so they can be retried after manual review.
   * Returns the number of mutations moved back into the active queue.
   */
  public async retryDeadLetter(): Promise<number> {
    await this.hydrateDeadLetters();
    const dlq = this.getDeadLetterQueue();
    if (dlq.length === 0) return 0;

    const requeued = dlq.map((m) => ({
      ...m,
      attempts: 0,
      status: "pending" as const,
      lastError: undefined,
    }));
    const requeuedIds = new Set(requeued.map((m) => m.id));

    if (!this.persistQueue([...this.getMutationQueue(), ...requeued])) {
      return 0;
    }

    const newDlq = dlq.filter((m) => !requeuedIds.has(m.id));
    try {
      localStorage.setItem(accountStorageKey("offline_dlq"), JSON.stringify(newDlq));
      this.inMemoryDeadLetterQueue = null;
    } catch(e) {
      this.inMemoryDeadLetterQueue = newDlq;
    }
    await this.removePersistentDeadLetters(Array.from(requeuedIds));

    if (this.isOnlineState && !this.isSyncPaused) {
      this.scheduleQueueProcess();
    }
    return requeued.length;
  }

}

export const OfflineEngine = new OfflineEngineClass();
window.addEventListener("load", () => {
  if (OfflineEngine.isOnline()) {
    OfflineEngine.processQueue();
  }
});
