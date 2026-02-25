import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock3, Monitor, ShieldCheck, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { queryClient } from "@/lib/queryClient";

type PendingSetupApproval = {
  id: string;
  status: "pending";
  createdAt: number;
  expiresAt: number;
  clientName: string;
  clientHost: string;
  clientVersion: string;
  requestedByIp: string;
};

type PendingSetupApprovalResponse = {
  pending: PendingSetupApproval[];
};

type DesktopMode = "host" | "client" | "unknown";

function toRelativeAge(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "Unknown";
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  return `${Math.floor(deltaHr / 24)}d ago`;
}

export default function HostApprovalCenter() {
  const [desktopMode, setDesktopMode] = useState<DesktopMode>("unknown");
  const [snoozedUntilByRequestId, setSnoozedUntilByRequestId] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    const bridge = (window as any)?.otto;
    if (!bridge?.getConfig) return () => undefined;

    void bridge
      .getConfig()
      .then((config: any) => {
        if (!active) return;
        const mode = String(config?.mode || "").toLowerCase();
        if (mode === "host" || mode === "client") {
          setDesktopMode(mode);
        }
      })
      .catch(() => {
        // ignore
      });

    return () => {
      active = false;
    };
  }, []);

  const isHostMode = desktopMode === "host";

  useEffect(() => {
    const bridge = (window as any)?.otto;
    if (!isHostMode || !bridge?.hostApprovalCenterHeartbeat) return () => undefined;

    const sendHeartbeat = () => {
      try {
        bridge.hostApprovalCenterHeartbeat();
      } catch {
        // ignore heartbeat failures
      }
    };

    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, 10_000);
    return () => window.clearInterval(intervalId);
  }, [isHostMode]);

  const pendingQuery = useQuery<PendingSetupApprovalResponse>({
    queryKey: ["/api/setup/handshake/pending", "host-approval-center"],
    enabled: isHostMode,
    refetchInterval: isHostMode ? 3000 : false,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const res = await fetch("/api/setup/handshake/pending", {
        credentials: "include",
      });

      if (res.status === 403 || res.status === 404) {
        return { pending: [] };
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || payload?.message || res.statusText || "Could not load Host approvals.");
      }

      const data = (await res.json()) as PendingSetupApprovalResponse;
      if (!data || !Array.isArray(data.pending)) {
        return { pending: [] };
      }
      return data;
    },
  });

  const decisionMutation = useMutation({
    mutationFn: async ({ requestId, decision }: { requestId: string; decision: "approved" | "denied" }) => {
      const response = await fetch(`/api/setup/handshake/request/${encodeURIComponent(requestId)}/decision`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          note: decision === "approved" ? "Approved in Host approval center." : "Denied in Host approval center.",
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || response.statusText || "Could not save decision.");
      }
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/setup/handshake/pending", "host-approval-center"] });
    },
  });

  const visiblePending = useMemo(() => {
    const now = Date.now();
    const all = pendingQuery.data?.pending || [];
    return all.filter((request) => {
      const snoozedUntil = Number(snoozedUntilByRequestId[request.id]) || 0;
      return snoozedUntil <= now;
    });
  }, [pendingQuery.data?.pending, snoozedUntilByRequestId]);

  if (!isHostMode) return null;
  if (pendingQuery.isLoading) return null;
  if (visiblePending.length === 0 && !pendingQuery.isError) return null;

  return (
    <Card className="mb-6 border-primary/25" data-testid="host-approval-center">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Host connection approvals
          {visiblePending.length > 0 && <Badge variant="destructive">{visiblePending.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <span>{(pendingQuery.error as Error)?.message || "Could not load pending approvals."}</span>
            </div>
          </div>
        ) : (
          visiblePending.map((request) => (
            <div
              key={request.id}
              className="rounded-lg border border-border bg-card p-3"
              data-testid={`host-approval-request-${request.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{request.clientName || "Client computer"}</p>
                  <p className="text-xs text-muted-foreground">Hostname: {request.clientHost || "Unknown"}</p>
                  <p className="text-xs text-muted-foreground">LAN IP: {request.requestedByIp || "Unknown"}</p>
                  <p className="text-xs text-muted-foreground">Version: {request.clientVersion || "Unknown"}</p>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock3 className="h-3.5 w-3.5" />
                  {toRelativeAge(request.createdAt)}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => decisionMutation.mutate({ requestId: request.id, decision: "approved" })}
                  disabled={decisionMutation.isPending}
                  data-testid={`button-host-approval-approve-${request.id}`}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => decisionMutation.mutate({ requestId: request.id, decision: "denied" })}
                  disabled={decisionMutation.isPending}
                  data-testid={`button-host-approval-deny-${request.id}`}
                >
                  <X className="mr-2 h-4 w-4" />
                  Deny
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSnoozedUntilByRequestId((prev) => ({
                      ...prev,
                      [request.id]: Date.now() + 60_000,
                    }));
                  }}
                  data-testid={`button-host-approval-later-${request.id}`}
                >
                  <Monitor className="mr-2 h-4 w-4" />
                  Later
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
