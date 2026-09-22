import { useCallback, useEffect, useRef, useState } from "react";
import { getCalendarImportJob } from "./api";
import { CalendarImportJob } from "./types";

const terminal = (status?: string) => ["COMPLETED", "FAILED", "CANCELLED"].includes((status || "").toUpperCase());

export function useCalendarImportJob(jobId: string | null, intervalMs = 1500) {
  const [job, setJob] = useState<CalendarImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const refresh = useCallback(async () => {
    if (!jobId) return null;
    try {
      const next = await getCalendarImportJob(jobId);
      if (active.current) { setJob(next); setError(null); }
      return next;
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : "Unable to read import status.");
      return null;
    }
  }, [jobId]);
  useEffect(() => {
    active.current = true;
    if (!jobId) { setJob(null); return () => { active.current = false; }; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const next = await refresh();
      if (!active.current) return;
      if (next && terminal(next.status)) return;
      // A transient network/read failure must not permanently stop status polling.
      timer = setTimeout(poll, next ? intervalMs : Math.min(intervalMs * 2, 5000));
    };
    poll();
    return () => { active.current = false; if (timer) clearTimeout(timer); };
  }, [jobId, intervalMs, refresh]);
  return { job, error, refresh };
}