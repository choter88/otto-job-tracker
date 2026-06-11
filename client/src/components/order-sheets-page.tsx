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
import JobDialog from "@/components/job-dialog";
import OrderSheetFolderSetup from "@/components/order-sheet-folder-setup";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openJobDetails } from "@/components/spotlight/feature-spotlight-host";
import { formatPatientDisplayName } from "@shared/name-format";
import type { Office, OrderSheetImport } from "@shared/schema";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleAlert,
  FileText,
  Loader2,
  MonitorSmartphone,
  ScanLine,
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

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const { data: records = [], isLoading } = useQuery<OrderSheetImport[]>({
    queryKey: ["/api/order-sheets"],
    enabled: !!user?.officeId,
  });

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

  // ── Record grouping ──────────────────────────────────────────────────

  const needsAttention = records.filter((record) => record.status === "needs_review" || record.status === "failed");
  const activity = records;

  return (
    <div className="space-y-6" data-testid="page-order-sheets">
      {/* ── This computer's watcher ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-4 w-4 text-otto-accent-ink" />
            Order sheet folder
          </CardTitle>
        </CardHeader>
        <CardContent>
          <OrderSheetFolderSetup description="Save each printed frame order sheet (PDF or text file) into one folder, and Otto turns it into a job automatically. Sheets it can't fully read land in “Needs attention” below." />
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
                  <StatusChip status={record.status} />
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => setReviewRecord(record)}
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
          <CardTitle className="text-base">Activity</CardTitle>
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
                        {[patient, type].filter(Boolean).join(" · ") || (
                          <span className="text-ink-mute">{record.failureReason || "—"}</span>
                        )}
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
                            onClick={() => setReviewRecord(record)}
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
          queryClient.invalidateQueries({ queryKey: ["/api/order-sheets"] });
          setReviewRecord(null);
        }}
      />
    </div>
  );
}
