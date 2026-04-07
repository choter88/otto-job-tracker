import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

const PATH_TO_EVENT: Record<string, string> = {
  "/": "tab_worklist",
  "/important": "tab_important",
  "/past-jobs": "tab_past_jobs",
  "/overdue": "tab_overdue",
  "/analytics": "tab_analytics",
  "/team": "tab_team",
};

/**
 * Tracks page navigation events by sending them to POST /api/track.
 * Fire-and-forget — failures are silently ignored.
 * Call once in the top-level layout component.
 */
export function useTrackPage(): void {
  const [location] = useLocation();
  const lastTracked = useRef<string>("");

  useEffect(() => {
    const eventType = PATH_TO_EVENT[location];
    if (!eventType || eventType === lastTracked.current) return;
    lastTracked.current = eventType;

    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ eventType }),
    }).catch(() => {});
  }, [location]);
}
