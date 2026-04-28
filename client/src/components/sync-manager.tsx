import { useEffect, useRef, useState, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useTrackPage } from "@/hooks/use-track-page";
import { WifiOff } from "lucide-react";

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
  const modeIsClient = mode === "client";

  // Payment required banner — shown when portal indicates trial expired or subscription issue
  const paymentRequired = licenseSnapshot?.paymentRequired === true;
  const isDisabled = String(licenseSnapshot?.mode || "") === "DISABLED" || String(licenseSnapshot?.mode || "") === "READ_ONLY";
  const portalBillingUrl = typeof licenseSnapshot?.portalBillingUrl === "string"
    ? licenseSnapshot.portalBillingUrl
    : null;

  const openPortalBilling = () => {
    if (!portalBillingUrl) return;
    const bridge = (window as any).otto;
    if (bridge && typeof bridge.openExternal === "function") {
      bridge.openExternal(portalBillingUrl).catch(() => { /* ignore */ });
    }
  };

  return (
    <>
      {/* Payment required banner — non-blocking, visible on all screens */}
      {paymentRequired && !isDisabled && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
            <span className="flex-1">Your free trial has ended. Subscribe to keep using Otto.</span>
            {portalBillingUrl && (
              <button
                type="button"
                onClick={openPortalBilling}
                className="shrink-0 px-3 py-1 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-700"
              >
                Subscribe
              </button>
            )}
          </div>
        </div>
      )}

      {/* Disabled/read-only banner for expired trial + grace */}
      {isDisabled && paymentRequired && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            <span className="flex-1 font-medium">Your Otto trial has expired. Subscribe to resume full access. Your data is safe and will be here when you return.</span>
            {portalBillingUrl && (
              <button
                type="button"
                onClick={openPortalBilling}
                className="shrink-0 px-3 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700"
              >
                Subscribe
              </button>
            )}
          </div>
        </div>
      )}

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
        <div className="fixed bottom-0 left-0 right-0 z-50">
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

      {/* Bottom status bar removed — connection / backup / license state
          surfaces through the topbar "Host healthy" pill and through banners
          above the main viewport when something needs attention. The chrome
          itself wasn't earning its real estate. */}
    </>
  );
}
