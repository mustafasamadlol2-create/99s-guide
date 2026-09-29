import { useCallback, useEffect, useRef, useState } from "react";
import { getSystemHealthSnapshot } from "./api";
import type { SystemHealthSnapshot } from "../../../server/observability/types.js";

const REFRESH_INTERVAL_MS = 60_000;

export function useSystemHealth() {
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const next = await getSystemHealthSnapshot();
      setSnapshot(next);
      setFailedAt(null);
    } catch {
      setFailedAt(Date.now());
    } finally {
      setLoading(false);
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { snapshot, loading, refreshing, failedAt, refresh };
}