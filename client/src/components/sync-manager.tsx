import { useEffect, useRef, useState, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useTrackPage } from "@/hooks/use-track-page";
import { KeyRound, WifiOff } from "lucide-react";
import { ReactivateDialog } from "./reactivate-dialog";

function buildSyncWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/sync-ws`;
}

function getOrCreateDeviceId(): string {
  const key = "otto.deviceId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export default function SyncManager() {
  const { user } = useAuth();
  useTrackPage();
  const [connected, setConnected] = useState(true);
  const [desktopConfig, setDesktopConfig] = useState<any | null>(null);
  const [licenseSnapshot, setLicenseSnapshot] = useState<any | null>(null);
  const [overLimitInfo, setOverLimitInfo] = useState<{ allowed: number; connected: number; graceEndsAt: number | null } | null>(null);
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectRef = useRef<(() => void) | null>(null);

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
        // Close existing socket before reconnecting
        try { wsRef.current?.close(); } catch { /* ignore */ }

        const ws = new WebSocket(buildSyncWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          retryRef.current = 0;
          setConnected(true);
          try {
            ws.send(JSON.stringify({
              type: "device_register",
              deviceId: getOrCreateDeviceId(),
              label: navigator.userAgent.slice(0, 100),
            }));
          } catch { /* ignore */ }
          queryClient.invalidateQueries();
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(String(event.data || ""));
            if (data?.type === "office_updated") {
              queryClient.invalidateQueries();
            } else if (data?.type === "over_limit") {
              setOverLimitInfo({ allowed: data.allowed, connected: data.connected, graceEndsAt: data.graceEndsAt });
            } else if (data?.type === "under_limit") {
              setOverLimitInfo(null);
            } else if (data?.type === "device_blocked") {
              setDeviceBlocked(true);
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

    connectRef.current = connect;
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

  // Payment required banner — shown when portal indicates trial expired or subscription issue
  const paymentRequired = licenseSnapshot?.paymentRequired === true;
  const isDisabled = String(licenseSnapshot?.mode || "") === "DISABLED" || String(licenseSnapshot?.mode || "") === "READ_ONLY";
  const isInvalid = String(licenseSnapshot?.mode || "") === "INVALID";
  const [reactivateOpen, setReactivateOpen] = useState(false);

  // H-5: Single dialog instance — listen for open events from other components (e.g. HealthModal)
  useEffect(() => {
    const handler = () => setReactivateOpen(true);
    window.addEventListener("otto:openReactivate", handler);
    return () => window.removeEventListener("otto:openReactivate", handler);
  }, []);

  return (
    <>
      {/* License banners — mutually exclusive, INVALID takes priority */}
      {isInvalid ? (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            <KeyRound className="h-4 w-4 shrink-0" />
            <span className="flex-1 font-medium">License is no longer valid. Re-activate to restore full access. Your data is safe.</span>
            <button
              type="button"
              onClick={() => setReactivateOpen(true)}
              className="shrink-0 px-3 py-1 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              Re-activate
            </button>
          </div>
        </div>
      ) : isDisabled && paymentRequired ? (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            <span className="flex-1 font-medium">Your Otto trial has expired. Subscribe in the Otto portal to resume full access. Your data is safe and will be here when you return.</span>
          </div>
        </div>
      ) : paymentRequired ? (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
            <span className="flex-1">Your free trial has ended. Visit the Otto portal to subscribe and keep using Otto.</span>
          </div>
        </div>
      ) : null}
      <ReactivateDialog open={reactivateOpen} onOpenChange={setReactivateOpen} />

      {/* Device blocked — permanently disconnected */}
      {deviceBlocked && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            <span className="flex-1 font-medium">This computer has been disconnected from Otto. Contact your office administrator to reconnect.</span>
          </div>
        </div>
      )}

      {/* Over-limit banner for Client mode */}
      {!deviceBlocked && overLimitInfo && modeIsClient && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className={`flex items-center gap-2 border-b px-4 py-2 text-sm ${
            overLimitInfo.graceEndsAt && Date.now() > overLimitInfo.graceEndsAt
              ? "bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
              : "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
          }`}>
            <span className="flex-1">
              Your office has {overLimitInfo.connected} computers but your plan allows {overLimitInfo.allowed}.
              {overLimitInfo.graceEndsAt && Date.now() < overLimitInfo.graceEndsAt
                ? " Remove a computer within 24 hours or excess devices will become read-only."
                : " This computer is read-only until a device is removed."}
            </span>
            <button
              type="button"
              onClick={() => {
                try {
                  wsRef.current?.send(JSON.stringify({ type: "device_disconnect", deviceId: getOrCreateDeviceId() }));
                } catch { /* ignore */ }
              }}
              className="shrink-0 px-3 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700"
            >
              Disconnect This Computer
            </button>
          </div>
        </div>
      )}

      {/* Offline banner for Client mode */}
      {modeIsClient && !connected && (
        <div className="fixed bottom-[33px] left-0 right-0 z-50">
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/50 border-t border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span className="flex-1">Host is offline. Otto is read-only until Otto is opened back up on the main computer.</span>
            <button
              type="button"
              onClick={() => {
                retryRef.current = 0;
                if (connectRef.current) connectRef.current();
              }}
              className="shrink-0 px-3 py-1 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-700"
            >
              Reconnect
            </button>
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
            {modeIsClient && !connected && (
              <button
                type="button"
                onClick={() => {
                  retryRef.current = 0;
                  if (connectRef.current) connectRef.current();
                }}
                className="text-primary hover:underline font-medium"
              >
                Reconnect
              </button>
            )}
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
