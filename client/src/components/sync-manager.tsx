import { useEffect, useRef, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useTrackPage } from "@/hooks/use-track-page";
import { WifiOff, ServerCog, Loader2 } from "lucide-react";

// Reconnect failures before we ask the portal "did this office's
// Host change?". 3 consecutive failed reconnect attempts ≈ a few
// seconds of unsuccessful retries; the WS already does exponential
// backoff between attempts. Lower numbers risk noisy lookups during
// transient LAN blips; higher numbers leave staff staring at the
// offline banner longer than necessary after a real Host
// replacement.
const RECOVERY_LOOKUP_THRESHOLD = 3;

function buildSyncWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/sync-ws`;
}

// Exported: the order-sheet watcher heartbeat reports under the same
// per-machine id so the "Watching from" panel can join user-set device
// names from the Computers tab.
export function getOrCreateDeviceId(): string {
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
  // Host-replacement recovery banner state. `pending` means we've
  // confirmed via the portal that the office's Host moved; `applying`
  // means the user tapped "Reconnect" and we're swapping config.
  const [hostRecovery, setHostRecovery] = useState<
    | { pending: true; hostUrl: string; fingerprint256: string; updatedAt: string | null }
    | null
  >(null);
  const [recoveryRevoked, setRecoveryRevoked] = useState(false);
  const [applyingRecovery, setApplyingRecovery] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  // Guards repeated lookups while a single reconnect storm runs.
  const recoveryLookupInFlightRef = useRef(false);
  const recoveryLookupAttemptedRef = useRef(false);
  // Mirror state into refs so the WS close handler (a closure that
  // captures values at definition time) reads the latest values
  // instead of stale ones from the initial render.
  const hostRecoveryRef = useRef(hostRecovery);
  const recoveryRevokedRef = useRef(recoveryRevoked);
  const modeIsClientRef = useRef(false);
  useEffect(() => { hostRecoveryRef.current = hostRecovery; }, [hostRecovery]);
  useEffect(() => { recoveryRevokedRef.current = recoveryRevoked; }, [recoveryRevoked]);
  useEffect(() => {
    modeIsClientRef.current = String(desktopConfig?.mode || "").toLowerCase() === "client";
  }, [desktopConfig?.mode]);

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
          // Successful reconnect — let the next outage trigger a fresh
          // portal lookup if needed (most outages are LAN blips and
          // never reach the threshold; this just resets the guard so
          // the NEXT real outage can lookup once).
          recoveryLookupAttemptedRef.current = false;
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
            } else if (data?.type === "recovery_token_issued" && typeof data.recoveryToken === "string") {
              // Host just issued us a recovery token (first WS
              // register, or re-issued because we never had one).
              // Persist via Electron — the renderer never holds the
              // plaintext token.
              const bridge = (window as any)?.otto;
              if (bridge?.storeRecoveryToken) {
                bridge.storeRecoveryToken({ recoveryToken: data.recoveryToken })
                  .catch(() => { /* non-critical */ });
              }
            }
          } catch { /* ignore */ }
        };

        const onCloseOrError = () => {
          if (disposed) return;
          setConnected(false);
          retryRef.current += 1;

          // After a few failed reconnects, ask the portal whether
          // the office's Host has moved. We only ever fire this ONCE
          // per offline-streak (the attempted ref clears on a
          // successful onopen) so a long outage doesn't pound the
          // portal. Client-mode only — Host's own renderer talks to
          // localhost and never needs recovery.
          if (
            modeIsClientRef.current
            && retryRef.current >= RECOVERY_LOOKUP_THRESHOLD
            && !recoveryLookupInFlightRef.current
            && !recoveryLookupAttemptedRef.current
            && !hostRecoveryRef.current
            && !recoveryRevokedRef.current
          ) {
            recoveryLookupInFlightRef.current = true;
            recoveryLookupAttemptedRef.current = true;
            const bridge = (window as any)?.otto;
            if (bridge?.lookupRecovery) {
              bridge.lookupRecovery()
                .then((result: any) => {
                  if (result?.ok && result.changed && result.hostUrl && result.fingerprint256) {
                    setHostRecovery({
                      pending: true,
                      hostUrl: result.hostUrl,
                      fingerprint256: result.fingerprint256,
                      updatedAt: result.updatedAt ?? null,
                    });
                  } else if (!result?.ok && result?.code === "REVOKED") {
                    setRecoveryRevoked(true);
                  }
                })
                .catch(() => { /* non-critical */ })
                .finally(() => { recoveryLookupInFlightRef.current = false; });
            } else {
              recoveryLookupInFlightRef.current = false;
            }
          }

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

  // Force an immediate license check-in (instead of waiting for the periodic
  // one) so a portal-side change — e.g. an extended trial or a new
  // subscription — is reflected right away. Owner-only on the server.
  // NOTE: plain function, not useCallback — this lives below the `if (!user)`
  // early return, so a hook here would violate the Rules of Hooks (React #310).
  const handleRecheck = async () => {
    setRechecking(true);
    setRecheckMsg(null);
    try {
      const res = await fetch("/api/license/checkin", { method: "POST", credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        setRecheckMsg("Only the Host owner can re-check the license. Ask them to do this on the Host.");
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setRecheckMsg(j?.error || "Couldn't reach the licensing server. Check this computer's internet connection, then try again.");
        return;
      }
      // Re-pull the full snapshot (includes portalBillingUrl) so the banner re-evaluates.
      const statusRes = await fetch("/api/license/status", { credentials: "include" });
      const snapshot = await statusRes.json().catch(() => null);
      if (snapshot) setLicenseSnapshot(snapshot);
    } catch {
      setRecheckMsg("Couldn't reach the licensing server. Check this computer's internet connection, then try again.");
    } finally {
      setRechecking(false);
    }
  };

  const renderRecheckButton = (tone: "amber" | "red") => (
    <button
      type="button"
      onClick={handleRecheck}
      disabled={rechecking}
      data-testid="button-recheck-license"
      className={
        tone === "red"
          ? "shrink-0 inline-flex items-center gap-1.5 px-3 py-1 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-200 text-xs font-medium rounded hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50"
          : "shrink-0 inline-flex items-center gap-1.5 px-3 py-1 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs font-medium rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
      }
    >
      {rechecking && <Loader2 className="w-3 h-3 animate-spin" />}
      {rechecking ? "Checking…" : "Re-check now"}
    </button>
  );

  return (
    <>
      {/* Payment required banner — non-blocking, visible on all screens */}
      {paymentRequired && !isDisabled && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <span className="flex-1">Your free trial has ended. Subscribe to keep using Otto.</span>
              {renderRecheckButton("amber")}
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
            {recheckMsg && <p className="mt-1 text-xs opacity-90">{recheckMsg}</p>}
          </div>
        </div>
      )}

      {/* Disabled/read-only banner for expired trial + grace */}
      {isDisabled && paymentRequired && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium">Your Otto trial has expired. Subscribe to resume full access. Your data is safe and will be here when you return.</span>
              {renderRecheckButton("red")}
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
            {recheckMsg && <p className="mt-1 text-xs opacity-90">{recheckMsg}</p>}
          </div>
        </div>
      )}

      {/* Read-only not tied to billing — e.g. check-in overdue or the licensing
          server is unreachable. Surface the real message + a way to retry. */}
      {isDisabled && !paymentRequired && !deviceBlocked && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <span className="flex-1">{licenseSnapshot?.message || "Otto is in read-only mode while it reconnects to the licensing server."}</span>
              {renderRecheckButton("amber")}
            </div>
            {recheckMsg && <p className="mt-1 text-xs opacity-90">{recheckMsg}</p>}
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

      {/* Host-replacement recovery banner. Shown when portal lookup
          confirmed this office's Host moved to a new URL/fingerprint
          while we were offline. One-tap "Reconnect" applies the new
          discovery info to Electron config and reloads. */}
      {modeIsClient && hostRecovery && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-3 bg-otto-accent-soft border-b border-otto-accent/30 px-4 py-3 text-sm text-otto-accent-ink">
            <ServerCog className="h-4 w-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Your office's Host computer changed.</div>
              <div className="text-xs opacity-80 mt-0.5">
                Reconnect this Client to keep working. Your data stays on the new Host computer.
              </div>
            </div>
            <button
              type="button"
              disabled={applyingRecovery}
              onClick={async () => {
                if (!hostRecovery) return;
                setApplyingRecovery(true);
                try {
                  const bridge = (window as any)?.otto;
                  if (!bridge?.applyRecovery) {
                    setApplyingRecovery(false);
                    return;
                  }
                  const result = await bridge.applyRecovery({
                    hostUrl: hostRecovery.hostUrl,
                    fingerprint256: hostRecovery.fingerprint256,
                  });
                  if (!result?.ok) {
                    setApplyingRecovery(false);
                  }
                  // On success, Electron reloads the BrowserWindow,
                  // so this component unmounts before reset is needed.
                } catch {
                  setApplyingRecovery(false);
                }
              }}
              className="shrink-0 px-3 py-1.5 bg-otto-accent text-white text-xs font-medium rounded hover:opacity-95 disabled:opacity-60 inline-flex items-center gap-1.5"
              data-testid="button-host-recovery-reconnect"
            >
              {applyingRecovery && <Loader2 className="h-3 w-3 animate-spin" />}
              {applyingRecovery ? "Reconnecting…" : "Reconnect"}
            </button>
          </div>
        </div>
      )}

      {/* Recovery token revoked — this Client was removed from the
          office. They need staff action to re-pair. */}
      {modeIsClient && recoveryRevoked && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            <span className="flex-1 font-medium">
              This Client was removed from your office. Contact your office to re-pair this computer.
            </span>
          </div>
        </div>
      )}

      {/* Offline banner for Client mode */}
      {modeIsClient && !connected && !hostRecovery && !recoveryRevoked && (
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
