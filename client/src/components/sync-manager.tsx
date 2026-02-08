import { useEffect, useRef, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { subscribeOutbox, flushOutbox } from "@/lib/offline-outbox";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

function buildSyncWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/sync-ws`;
}

export default function SyncManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [connected, setConnected] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const offlineToastAtRef = useRef(0);
  const pendingCountRef = useRef(0);
  const syncingRef = useRef(false);

  useEffect(() => {
    pendingCountRef.current = pendingCount;
  }, [pendingCount]);

  useEffect(() => {
    syncingRef.current = syncing;
  }, [syncing]);

  useEffect(() => {
    return subscribeOutbox((items) => {
      const origin = window.location.origin;
      setPendingCount(items.filter((i) => i.origin === origin).length);
    });
  }, []);

  useEffect(() => {
    const handler = () => {
      const now = Date.now();
      if (now - offlineToastAtRef.current < 4000) return;
      offlineToastAtRef.current = now;
      toast({
        title: "Saved offline",
        description: "This change will sync automatically when the connection returns.",
      });
    };

    window.addEventListener("otto:offlineQueued", handler as any);
    return () => window.removeEventListener("otto:offlineQueued", handler as any);
  }, [toast]);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      if (!user) return;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      try {
        const ws = new WebSocket(buildSyncWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          retryRef.current = 0;
          setConnected(true);
          setSyncError(null);
          queryClient.invalidateQueries();
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(String(event.data || ""));
            if (data?.type === "office_updated") {
              queryClient.invalidateQueries();
            }
          } catch {
            // ignore
          }
        };

        const onCloseOrError = () => {
          if (disposed) return;
          setConnected(false);
          retryRef.current += 1;
          const backoffMs = Math.min(10_000, 500 * Math.pow(2, Math.min(5, retryRef.current)));
          reconnectTimerRef.current = window.setTimeout(connect, backoffMs);
        };

        ws.onerror = onCloseOrError;
        ws.onclose = onCloseOrError;
      } catch {
        setConnected(false);
        reconnectTimerRef.current = window.setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    if (!connected) return;
    if (syncingRef.current) return;
    if (pendingCountRef.current <= 0) return;

    setSyncing(true);
    void flushOutbox(window.location.origin)
      .then((result) => {
        setSyncing(false);
        if (result.flushed > 0) {
          toast({
            title: "Synced changes",
            description: `Synced ${result.flushed} offline change${result.flushed === 1 ? "" : "s"}.`,
          });
          queryClient.invalidateQueries();
        }
        if (result.lastError) {
          setSyncError(result.lastError);
        }
      })
      .catch(() => {
        setSyncing(false);
      });
  }, [user?.id, connected, pendingCount, toast]);

  if (!user) return null;

  if (!connected) {
    return (
      <div className="fixed bottom-4 left-4 z-50 rounded-md border bg-destructive px-3 py-2 text-sm text-destructive-foreground shadow">
        Disconnected from Host. Changes won’t save until connection returns.
      </div>
    );
  }

  if (pendingCount > 0 || syncing || syncError) {
    const text = syncing
      ? `Syncing offline changes… (${pendingCount})`
      : syncError
        ? `Sync paused: ${syncError}`
        : `Offline changes pending sync: ${pendingCount}`;

    return (
      <div className="fixed bottom-4 left-4 z-50 rounded-md border bg-amber-500 px-3 py-2 text-sm text-white shadow">
        {text}
      </div>
    );
  }

  return null;
}
