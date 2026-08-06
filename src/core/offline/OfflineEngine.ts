import { safeJsonParse } from "../../core/utils/safeJson";
import { SecureStorage } from "../utils/secureStorage";
import { apiClient } from "../../core/api/apiClient";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
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
}

class OfflineEngineClass {
  private listeners: Set<(online: boolean) => void> = new Set();
  private isOnlineState: boolean = navigator.onLine;
  private isSyncPaused: boolean = false;
  /** Handle for the periodic ping interval so it can be cleared on dispose. */
  private pingIntervalId: ReturnType<typeof setInterval> | null = null;
  /** Handle for the pending retry timer to prevent duplicate schedules. */
  private retryTimerId: ReturnType<typeof setTimeout> | null = null;

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
    if (this.isOnlineState !== online) {
      this.isOnlineState = online;
      this.listeners.forEach((cb) => cb(online));
      if (online) {
        this.scheduleQueueProcess();
      } else {
        
      }
    } }

  private async pingServer() {
    // Skip while the tab is hidden — the browser online/offline events handle
    // reconnection detection, so background pings are pure waste.
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const response = await apiClient("/api/health", {
        method: "HEAD",
        cache: "no-cache",
      });
      this.handleConnectivityChange(response.ok);
    } catch {
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
      return saved ? safeJsonParse(saved, null) : [];
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
      return saved ? safeJsonParse(saved, null) : {};
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
      const saved = localStorage.getItem("calendar_events");
      return saved ? safeJsonParse(saved, null) : [];
    } catch {
      return [];
    }
  }

  public setCachedCalendarEvents(events: CalendarEvent[]): void {
    try { localStorage.setItem("calendar_events", JSON.stringify(events)); } catch(e){}
  }

  public getCachedProgress(): UserProgress[] {
    try {
      const saved = localStorage.getItem("progress_db");
      return saved ? safeJsonParse(saved, null) : [];
    } catch {
      return [];
    }
  }

  public setCachedProgress(progress: UserProgress[]): void {
    try { localStorage.setItem("progress_db", JSON.stringify(progress)); } catch(e){}
  }

  public getCachedPointsLogs(): PointsLog[] {
    try {
      const saved = localStorage.getItem("points_log");
      return saved ? safeJsonParse(saved, null) : [];
    } catch {
      return [];
    }
  }

  public setCachedPointsLogs(logs: PointsLog[]): void {
    try { localStorage.setItem("points_log", JSON.stringify(logs)); } catch(e){}
  }

  // --- Queue Failed Requests (Queue and Background Sync) ---

  private inMemoryQueue: UnsyncedMutation[] | null = null;
  private syncRetryCount = 0;
  private isProcessingQueue = false;

  public getDeadLetterQueue(): UnsyncedMutation[] {
    try {
      const saved = localStorage.getItem("offline_dlq");
      return saved ? safeJsonParse(saved, null) : [];
    } catch {
      return [];
    }
  }

  public addToDLQ(mutation: UnsyncedMutation): void {
    const dlq = this.getDeadLetterQueue();
    dlq.push(mutation);
    try { localStorage.setItem("offline_dlq", JSON.stringify(dlq)); } catch(e) {}
  }

  private persistQueue(queue: UnsyncedMutation[]): boolean {
    try { 
      localStorage.setItem("offline_mutations_queue", JSON.stringify(queue));
      this.inMemoryQueue = null;
      return true;
    } catch(e: any) {
      if (e.name === "QuotaExceededError" || e.code === 22) {
        this.inMemoryQueue = queue; // Keep in memory
        this.setSyncPaused(true);
        window.dispatchEvent(new CustomEvent("offline-sync-error", { detail: { message: "Local storage full. Free up space to save offline changes." } }));
      }
      return false;
    }
  }

  public getMutationQueue(): UnsyncedMutation[] {
    if (this.inMemoryQueue) return this.inMemoryQueue;
    try {
      const saved = localStorage.getItem("offline_mutations_queue");
      if (!saved) return [];
      const parsed = safeJsonParse<UnsyncedMutation[]>(saved, null);
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
    localStorage.removeItem("offline_mutations_queue");
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
      const queue = this.getMutationQueue();
      if (queue.length === 0) {
        this.syncRetryCount = 0;
        return true;
      }
      
      const remaining: UnsyncedMutation[] = [];
      
      window.dispatchEvent(
        new CustomEvent("offline-sync-status", {
          detail: { syncing: true, status: "Syncing", pendingCount: queue.length },
        }),
      );

      for (const mutation of queue) {
        let success = false;
        try {
          switch (mutation.type) {
            case "UPDATE_PROFILE":
              const profileRes = await apiClient("/api/auth/update-profile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(mutation.payload),
              });
              if (!profileRes.ok) throw profileRes;
              success = true;
              break;
            case "UPDATE_PROGRESS":
              const syncRes = await apiClient("/api/auth/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userId: mutation.payload.userId,
                  progress: mutation.payload.progress,
                  pointsLogs: mutation.payload.pointsLogs || [],
                }),
              });
              if (!syncRes.ok) throw syncRes;
              success = true;
              break;
            case "ADD_EVENT":
              const addRes = await apiClient("/api/calendar/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(mutation.payload),
              });
              if (!addRes.ok) throw addRes;
              success = true;
              break;
            case "DELETE_EVENT":
              const delRes = await apiClient(
                `/api/calendar/events/${mutation.payload}`,
                {
                  method: "DELETE",
                },
              );
              if (!delRes.ok) throw delRes;
              success = true;
              break;
            default:
              success = true; // Unknown mutation type, discard to avoid lockups
          }
        } catch (err: any) {
          success = false;
          const status = err.status || (err.response && err.response.status) || 500;
          
          if (status === 401 || status === 403 || status === 400 || status === 404 || status === 422) {
             // Permanent Error -> DLQ
             this.addToDLQ(mutation);
             window.dispatchEvent(new CustomEvent("offline-sync-status", { detail: { status: "Failed", message: "A saved change was rejected by the server." } }));
             success = true; // Pretend success so it is removed from remaining queue
          } else {
             // Transient Error -> Retry
             remaining.push(mutation);
             // Skip the rest in this cycle
             for (let j = queue.indexOf(mutation) + 1; j < queue.length; j++) {
               remaining.push(queue[j]);
             }
             break;
          }
        }
        
        if (!success) {
          remaining.push(mutation);
        }
      }

      this.persistQueue(remaining);

      window.dispatchEvent(
        new CustomEvent("offline-sync-status", {
          detail: {
            syncing: false,
            status: remaining.length === 0 ? "Resolved" : "Retrying",
            pendingCount: remaining.length,
            completed: remaining.length === 0,
          },
        }),
      );

      if (remaining.length === 0) {
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

}

export const OfflineEngine = new OfflineEngineClass();
window.addEventListener("load", () => {
  if (OfflineEngine.isOnline()) {
    OfflineEngine.processQueue();
  }
});
