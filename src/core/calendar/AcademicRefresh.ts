export type AcademicResource = "materials" | "lectures" | "calendar";
export type AcademicRefreshMode = "restore" | "revalidate" | "invalidate";

export type AcademicRead = {
  signal: AbortSignal;
  requestKey: string;
  isCurrent: () => boolean;
};

type RefreshState = {
  revision: number;
  completedAt?: number;
  running?: Promise<void>;
  next?: Promise<void>;
};

export class AcademicRefresh {
  private scope: string | null = null;
  private generation = 0;
  private controller = new AbortController();
  private reads = new Map<AcademicResource, RefreshState>();

  constructor(private readonly now = Date.now) {}

  setScope(scope: string | null): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    this.reads.clear();
  }

  isReading(resource: AcademicResource): boolean {
    return !!this.reads.get(resource)?.running;
  }

  refresh(
    resource: AcademicResource,
    mode: AcademicRefreshMode,
    load: (read: AcademicRead) => Promise<boolean>,
  ): Promise<void> {
    if (!this.scope) return Promise.resolve();
    let state = this.reads.get(resource);
    if (!state) {
      state = { revision: 0 };
      this.reads.set(resource, state);
    }
    if (state.next) return state.next;
    if (state.running && mode !== "invalidate") return state.running;
    if (mode !== "invalidate" && state.completedAt !== undefined && this.now() - state.completedAt < 15_000) {
      return Promise.resolve();
    }
    if (mode === "invalidate") state.completedAt = undefined;

    const signal = this.controller.signal;
    const revision = ++state.revision;
    const requestKey = `academic:${this.generation}:${resource}:${revision}`;
    const isCurrent = () => !signal.aborted && state.revision === revision;
    const run = () => {
      state.next = undefined;
      if (!isCurrent()) return Promise.resolve();
      const task = Promise.resolve().then(() => load({ signal, requestKey, isCurrent })).then(
        (fresh) => { if (fresh && isCurrent()) state.completedAt = this.now(); },
        () => {},
      ).finally(() => { if (state.running === task) state.running = undefined; });
      state.running = task;
      return task;
    };
    if (state.running) {
      state.next = state.running.then(run);
      return state.next;
    }
    return run();
  }
}

// Keep the existing missed-update bound while the page is visible. Browser
// focus and visibility can arrive together, but either event owns one timer.
export function watchVisibleAcademicRefresh(
  refresh: () => void,
  page: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document,
  view: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (refreshNow: boolean) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (page.visibilityState !== "visible") return;
    if (refreshNow) refresh();
    timer = setTimeout(() => schedule(true), 3 * 60_000);
  };
  const onVisibility = () => schedule(true);
  const onFocus = () => { if (page.visibilityState === "visible") refresh(); };
  schedule(false);
  page.addEventListener("visibilitychange", onVisibility);
  view.addEventListener("focus", onFocus);
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    page.removeEventListener("visibilitychange", onVisibility);
    view.removeEventListener("focus", onFocus);
  };
}
