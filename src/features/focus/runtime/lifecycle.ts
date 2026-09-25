import { NativeBridge } from "../../../core/device/capacitor/nativeBridge";

type LifecycleListener = (event: Event) => void;

interface LifecycleEventTarget {
  addEventListener(type: string, listener: LifecycleListener): void;
  removeEventListener(type: string, listener: LifecycleListener): void;
}

interface LifecycleDocument extends LifecycleEventTarget {
  visibilityState: DocumentVisibilityState;
}

export interface NativeFocusLifecycleBridge {
  isNativePlatform(): boolean;
  addAppLifecycleListener(onChange: (isActive: boolean) => void): () => void;
  onNetworkChange(onChange: (isOnline: boolean) => void): () => void;
}

export interface FocusLifecycle {
  subscribe(
    onForeground: () => void | Promise<void>,
    onBackground?: () => void,
  ): () => void;
}

export interface FocusLifecycleOptions {
  windowTarget?: LifecycleEventTarget | null;
  documentTarget?: LifecycleDocument | null;
  nativeBridge?: NativeFocusLifecycleBridge;
  debounceMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

function safelyRun(callback: () => void | Promise<void>): void {
  try {
    const result = callback();
    if (result && typeof result.then === "function") {
      void result.catch(() => {});
    }
  } catch {
    // Lifecycle reconciliation is best effort; controller state reports failures.
  }
}

/**
 * Coalesces foreground/reconnect events. It never sends a Focus mutation.
 */
export function createFocusLifecycle(
  options: FocusLifecycleOptions = {},
): FocusLifecycle {
  const windowTarget = options.windowTarget === undefined
    ? (typeof window === "undefined" ? null : window)
    : options.windowTarget;
  const documentTarget = options.documentTarget === undefined
    ? (typeof document === "undefined" ? null : document)
    : options.documentTarget;
  const nativeBridge = options.nativeBridge ?? NativeBridge;
  const debounceMs = Math.max(0, options.debounceMs ?? 180);
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));

  return {
    subscribe(onForeground, onBackground) {
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanups: Array<() => void> = [];

      const schedule = () => {
        if (disposed || timer !== null) return;
        timer = setTimer(() => {
          timer = null;
          if (!disposed) safelyRun(onForeground);
        }, debounceMs);
      };

      const handleVisibility: LifecycleListener = () => {
        if (documentTarget?.visibilityState === "visible") schedule();
        else onBackground?.();
      };
      const handlePageShow: LifecycleListener = () => schedule();
      const handleOnline: LifecycleListener = () => schedule();

      if (documentTarget && !nativeBridge.isNativePlatform()) {
        documentTarget.addEventListener("visibilitychange", handleVisibility);
        cleanups.push(() =>
          documentTarget.removeEventListener("visibilitychange", handleVisibility),
        );
      }

      if (windowTarget) {
        windowTarget.addEventListener("pageshow", handlePageShow);
        windowTarget.addEventListener("online", handleOnline);
        cleanups.push(() => {
          windowTarget.removeEventListener("pageshow", handlePageShow);
          windowTarget.removeEventListener("online", handleOnline);
        });
      }

      if (nativeBridge.isNativePlatform()) {
        cleanups.push(nativeBridge.addAppLifecycleListener((isActive) => {
          if (isActive) schedule();
          else onBackground?.();
        }));

        let registeringNetworkListener = true;
        const removeNetworkListener = nativeBridge.onNetworkChange((isOnline) => {
          if (registeringNetworkListener) return;
          if (isOnline) schedule();
        });
        registeringNetworkListener = false;
        cleanups.push(removeNetworkListener);
      }

      return () => {
        if (disposed) return;
        disposed = true;
        if (timer !== null) {
          clearTimer(timer);
          timer = null;
        }
        cleanups.splice(0).forEach((cleanup) => cleanup());
      };
    },
  };
}