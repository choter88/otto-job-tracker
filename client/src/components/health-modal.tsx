import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { subscribeOutbox } from "@/lib/offline-outbox";
import { useAuth } from "@/hooks/use-auth";
import { Activity, ClipboardList, FileDown, Trash2 } from "lucide-react";

type MaybeBridge = {
  getConfig?: () => Promise<any>;
  showDiagnostics?: () => Promise<any>;
  exportSupportBundle?: () => Promise<any>;
  outboxClear?: () => Promise<any>;
};

function formatWhen(ts: number | null | undefined): string {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

export default function HealthModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [desktopConfig, setDesktopConfig] = useState<any | null>(null);
  const [licenseSnapshot, setLicenseSnapshot] = useState<any | null>(null);
  const [outboxItems, setOutboxItems] = useState<any[]>([]);

  const bridge: MaybeBridge | null = useMemo(() => {
    try {
      return ((window as any)?.otto as MaybeBridge) || null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      try {
        if (!bridge?.getConfig) return;
        const cfg = await bridge.getConfig();
        if (!cancelled) setDesktopConfig(cfg);
      } catch {
        // ignore
      }
    };

    void load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, bridge]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/license/status", { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (!cancelled) setLicenseSnapshot(json);
      } catch {
        // ignore
      }
    };

    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return subscribeOutbox((items) => {
      const origin = window.location.origin;
      setOutboxItems(items.filter((i) => i.origin === origin));
    });
  }, [open]);

  const mode = String(desktopConfig?.mode || "").toLowerCase();
  const isHost = mode === "host";
  const isDesktop = Boolean(bridge?.getConfig);

  const outboxCount = outboxItems.length;
  const outboxOldestAt = outboxItems.reduce((min: number, item: any) => {
    const ts = Number(item?.createdAt) || 0;
    if (!ts) return min;
    return min ? Math.min(min, ts) : ts;
  }, 0);
  const outboxFailures = outboxItems.filter((i) => i?.lastError).length;
  const outboxLastError = outboxItems.find((i) => i?.lastError)?.lastError || null;

  const networkBackupStatus = (() => {
    if (!isHost) return null;
    if (desktopConfig?.backupEnabled === false) return "disabled";
    if (!desktopConfig?.backupDir) return "not set up";
    if (desktopConfig?.backupLastError) return "error";
    if (desktopConfig?.backupLastAt) return `last ${new Date(desktopConfig.backupLastAt).toLocaleString()}`;
    return "configured";
  })();

  const localBackupStatus = (() => {
    if (!isHost) return null;
    if (desktopConfig?.localBackupEnabled === false) return "disabled";
    if (desktopConfig?.localBackupLastError) return "error";
    if (desktopConfig?.localBackupLastAt) return `last ${new Date(desktopConfig.localBackupLastAt).toLocaleString()}`;
    return "pending";
  })();

  const handleDiagnostics = async () => {
    if (!bridge?.showDiagnostics) {
      toast({ title: "Not available", description: "Diagnostics are only available in the desktop app." });
      return;
    }
    await bridge.showDiagnostics();
  };

  const handleExportSupportBundle = async () => {
    if (!bridge?.exportSupportBundle) {
      toast({ title: "Not available", description: "Support bundle export is only available in the desktop app." });
      return;
    }
    await bridge.exportSupportBundle();
  };

  const handleClearOutbox = async () => {
    if (!bridge?.outboxClear) {
      toast({ title: "Not available", description: "Offline outbox is only available in the desktop app." });
      return;
    }
    if (!outboxCount) return;

    const ok = confirm(
      "Clear the offline queue?\n\nThis will delete any pending offline changes that haven’t synced yet.",
    );
    if (!ok) return;

    await bridge.outboxClear();
    toast({ title: "Cleared", description: "Offline queue cleared." });
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            System Health
          </DialogTitle>
          <DialogDescription>
            Quick status for licensing, backups, and offline sync. No patient data is shown here.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Environment</div>
                <Badge variant={isDesktop ? "secondary" : "outline"}>{isDesktop ? "Desktop" : "Web"}</Badge>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>Mode: {mode || "unknown"}</div>
                {desktopConfig?.hostUrl && <div>Host URL: {desktopConfig.hostUrl}</div>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">License</div>
                <Badge variant={licenseSnapshot?.mode === "ACTIVE" ? "secondary" : "outline"}>
                  {String(licenseSnapshot?.mode || "unknown")}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">{String(licenseSnapshot?.message || "Unavailable")}</div>
              {licenseSnapshot?.lastError && (
                <div className="text-xs text-muted-foreground">Last error: {String(licenseSnapshot.lastError)}</div>
              )}
              {licenseSnapshot?.graceEndsAt ? (
                <div className="text-xs text-muted-foreground">Grace ends: {formatWhen(Number(licenseSnapshot.graceEndsAt))}</div>
              ) : null}
            </CardContent>
          </Card>

          {isHost && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-medium">Backups (Host)</div>
                <div className="grid gap-2 text-sm text-muted-foreground">
                  <div>Network: {networkBackupStatus}</div>
                  {desktopConfig?.backupDir && <div className="truncate">Network folder: {desktopConfig.backupDir}</div>}
                  {desktopConfig?.backupLastError && <div>Network last error: {desktopConfig.backupLastError}</div>}
                  <Separator />
                  <div>Local: {localBackupStatus}</div>
                  {desktopConfig?.localBackupLastError && <div>Local last error: {desktopConfig.localBackupLastError}</div>}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Offline Sync</div>
                <Badge variant={outboxCount ? "outline" : "secondary"}>{outboxCount} pending</Badge>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>Oldest queued: {outboxCount ? formatWhen(outboxOldestAt) : "—"}</div>
                <div>Failures: {outboxFailures}</div>
                {outboxLastError ? <div className="truncate">Last error: {String(outboxLastError)}</div> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={handleDiagnostics} disabled={!bridge?.showDiagnostics}>
                  <ClipboardList className="h-4 w-4" />
                  Diagnostics
                </Button>
                <Button variant="secondary" onClick={handleExportSupportBundle} disabled={!bridge?.exportSupportBundle}>
                  <FileDown className="h-4 w-4" />
                  Export support bundle
                </Button>
                <Button variant="destructive" onClick={handleClearOutbox} disabled={!outboxCount || !bridge?.outboxClear}>
                  <Trash2 className="h-4 w-4" />
                  Clear offline queue
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Support bundles are non‑PHI by design (no database export, no message bodies).
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}

