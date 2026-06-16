// Order Sheets page — the home of the folder automation.
//
// Top: this computer's watcher (choose folder, on/off, live status).
// Middle: "Needs attention" — sheets the parser couldn't finish, each
// with a one-click "Review & create" that opens the normal New Job
// dialog prefilled with whatever WAS read.
// Bottom: the office-wide activity ledger, so any computer can see what
// the automation did, which file became which job, and why something
// was skipped.

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { HEARTBEAT_INTERVAL_MS, WATCHER_STALE_AFTER_MS } from "@/hooks/use-order-sheets";
import { getOrCreateDeviceId } from "@/components/sync-manager";
import JobDialog from "@/components/job-dialog";
import OrderSheetFolderSetup from "@/components/order-sheet-folder-setup";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openJobDetails } from "@/components/spotlight/feature-spotlight-host";
import { formatPatientDisplayName } from "@shared/name-format";
import type { Office, OrderSheetImport, OrderSheetWatcher } from "@shared/schema";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleAlert,
  FileText,
  Loader2,
  MonitorSmartphone,
  ScanLine,
  Wand2,
  X,
  XCircle,
} from "lucide-react";

type ParsedFields = {
  patientFirstName?: string;
  patientLastName?: string;
  trayNumber?: string;
  phone?: string;
  jobTypeId?: string;
  jobTypeText?: string;
  destinationId?: string;
  destinationText?: string;
  orderDate?: string;
  notes?: string;
};

function parsedFieldsOf(record: OrderSheetImport): ParsedFields {
  const parsed = record.parsed as { fields?: ParsedFields } | null;
  return parsed?.fields || {};
}

function missingOf(record: OrderSheetImport): string[] {
  const parsed = record.parsed as { missing?: string[] } | null;
  return Array.isArray(parsed?.missing) ? parsed.missing : [];
}

// Fields filled by rules the office taught through earlier review
// corrections (server stamps these on the parsed JSON at ingest).
const LEARNED_FIELD_LABELS: Record<string, string> = {
  patientName: "patient name",
  trayNumber: "tray number",
  phone: "phone",
  orderDate: "order date",
  jobType: "order type",
  destination: "lab",
};

function learnedFieldsOf(record: OrderSheetImport): string[] {
  const parsed = record.parsed as { learnedFields?: string[] } | null;
  if (!Array.isArray(parsed?.learnedFields)) return [];
  return parsed.learnedFields.map((field) => LEARNED_FIELD_LABELS[field] || field);
}

function LearnedChip({ record }: { record: OrderSheetImport }) {
  const learned = learnedFieldsOf(record);
  if (learned.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-brand-emerald">
          <Wand2 className="h-3 w-3" />
          Your fixes
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Filled using corrections this office made before: {learned.join(", ")}
      </TooltipContent>
    </Tooltip>
  );
}

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  imported: { label: "Imported", className: "text-brand-emerald" },
  needs_review: { label: "Needs review", className: "bg-warn-bg text-warn" },
  failed: { label: "Couldn't read", className: "bg-danger-bg text-danger" },
  dismissed: { label: "Dismissed", className: "text-ink-mute" },
};

function StatusChip({ status }: { status: string }) {
  const chip = STATUS_CHIP[status] || { label: status, className: "text-ink-mute" };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[calc(11px*var(--ui-scale))] font-medium whitespace-nowrap",
        chip.className,
      )}
      style={status === "imported" ? { background: "rgba(47, 158, 110, 0.10)" } : undefined}
      data-testid={`chip-order-sheet-status-${status}`}
    >
      {chip.label}
    </span>
  );
}

