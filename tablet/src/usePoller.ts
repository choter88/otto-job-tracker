import { useEffect, useRef, useCallback, useState } from "react";
import { fetchPoll, sendHeartbeat, retryQueuedMutations, getQueuedMutationCount } from "./api";

interface PollerState {
  connected: boolean;
  stale: boolean;
  lastPollAt: number;
}

export function usePoller(
  onDataChanged: () => void,
  enabled: boolean,
  intervalMs = 5000,
) {
  const lastModifiedRef = useRef<number>(0);
  const lastSuccessRef = useRef<number>(Date.now());
  const [state, setState] = useState<PollerState>({
    connected: true,
    stale: false,
    lastPollAt: Date.now(),
  });

  const poll = useCallback(async () => {
    try {
      const { lastModified } = await fetchPoll();
      const now = Date.now();
      lastSuccessRef.current = now;

      setState({ connected: true, stale: false, lastPollAt: now });

      if (lastModified > lastModifiedRef.current) {
        lastModifiedRef.current = lastModified;
        onDataChanged();
      }

      // Retry queued mutations on reconnection
      if (getQueuedMutationCount() > 0) {
        await retryQueuedMutations();
      }

      // Send heartbeat alongside poll
      sendHeartbeat().catch(() => {});
    } catch {
      const now = Date.now();
      const secondsSinceSuccess = (now - lastSuccessRef.current) / 1000;
      setState({
        connected: false,
        stale: secondsSinceSuccess > 30,
        lastPollAt: now,
      });
    }
  }, [onDataChanged]);

  useEffect(() => {
    if (!enabled) return;

    // Initial poll
    poll();

    const id = setInterval(poll, intervalMs);
    return () => clearInterval(id);
  }, [poll, enabled, intervalMs]);

  return state;
}
