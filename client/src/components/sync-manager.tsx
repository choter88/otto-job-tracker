import { useEffect, useRef, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { WifiOff } from "lucide-react";

function buildSyncWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/sync-ws`;
}

export default function SyncManager() {
  const { user } = useAuth();
  const [connected, setConnected] = useState(true);
  const [desktopConfig, setDesktopConfig] = useState<any | null>(null);
  const [licenseSnapshot, setLicenseSnapshot] = useState<any | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  // Load desktop config (mode, backup info)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const bridge = (window as any)?.otto;
        if (!bridge?.getConfig) return;
        const cfg = await bridge.getConfig();
        if (!cancelled) setDesktopConfig(cfg);
      } catch { /* ignore */ }
    };

    load();
    const timer = window.setInterval(load, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [user?.id]);

  // Load license status
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/license/status", { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (!cancelled) setLicenseSnapshot(json);
      } catch { /* ignore */ }
    };

    load();
    const timer = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [user?.id]);

  // WebSocket connection with auto-reconnect (exponential backoff)
  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed || !user) return;
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
          queryClient.invalidateQueries();
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(String(event.data || ""));
            if (data?.type === "office_updated") {
              queryClient.invalidateQueries();
            }
          } catch { /* ignore */ }
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
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [user?.id]);

  if (!user) return null;

  const mode = String(desktopConfig?.mode || "").toLowerCase();
  const modeLabel = mode === "host" ? "Host" : mode === "client" ? "Client" : "Otto Tracker";
  const modeIsClient = mode === "client";
  const connectionLabel = modeIsClient
    ? (connected ? "Connected" : "Offline — view only")
    : "Local";

  const backupInfo = (() => {
    if (mode !== "host") return null;

    const networkEnabled = desktopConfig?.backupEnabled !== false;
    const localEnabled = desktopConfig?.localBackupEnabled !== false;
    const hasNetworkFolder = Boolean(desktopConfig?.backupDir);

    if (!networkEnabled && !localEnabled) {
      return { label: "Backups: disabled", warn: false };
    }

    if (networkEnabled && hasNetworkFolder) {
      if (desktopConfig?.backupLastError) return { label: "Backups: error", warn: true };
      if (desktopConfig?.backupLastAt) {
        return { label: `Backups: last ${new Date(desktopConfig.backupLastAt).toLocaleDateString()}`, warn: false };
      }
      return { label: "Backups: configured", warn: false };
    }

    if (!localEnabled) {
      return { label: networkEnabled ? "Backups: not set up" : "Backups: disabled", warn: networkEnabled };
    }

    if (desktopConfig?.localBackupLastError) return { label: "Backups: local error", warn: true };
    if (desktopConfig?.localBackupLastAt) {
      return {
        label: `Backups: local ${new Date(desktopConfig.localBackupLastAt).toLocaleDateString()}`,
        warn: networkEnabled,
      };
    }

    return { label: "Backups: local only", warn: networkEnabled };
  })();

  const backupLabel = backupInfo?.label || null;
  const backupWarn = Boolean(backupInfo?.warn);

  const licenseLabel =
    licenseSnapshot && String(licenseSnapshot.mode || "") !== "ACTIVE" ? String(licenseSnapshot.message || "") : null;

  const connectionDotClass = !modeIsClient
    ? "bg-emerald-500"
    : connected
      ? "bg-emerald-500"
      : "bg-destructive";

  return (
    <>
      {/* Offline banner for Client mode */}
      {modeIsClient && !connected && (
        <div className="fixed bottom-[33px] left-0 right-0 z-50">
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/50 border-t border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>Host is offline. You can view existing data but changes require the Host to be running.</span>
          </div>
        </div>
      )}

      {/* Bottom status bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex items-center justify-between gap-4 px-4 py-2 text-xs">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-medium text-foreground">{modeLabel}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${connectionDotClass}`} />
              {connectionLabel}
            </span>
          </div>

          <div className="flex items-center gap-3 min-w-0 text-muted-foreground">
            {backupLabel && (
              <span className={backupWarn ? "text-amber-600 dark:text-amber-400" : ""}>
                {backupLabel}
              </span>
            )}
            {licenseLabel && <span className="text-amber-600 dark:text-amber-400">{licenseLabel}</span>}
          </div>
        </div>
      </div>
    </>
  );
}