export default function OrderSheetsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canEdit = user?.role !== "view_only";
  const canManage = user?.role === "owner" || user?.role === "manager";

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const { data: records = [], isLoading } = useQuery<OrderSheetImport[]>({
    queryKey: ["/api/order-sheets"],
    enabled: !!user?.officeId,
  });

  // Office-wide watcher presence — which computers are watching folders.
  // Polled (no websocket broadcast for heartbeats) on the same cadence
  // the machines report on.
  type WatcherRow = OrderSheetWatcher & { customName: string | null };
  const { data: watchers = [] } = useQuery<WatcherRow[]>({
    queryKey: ["/api/order-sheets/watchers"],
    enabled: !!user?.officeId,
    refetchInterval: HEARTBEAT_INTERVAL_MS,
  });

  const removeWatcherMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const res = await apiRequest("DELETE", `/api/order-sheets/watchers/${deviceId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-sheets/watchers"] });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't remove", description: error.message, variant: "destructive" });
    },
  });

  const myDeviceId = useMemo(() => getOrCreateDeviceId(), []);
  // The list only earns its space when it says something the controls
  // above don't: another computer exists, or a watcher went quiet. A
  // single fresh row for THIS machine is pure repetition — hide it.
  const showWatchers =
    watchers.length > 0 && !(watchers.length === 1 && watchers[0].deviceId === myDeviceId);

  const officeSettings = (office?.settings || {}) as Record<string, any>;
  const jobTypeLabel = (record: OrderSheetImport) => {
    const fields = parsedFieldsOf(record);
    const match = (officeSettings.customJobTypes || []).find((t: any) => t.id === fields.jobTypeId);
    return match?.label || fields.jobTypeText || "";
  };
  const destinationLabel = (record: OrderSheetImport) => {
    const fields = parsedFieldsOf(record);
    const match = (officeSettings.customOrderDestinations || []).find((d: any) => d.id === fields.destinationId);
    return match?.label || fields.destinationText || "";
  };
  const patientLabel = (record: OrderSheetImport) => {
    const fields = parsedFieldsOf(record);
    const name = formatPatientDisplayName(fields.patientFirstName, fields.patientLastName);
    if (name) return name;
    if (fields.trayNumber) return `Tray ${fields.trayNumber}`;
    return "";
  };

  // ── Review & dismiss ─────────────────────────────────────────────────

  const [reviewRecord, setReviewRecord] = useState<OrderSheetImport | null>(null);

  // Opening a record for review also opens the saved PDF so staff can
  // verify the prefilled dialog against the original sheet. Desktop hands
  // the bytes to the OS viewer (Preview/Acrobat); the web falls back to a
  // new tab. Fire-and-forget — the dialog still opens if the file open
  // fails (e.g., text sheet with no PDF), so review isn't blocked.
  const openReview = (record: OrderSheetImport) => {
    setReviewRecord(record);
    if (!record.attachmentPath) return;
    const fileUrl = `/api/order-sheets/${encodeURIComponent(record.id)}/file`;
    const bridge = (window as any)?.otto;
    if (typeof bridge?.orderSheetsOpenExternal === "function") {
      void (async () => {
        try {
          const res = await fetch(fileUrl, { credentials: "include" });
          if (!res.ok) return;
          const bytes = new Uint8Array(await res.arrayBuffer());
          await bridge.orderSheetsOpenExternal({ bytes, fileName: record.fileName });
        } catch {
          /* leave the dialog open without the file */
        }
      })();
    } else {
      window.open(fileUrl, "_blank", "noreferrer");
    }
  };
  const reviewPrefill = useMemo(() => {
    if (!reviewRecord) return undefined;
    const fields = parsedFieldsOf(reviewRecord);
    return {
      patientFirstName: fields.patientFirstName || "",
      patientLastName: fields.patientLastName || "",
      trayNumber: fields.trayNumber || "",
      phone: fields.phone || "",
      jobType: fields.jobTypeId || undefined,
      orderDestination: fields.destinationId || undefined,
      createdAt: fields.orderDate || undefined,
      notes: fields.notes || "",
    };
  }, [reviewRecord]);

  const dismissMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const res = await apiRequest("POST", `/api/order-sheets/${recordId}/dismiss`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-sheets"] });
      toast({ title: "Sheet dismissed", description: "It will stay in the activity list for reference." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't dismiss", description: error.message, variant: "destructive" });
    },
  });

  const forgetLearningMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/order-sheets/forget-learning");
      return res.json() as Promise<{ cleared: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-sheets"] });
      toast({
        title: "Reset what Otto learned",
        description:
          data.cleared > 0
            ? "Otto will re-learn your forms as you review new sheets."
            : "There was nothing learned to reset yet.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't reset", description: error.message, variant: "destructive" });
    },
  });

  // ── Record grouping ──────────────────────────────────────────────────

  const needsAttention = records.filter((record) => record.status === "needs_review" || record.status === "failed");
  const activity = records;

  return (
    <div className="space-y-6" data-testid="page-order-sheets">
      {/* ── This computer's watcher ── tighter card so Needs attention
          below is the visual focal point when items are stuck. */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScanLine className="h-4 w-4 text-otto-accent-ink" />
            Order sheet folder
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-3">
          <OrderSheetFolderSetup />

          {/* ── Office-wide watcher presence ── compact one-row-per-watcher */}
          {showWatchers && (
            <div className="mt-2 pt-2 border-t border-line-2 space-y-1" data-testid="panel-order-sheet-watchers">
              {watchers.map((watcher) => {
                const heartbeatAge = Date.now() - new Date(watcher.lastHeartbeatAt).getTime();
                const fresh = heartbeatAge < WATCHER_STALE_AFTER_MS;
                const isWatching = fresh && watcher.enabled && watcher.state === "watching";
                const hasProblem = fresh && watcher.state === "error";
                const label = isWatching
                  ? "Watching"
                  : hasProblem
                    ? "Problem with folder"
                    : fresh
                      ? watcher.enabled
                        ? "Not watching"
                        : "Off"
                      : `Not reporting · last seen ${formatDistanceToNow(new Date(watcher.lastHeartbeatAt), { addSuffix: true })}`;
                return (
                  <div
                    key={watcher.deviceId}
                    className="flex items-center gap-2 text-xs"
                    data-testid={`row-order-sheet-watcher-${watcher.deviceId}`}
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        isWatching && "bg-brand-emerald animate-[ottoPulseDot_2.4s_ease-out_infinite]",
                        hasProblem && "bg-danger",
                        !isWatching && !hasProblem && "bg-ink-mute",
                      )}
                    />
                    <span className="font-medium text-ink whitespace-nowrap">
                      {watcher.customName || watcher.deviceLabel || "Unknown computer"}
                      {watcher.deviceId === myDeviceId && (
                        <span className="ml-1.5 text-[calc(10px*var(--ui-scale))] text-ink-mute font-normal">(this)</span>
                      )}
                    </span>
                    {watcher.folderPath && (
                      <span
                        className="text-ink-mute font-mono truncate min-w-0 flex-1"
                        title={watcher.folderPath}
                      >
                        {watcher.folderPath}
                      </span>
                    )}
                    <span
                      className={cn(
                        "whitespace-nowrap shrink-0",
                        isWatching && "text-brand-emerald",
                        hasProblem && "text-danger",
                        !isWatching && !hasProblem && "text-ink-mute",
                      )}
                      title={hasProblem ? watcher.error || undefined : undefined}
                    >
                      {label}
                    </span>
                    {!fresh && canEdit && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => removeWatcherMutation.mutate(watcher.deviceId)}
                            disabled={removeWatcherMutation.isPending}
                            className="shrink-0 grid place-items-center w-5 h-5 rounded text-ink-mute hover:text-ink hover:bg-line-2"
                            aria-label="Remove this computer from the list"
                            data-testid={`button-remove-watcher-${watcher.deviceId}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Remove from this list. If the computer is still watching, it will reappear on its
                          next check-in.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Needs attention ── */}
      {needsAttention.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleAlert className="h-4 w-4 text-warn" />
              Needs attention
              <Badge className="bg-warn-bg text-warn border-0">{needsAttention.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {needsAttention.map((record) => {
              const missing = missingOf(record);
              const patient = patientLabel(record);
              const type = jobTypeLabel(record);
              const lab = destinationLabel(record);
              const summary = [patient, type, lab].filter(Boolean).join(" · ");
              return (
                <div
                  key={record.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"
                  data-testid={`row-order-sheet-review-${record.id}`}
                >
                  <FileText className="h-4 w-4 shrink-0 text-ink-mute" />
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-sm font-medium text-ink truncate" title={record.fileName}>
                      {record.fileName}
                    </div>
                    <div className="text-xs text-ink-mute">
                      {summary || "Nothing could be read from this file"}
                      {record.failureReason
                        ? ` — ${record.failureReason}`
                        : missing.length > 0
                          ? ` — missing ${missing.join(", ")}`
                          : ""}
                    </div>
                  </div>
                  <LearnedChip record={record} />
                  <StatusChip status={record.status} />
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => openReview(record)}
                        data-testid={`button-order-sheet-review-${record.id}`}
                      >
                        Review &amp; create
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => dismissMutation.mutate(record.id)}
                        disabled={dismissMutation.isPending}
                        data-testid={`button-order-sheet-dismiss-${record.id}`}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Activity ledger ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Activity</CardTitle>
            {/* Escape hatch — owner/manager only. Otto normally self-heals a
                bad learned rule when staff re-correct it; this is the blunt
                reset for a form that's gotten stuck. */}
            {canManage && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-ink-mute hover:text-ink"
                    data-testid="button-forget-learning"
                  >
                    Reset learned parsing
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent data-testid="dialog-forget-learning">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset what Otto has learned?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Otto adapts to your order sheets as staff correct reviewed ones. This clears
                      everything it has learned about your forms across the office. It will start
                      learning again from your next reviews. Use this only if parsing has gotten
                      stuck on a form.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => forgetLearningMutation.mutate()}
                      disabled={forgetLearningMutation.isPending}
                    >
                      Reset learning
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-ink-mute py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : activity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-order-sheets-empty">
              No order sheets yet. Files saved to the watched folder will show up here, along with the jobs
              they created.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Patient / details</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Job</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((record) => {
                  const patient = patientLabel(record);
                  const type = jobTypeLabel(record);
                  const createdAt = new Date(record.createdAt);
                  return (
                    <TableRow key={record.id} data-testid={`row-order-sheet-${record.id}`}>
                      <TableCell className="max-w-[260px]">
                        <div className="flex items-center gap-2 min-w-0">
                          {record.status === "imported" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-emerald" />
                          ) : record.status === "failed" ? (
                            <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-ink-mute" />
                          )}
                          <span className="truncate text-sm" title={record.fileName}>{record.fileName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-ink-2">
                        <span className="inline-flex items-center gap-2">
                          {[patient, type].filter(Boolean).join(" · ") || (
                            <span className="text-ink-mute">{record.failureReason || "—"}</span>
                          )}
                          <LearnedChip record={record} />
                        </span>
                      </TableCell>
                      <TableCell>
                        {record.deviceLabel ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-ink-mute">
                            <MonitorSmartphone className="h-3 w-3" />
                            {record.deviceLabel}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-mute">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-ink-mute whitespace-nowrap">
                              {formatDistanceToNow(createdAt, { addSuffix: true })}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{format(createdAt, "MMM d, yyyy h:mm a")}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <StatusChip status={record.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {record.jobId && record.status === "imported" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => openJobDetails(record.jobId!)}
                            data-testid={`button-order-sheet-open-job-${record.id}`}
                          >
                            {record.jobOrderId || "View job"}
                          </Button>
                        ) : record.status !== "imported" && canEdit ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => openReview(record)}
                            data-testid={`button-order-sheet-table-review-${record.id}`}
                          >
                            Review
                          </Button>
                        ) : (
                          <span className="text-xs text-ink-mute">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Review dialog: the normal New Job dialog, prefilled ── */}
      <JobDialog
        open={!!reviewRecord}
        onOpenChange={(open) => {
          if (!open) setReviewRecord(null);
        }}
        prefill={reviewPrefill}
        orderSheetImportId={reviewRecord?.id}
        onCreated={() => {
          // Only claim Otto can learn when there's a stored PDF to learn
          // from — txt sheets and oversized files have no layout.
          if (reviewRecord?.attachmentPath?.toLowerCase().endsWith(".pdf")) {
            toast({
              title: "Job created",
              description: "Otto remembers your corrections — the next sheet printed from this form should parse better.",
            });
          }
          queryClient.invalidateQueries({ queryKey: ["/api/order-sheets"] });
          setReviewRecord(null);
        }}
      />
    </div>
  );
}
