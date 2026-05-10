// Patient tracking-link dialog. Designed for one-click generation:
//
//   1. Scope chip (small, top)
//   2. "What the patient will see" — status preview always visible. Hidden
//      statuses are dimmed inline; "Customize" toggles the per-link override.
//   3. Estimated ready (optional) — pre-fills with a suggestion derived from
//      past completed orders of the same type+lab. User can override or clear.
//   4. Note (optional) — smaller, less prominent, with a one-line warning.
//   5. Privacy assurance — single line, footer-style.
//
// After Generate, the dialog flips to the share view (URL, QR, copy-message,
// extend, revoke).

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { sortByOrder } from "@/lib/custom-list-sort";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Link2,
  Copy,
  Check,
  Eye,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  CalendarClock,
  CalendarPlus,
  StickyNote,
  ChevronDown,
  Plus,
  MessageSquare,
  Sparkles,
  Sliders,
} from "lucide-react";
import QRCode from "qrcode";
import { renderMessageTemplate } from "@/components/customization/tracking-link-defaults-editor";
import { formatPatientDisplayName } from "@shared/name-format";
import type { Job, Office } from "@shared/schema";

const DEFAULT_VISIBLE_STATUSES = ["ordered", "in_progress", "ready_for_pickup"];
const SIDE_STATE_STATUSES = new Set(["delayed"]);

const PATIENT_FACING_STATUS_LABELS: Record<string, string> = {
  job_created: "Order received",
  ordered: "Sent to lab",
  in_progress: "In production",
  delayed: "Delayed",
  quality_check: "Final quality check",
  ready_for_pickup: "Ready for pickup",
  completed: "Picked up",
  cancelled: "Cancelled",
};
function patientLabel(id: string): string {
  return PATIENT_FACING_STATUS_LABELS[id] ?? id;
}

const EXPIRY_WARN_DAYS = 7;
const EXTEND_BY_DAYS = 30;

export interface TrackingJobSnapshot {
  id: string;
  jobType: string;
  currentStatus: string;
  statusChangedAt: string;
  history?: Array<{ status: string; at: string }>;
}

export interface TrackingLinkRecord {
  id: string;
  token: string;
  url: string;
  jobIds: string[];
  jobs: TrackingJobSnapshot[];
  visibleStatuses: string[];
  eta: string | null;
  customNotes: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TrackingLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: Job[];
  existingLink?: TrackingLinkRecord;
  onCreated?: (link: TrackingLinkRecord) => void;
  onUpdated?: (link: TrackingLinkRecord) => void;
  onRevoked?: () => void;
}

interface EtaSuggestion {
  suggestedDate: string | null;
  sampleSize: number;
  basis: string | null;
  medianDays?: number;
}

// Compute the union of default visible statuses for a set of jobs, taking
// per-job-type overrides from office settings into account. If every job
// shares a type and that type has an override, use it; otherwise union
// across types so the patient sees every stage that any job will go
// through. Caller can still narrow per-link via the customize panel.
function computeDefaultVisibleStatuses(
  selectedJobTypes: string[],
  globalDefault: string[],
  byJobType: Record<string, { visibleStatuses?: string[] } | undefined> | undefined,
): string[] {
  if (selectedJobTypes.length === 0) return globalDefault;
  const typed = byJobType ?? {};
  const out = new Set<string>();
  const uniqueTypes: string[] = [];
  const seen = new Set<string>();
  for (const t of selectedJobTypes) {
    if (seen.has(t)) continue;
    seen.add(t);
    uniqueTypes.push(t);
  }
  for (const t of uniqueTypes) {
    const override = typed[t]?.visibleStatuses;
    const list = Array.isArray(override) && override.length > 0 ? override : globalDefault;
    for (const s of list) out.add(s);
  }
  return Array.from(out);
}

export default function TrackingLinkDialog({
  open,
  onOpenChange,
  jobs,
  existingLink,
  onCreated,
  onUpdated,
  onRevoked,
}: TrackingLinkDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId && open,
  });

  const officeDefaults = useMemo(() => {
    const settings = (office?.settings || {}) as any;
    const fromSettings = settings?.trackingLinkDefaults || {};
    const visible = Array.isArray(fromSettings.visibleStatuses) && fromSettings.visibleStatuses.length > 0
      ? (fromSettings.visibleStatuses as string[])
      : DEFAULT_VISIBLE_STATUSES;
    const defaultNotes = typeof fromSettings.defaultNotes === "string" ? fromSettings.defaultNotes : "";
    const messageTemplate = typeof fromSettings.messageTemplate === "string" ? fromSettings.messageTemplate : "";
    const byJobType = (fromSettings.byJobType && typeof fromSettings.byJobType === "object")
      ? fromSettings.byJobType as Record<string, { visibleStatuses?: string[] }>
      : undefined;
    return { visibleStatuses: visible, defaultNotes, messageTemplate, byJobType };
  }, [office?.settings]);

  const customStatuses = useMemo(
    () => sortByOrder(((office?.settings as any)?.customStatuses || []) as any[]),
    [office?.settings],
  );

  // Sibling detection (bulk-action path only).
  const { data: linkGroupsMap } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/jobs/linked-ids"],
    enabled: open && !existingLink && jobs.length > 0,
  });
  const allJobs = useMemo<Job[]>(() => {
    const cached = queryClient.getQueryData<Job[]>(["/api/jobs"]) || [];
    return Array.isArray(cached) ? cached : [];
  }, [queryClient, open]);
  const siblingJobs = useMemo<Job[]>(() => {
    if (!linkGroupsMap || jobs.length === 0) return [];
    const selectedIds = new Set(jobs.map((j) => j.id));
    const siblingIdSet = new Set<string>();
    for (const groupJobIds of Object.values(linkGroupsMap)) {
      const overlap = groupJobIds.some((id) => selectedIds.has(id));
      if (!overlap) continue;
      for (const id of groupJobIds) if (!selectedIds.has(id)) siblingIdSet.add(id);
    }
    return allJobs.filter((j) => siblingIdSet.has(j.id));
  }, [linkGroupsMap, jobs, allJobs]);
  const [includeSiblings, setIncludeSiblings] = useState(false);
  useEffect(() => { if (open) setIncludeSiblings(false); }, [open]);
  const effectiveJobs = useMemo<Job[]>(() => {
    if (!includeSiblings) return jobs;
    const map = new Map<string, Job>();
    for (const j of jobs) map.set(j.id, j);
    for (const j of siblingJobs) map.set(j.id, j);
    return Array.from(map.values());
  }, [includeSiblings, jobs, siblingJobs]);

  // Editable form state
  const [visible, setVisible] = useState<string[]>([]);
  const [eta, setEta] = useState<string>(""); // ISO yyyy-mm-dd
  const [etaTouched, setEtaTouched] = useState(false);
  const [notes, setNotes] = useState<string>("");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [phase, setPhase] = useState<"configure" | "share">("configure");
  const [generatedLink, setGeneratedLink] = useState<TrackingLinkRecord | null>(null);
  const [copied, setCopied] = useState<"none" | "url" | "message">("none");
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existingLink) {
      setVisible(existingLink.visibleStatuses.length > 0 ? existingLink.visibleStatuses : officeDefaults.visibleStatuses);
      setEta(existingLink.eta ? existingLink.eta.slice(0, 10) : "");
      setEtaTouched(true);
      setNotes(existingLink.customNotes ?? "");
      setGeneratedLink(existingLink);
      setPhase("share");
    } else {
      // Seed the visible-statuses from per-jobType defaults if the office
      // has them; falls back to the global default.
      const seedTypes = effectiveJobs.map((j) => j.jobType);
      setVisible(computeDefaultVisibleStatuses(seedTypes, officeDefaults.visibleStatuses, officeDefaults.byJobType));
      setEta("");
      setEtaTouched(false);
      setNotes(officeDefaults.defaultNotes || "");
      setGeneratedLink(null);
      setPhase("configure");
    }
    setCustomizeOpen(false);
    setCopied("none");
    // We *want* this effect to re-fire when the effective job set changes
    // (sibling include/exclude flips the per-jobType seed). The
    // `effectiveJobs` reference identity stays stable enough for the
    // initial seed; we don't reset the user's customizations on toggle.
  }, [open, existingLink, officeDefaults, effectiveJobs.length]);

  const effectiveJobIds = useMemo(() => effectiveJobs.map((j) => j.id), [effectiveJobs]);

  // ETA suggestion — pulled from local archived-job history.
  const { data: etaSuggestion } = useQuery<EtaSuggestion>({
    queryKey: ["/api/tracking-links/estimate-eta", effectiveJobIds.slice().sort().join(",")],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/tracking-links/estimate-eta", { jobIds: effectiveJobIds });
      return res.json();
    },
    enabled: open && phase === "configure" && !existingLink && effectiveJobIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const suggestedEtaDate = etaSuggestion?.suggestedDate
    ? new Date(etaSuggestion.suggestedDate).toISOString().slice(0, 10)
    : null;
  const showEtaSuggestion = !etaTouched && suggestedEtaDate && (etaSuggestion?.sampleSize ?? 0) > 0;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tracking-links", {
        jobIds: effectiveJobIds,
        visibleStatuses: visible,
        eta: eta ? new Date(eta + "T00:00:00").toISOString() : null,
        customNotes: notes.trim() || null,
      });
      const json = await res.json();
      return json.link as TrackingLinkRecord;
    },
    onSuccess: (link) => {
      setGeneratedLink(link);
      setPhase("share");
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
      onCreated?.(link);
      toast({ title: "Tracking link generated", description: "Copy the message or URL to share with your patient." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't generate link", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!existingLink) throw new Error("No link to update");
      const res = await apiRequest("PATCH", `/api/tracking-links/${existingLink.id}`, {
        visibleStatuses: visible,
        eta: eta ? new Date(eta + "T00:00:00").toISOString() : null,
        customNotes: notes.trim() || null,
      });
      const json = await res.json();
      return json.link as TrackingLinkRecord;
    },
    onSuccess: (link) => {
      setGeneratedLink(link);
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
      onUpdated?.(link);
      toast({ title: "Tracking link updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't update link", description: error.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!generatedLink) throw new Error("No link to revoke");
      const res = await apiRequest("POST", `/api/tracking-links/${generatedLink.id}/revoke`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
      onRevoked?.();
      toast({ title: "Tracking link revoked", description: "The link is no longer active." });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't revoke link", description: error.message, variant: "destructive" });
    },
  });

  const extendMutation = useMutation({
    mutationFn: async () => {
      if (!generatedLink) throw new Error("No link to extend");
      const newExpiresAt = new Date(Date.now() + EXTEND_BY_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const res = await apiRequest("PATCH", `/api/tracking-links/${generatedLink.id}`, { expiresAt: newExpiresAt });
      const json = await res.json();
      return json.link as TrackingLinkRecord;
    },
    onSuccess: (link) => {
      setGeneratedLink(link);
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
      onUpdated?.(link);
      toast({ title: "Link extended", description: `Now expires ${format(new Date(link.expiresAt!), "MMM d, yyyy")}.` });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't extend link", description: error.message, variant: "destructive" });
    },
  });

  const [qrSvg, setQrSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!generatedLink?.url) { setQrSvg(null); return; }
    (async () => {
      try {
        const svg = await QRCode.toString(generatedLink.url, { type: "svg", margin: 1, width: 200 });
        setQrSvg(svg);
      } catch {
        setQrSvg(null);
      }
    })();
  }, [generatedLink?.url]);

  const handleCopyUrl = async () => {
    if (!generatedLink?.url) return;
    try {
      await navigator.clipboard.writeText(generatedLink.url);
      setCopied("url");
      setTimeout(() => setCopied("none"), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
  const handleCopyMessage = async () => {
    if (!generatedLink?.url) return;
    const etaFormatted = generatedLink.eta ? format(new Date(generatedLink.eta), "EEEE, MMMM d") : null;
    const message = renderMessageTemplate(officeDefaults.messageTemplate, { url: generatedLink.url, eta: etaFormatted });
    try {
      await navigator.clipboard.writeText(message);
      setCopied("message");
      setTimeout(() => setCopied("none"), 2000);
      toast({ title: "Message copied", description: "Paste into Weave, SMS, or email." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const isEdit = !!existingLink;
  const dirty = isEdit && (
    JSON.stringify([...visible].sort()) !== JSON.stringify([...(existingLink!.visibleStatuses || [])].sort())
    || (eta || "") !== (existingLink!.eta?.slice(0, 10) || "")
    || (notes || "") !== (existingLink!.customNotes || "")
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[88vh] p-0 overflow-hidden flex flex-col gap-0">
          <DialogHeader className="border-b border-line px-6 py-[18px]">
            <DialogTitle asChild>
              <div className="flex items-center gap-2.5 m-0">
                <Link2 className="h-[18px] w-[18px] text-otto-accent" />
                <h3 className="font-display text-[calc(20px*var(--ui-scale))] font-medium tracking-[-0.025em] text-ink m-0">
                  {phase === "share" ? "Patient tracking link" : "Generate tracking link"}
                </h3>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
            {phase === "configure" && (
              <>
                <ScopeSummary jobs={effectiveJobs} />

                {!isEdit && siblingJobs.length > 0 && (
                  <SiblingPrompt
                    siblingJobs={siblingJobs}
                    included={includeSiblings}
                    onToggle={setIncludeSiblings}
                  />
                )}

                <StatusPreview
                  customStatuses={customStatuses as any[]}
                  visible={visible}
                  customizeOpen={customizeOpen}
                  onCustomizeOpenChange={setCustomizeOpen}
                  onToggleStatus={(id, checked) => {
                    setVisible((prev) =>
                      checked
                        ? Array.from(new Set([...prev, id]))
                        : prev.filter((x) => x !== id),
                    );
                  }}
                />

                <section>
                  <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Estimated ready
                    <span className="text-[calc(10.5px*var(--ui-scale))] text-ink-faint normal-case tracking-normal font-normal">— optional</span>
                  </Label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Input
                      type="date"
                      value={eta}
                      onChange={(e) => { setEta(e.target.value); setEtaTouched(true); }}
                      className="max-w-[220px] bg-white"
                    />
                    {eta && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-[calc(11.5px*var(--ui-scale))] text-ink-mute hover:text-ink"
                        onClick={() => { setEta(""); setEtaTouched(true); }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  {showEtaSuggestion && suggestedEtaDate && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-otto-accent-line bg-otto-accent-soft text-[calc(11.5px*var(--ui-scale))] text-otto-accent-ink hover:bg-otto-accent-soft/70 transition-colors"
                          onClick={() => { setEta(suggestedEtaDate); setEtaTouched(true); }}
                          data-testid="eta-suggestion-pill"
                        >
                          <Sparkles className="h-3 w-3" aria-hidden />
                          Suggest <strong className="font-semibold">{format(new Date(suggestedEtaDate + "T00:00:00"), "MMM d")}</strong>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-xs leading-snug">
                          {etaSuggestion?.basis || "Based on past similar orders"}
                          {typeof etaSuggestion?.medianDays === "number" && (
                            <> · typically ready in {etaSuggestion.medianDays} {etaSuggestion.medianDays === 1 ? "day" : "days"}</>
                          )}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </section>

                <section>
                  <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold flex items-center gap-1.5">
                    <StickyNote className="h-3.5 w-3.5" />
                    Note
                    <span className="text-[calc(10.5px*var(--ui-scale))] text-ink-faint normal-case tracking-normal font-normal">— optional</span>
                  </Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Your frames arrived early — we'll text you when ready."
                    className="mt-1.5 min-h-[56px] bg-white text-[calc(13px*var(--ui-scale))]"
                    maxLength={500}
                  />
                  <div className="mt-1 flex items-start justify-between gap-2 text-[calc(11px*var(--ui-scale))] text-ink-faint">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          className="inline-flex items-center gap-1 cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-otto-accent rounded-sm"
                          data-testid="note-warning"
                        >
                          <AlertTriangle className="h-3 w-3 text-warn" aria-hidden />
                          No names or phone numbers — patients see this.
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-xs leading-snug">
                          The tracking page is publicly accessible to anyone with the link.
                          Don't include patient names, phone numbers, addresses, dates of
                          birth, or anything clinical (Rx, diagnosis, prescription details).
                          Otto will reject notes that look like they contain these.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <span className="tabular-nums shrink-0">{notes.length}/500</span>
                  </div>
                </section>

                <p className="text-[calc(11px*var(--ui-scale))] text-ink-faint flex items-center gap-1.5 m-0">
                  <ShieldCheck className="h-3 w-3 text-brand-emerald" aria-hidden />
                  No name, no contact info, no office identity — just status, ETA, and your note.
                </p>
              </>
            )}

            {phase === "share" && generatedLink && (
              <ShareView
                link={generatedLink}
                qrSvg={qrSvg}
                copied={copied}
                onCopyUrl={handleCopyUrl}
                onCopyMessage={handleCopyMessage}
                hasMessageTemplate={officeDefaults.messageTemplate.trim().length > 0}
                onEdit={() => setPhase("configure")}
                onRevoke={() => setConfirmRevokeOpen(true)}
                onExtend={() => extendMutation.mutate()}
                isExtending={extendMutation.isPending}
                isEdit={isEdit}
                dirty={dirty}
                onSaveEdits={() => updateMutation.mutate()}
                isSaving={updateMutation.isPending}
              />
            )}
          </div>

          <div className="flex gap-3 border-t border-line bg-panel-2 px-6 py-3.5">
            {phase === "configure" ? (
              <>
                <Button
                  className="flex-1"
                  disabled={createMutation.isPending || effectiveJobIds.length === 0 || visible.length === 0}
                  onClick={() => createMutation.mutate()}
                  data-testid="button-generate-tracking-link"
                >
                  {createMutation.isPending ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Link2 className="mr-2 h-4 w-4" />
                      Generate link
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="outline" className="ml-auto" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRevokeOpen} onOpenChange={setConfirmRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this tracking link?</AlertDialogTitle>
            <AlertDialogDescription>
              The patient will no longer be able to see updates on this page. This can't be undone — you'd need to generate a new link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep link</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeMutation.mutate()}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ScopeSummary({ jobs }: { jobs: Job[] }) {
  const friendly = (id: string) => {
    switch (id) {
      case "glasses": return "glasses";
      case "sunglasses": return "sunglasses";
      case "contacts": return "contacts";
      case "prescription": return "prescription";
      default: return id.replace(/_/g, " ");
    }
  };
  const counts = new Map<string, number>();
  for (const j of jobs) counts.set(j.jobType, (counts.get(j.jobType) ?? 0) + 1);
  const labels = Array.from(counts.entries()).map(([t, c]) => `${c > 1 ? `${c} ` : ""}${friendly(t)}`);
  const list = labels.length === 0
    ? "(no jobs)"
    : labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;

  // Surface the patient name for office staff context — they're picking
  // settings for a specific patient's link. PHI stays desktop-side; the
  // portal never receives this name (only jobType + status flow through).
  // Single-patient case: show the name. Multi-patient case (rare; bulk
  // selection across patients): show the count without names.
  const uniqueNames = Array.from(
    new Set(
      jobs
        .map((j) => formatPatientDisplayName(j.patientFirstName, j.patientLastName))
        .filter((n) => n.length > 0),
    ),
  );
  const patientLabel = uniqueNames.length === 1 ? uniqueNames[0] : null;

  return (
    <div className="text-[calc(12px*var(--ui-scale))] text-ink-mute" data-testid="track-scope">
      Tracking{" "}
      {patientLabel ? (
        <>
          <span className="text-ink font-medium">{patientLabel}</span>'s{" "}
          <span className="text-ink font-medium">
            {labels.length > 0 ? list : (jobs.length === 1 ? "job" : `${jobs.length} jobs`)}
          </span>
        </>
      ) : (
        <span className="text-ink font-medium">
          {jobs.length === 1 ? "this job" : `${jobs.length} jobs`}
        </span>
      )}
      {!patientLabel && labels.length > 0 && (
        <> — patient sees "<span className="text-ink-2">{list}</span>".</>
      )}
      {patientLabel && (
        <> — patient page just shows "<span className="text-ink-2">{list}</span>" (never the name).</>
      )}
    </div>
  );
}

function StatusPreview({
  customStatuses,
  visible,
  customizeOpen,
  onCustomizeOpenChange,
  onToggleStatus,
}: {
  customStatuses: { id: string; label: string; color: string }[];
  visible: string[];
  customizeOpen: boolean;
  onCustomizeOpenChange: (open: boolean) => void;
  onToggleStatus: (id: string, checked: boolean) => void;
}) {
  const visibleSet = new Set(visible);
  // Order from the office's customStatuses list so the preview matches what
  // the patient would actually see if all stages happen in sequence.
  const ordered = customStatuses.filter((s) => !SIDE_STATE_STATUSES.has(s.id));
  const visibleEntries = ordered.filter((s) => visibleSet.has(s.id));
  const hiddenCount = ordered.filter((s) => !visibleSet.has(s.id)).length;

  return (
    <section data-testid="track-status-preview">
      <div className="flex items-center justify-between">
        <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
          What the patient will see
        </Label>
        {visibleEntries.length === 0 && (
          <span className="text-[calc(11px*var(--ui-scale))] text-warn font-medium">Pick at least one</span>
        )}
      </div>

      {/* Always-visible preview: flat dots for every visible step. No fake
          "current/complete" state — the patient hasn't progressed yet. The
          shape is what we're previewing, not the progress. */}
      <div className="mt-2 rounded-lg border border-line bg-panel">
        {visibleEntries.length > 0 && (
          <ol className="divide-y divide-line-2">
            {visibleEntries.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-otto-accent shrink-0"
                  aria-hidden
                />
                <span className="text-[calc(13px*var(--ui-scale))] text-ink">
                  {patientLabel(s.id)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="w-full px-3 py-2 border-t border-line-2 bg-paper-2/40 text-[calc(11.5px*var(--ui-scale))] text-ink-mute hover:text-ink hover:bg-paper-2 text-left transition-colors"
            onClick={() => onCustomizeOpenChange(true)}
            data-testid="tracking-hidden-count"
          >
            {hiddenCount === 1 ? "1 status hidden" : `${hiddenCount} statuses hidden`}
            <span className="text-ink-faint"> — Customize</span>
          </button>
        )}
      </div>

      <Collapsible open={customizeOpen} onOpenChange={onCustomizeOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[calc(11.5px*var(--ui-scale))] transition-colors",
              customizeOpen
                ? "border-otto-accent-line bg-otto-accent-soft text-otto-accent-ink"
                : "border-line bg-paper hover:bg-paper-2 text-ink-2",
            )}
            data-testid="tracking-customize-toggle"
          >
            <Sliders className="h-3.5 w-3.5" />
            {customizeOpen ? "Hide options" : "Customize for this patient"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", customizeOpen && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="rounded-md border border-line bg-paper-2/50 divide-y divide-line-2">
            {customStatuses.map((s) => {
              const checked = visibleSet.has(s.id);
              const isSideState = SIDE_STATE_STATUSES.has(s.id);
              const patientText = patientLabel(s.id);
              const renamedFromStatic = !isSideState && s.label.trim() !== patientText;
              return (
                <label
                  key={s.id}
                  htmlFor={`vis-${s.id}`}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2",
                    isSideState ? "opacity-60" : "cursor-pointer hover:bg-paper-2",
                  )}
                >
                  <Checkbox
                    id={`vis-${s.id}`}
                    checked={checked}
                    disabled={isSideState}
                    onCheckedChange={(v) => onToggleStatus(s.id, !!v)}
                  />
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} aria-hidden />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[calc(12.5px*var(--ui-scale))] text-ink">{s.label}</span>
                    {/* Bridge text: the office's internal label vs. what the
                        patient actually reads on the public page. Reads
                        especially helpful when the office has renamed a
                        standard ID — Otto's static map still wins. */}
                    {!isSideState && renamedFromStatic && (
                      <span className="text-[calc(10.5px*var(--ui-scale))] text-ink-faint">
                        Patient sees "{patientText}"
                      </span>
                    )}
                  </div>
                  {isSideState && (
                    <span className="ml-auto text-[calc(11px*var(--ui-scale))] text-ink-faint">Banner only</span>
                  )}
                </label>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function SiblingPrompt({
  siblingJobs,
  included,
  onToggle,
}: {
  siblingJobs: Job[];
  included: boolean;
  onToggle: (next: boolean) => void;
}) {
  const friendly = (id: string) => {
    switch (id) {
      case "glasses": return "glasses";
      case "sunglasses": return "sunglasses";
      case "contacts": return "contacts";
      case "prescription": return "prescription";
      default: return id.replace(/_/g, " ");
    }
  };
  const counts = new Map<string, number>();
  for (const j of siblingJobs) counts.set(j.jobType, (counts.get(j.jobType) ?? 0) + 1);
  const labels = Array.from(counts.entries()).map(([t, c]) => `${c} ${friendly(t)}`);
  const summary = labels.length === 1
    ? labels[0]
    : labels.length === 2
      ? `${labels[0]} and ${labels[1]}`
      : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;

  return (
    <div
      className="rounded-md border border-info/30 bg-info/[0.06] px-3.5 py-2.5 flex items-start gap-3"
      data-testid="tracking-sibling-prompt"
    >
      <Link2 className="h-4 w-4 text-info shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-[calc(12.5px*var(--ui-scale))] font-medium text-ink">
          {siblingJobs.length === 1 ? "1 linked job not included" : `${siblingJobs.length} linked jobs not included`}
        </div>
        <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute mt-0.5 m-0">
          Also tracking: {summary}.
        </p>
      </div>
      <Button
        size="sm"
        variant={included ? "secondary" : "outline"}
        className="h-7 text-[calc(11.5px*var(--ui-scale))] shrink-0"
        onClick={() => onToggle(!included)}
        data-testid="button-include-siblings"
      >
        {included ? <><Check className="h-3.5 w-3.5 mr-1" />Included</> : <><Plus className="h-3.5 w-3.5 mr-1" />Include</>}
      </Button>
    </div>
  );
}

function ShareView({
  link,
  qrSvg,
  copied,
  onCopyUrl,
  onCopyMessage,
  hasMessageTemplate,
  onEdit,
  onRevoke,
  onExtend,
  isExtending,
  isEdit,
  dirty,
  onSaveEdits,
  isSaving,
}: {
  link: TrackingLinkRecord;
  qrSvg: string | null;
  copied: "none" | "url" | "message";
  onCopyUrl: () => void;
  onCopyMessage: () => void;
  hasMessageTemplate: boolean;
  onEdit: () => void;
  onRevoke: () => void;
  onExtend: () => void;
  isExtending: boolean;
  isEdit: boolean;
  dirty: boolean;
  onSaveEdits: () => void;
  isSaving: boolean;
}) {
  const expiresAt = link.expiresAt ? new Date(link.expiresAt) : null;
  const expiresAtLabel = expiresAt ? format(expiresAt, "MMM d, yyyy") : null;
  const lastViewed = link.lastViewedAt ? format(new Date(link.lastViewedAt), "MMM d, yyyy h:mm a") : null;
  const daysUntilExpiry = expiresAt
    ? Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const expiringSoon = typeof daysUntilExpiry === "number" && daysUntilExpiry <= EXPIRY_WARN_DAYS;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-panel p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-brand-emerald" />
          <span className="text-[calc(11.5px*var(--ui-scale))] font-medium text-ink-2">Active link</span>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 rounded-md bg-paper-2 text-[calc(12.5px*var(--ui-scale))] font-mono text-ink break-all">
            {link.url}
          </code>
          <Button variant="outline" size="sm" onClick={onCopyUrl} data-testid="button-copy-tracking-url">
            {copied === "url" ? <Check className="h-4 w-4 text-brand-emerald" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onClick={onCopyMessage}
            data-testid="button-copy-tracking-message"
          >
            {copied === "message" ? (
              <><Check className="h-4 w-4 mr-1.5" />Message copied</>
            ) : (
              <><MessageSquare className="h-4 w-4 mr-1.5" />Copy message</>
            )}
          </Button>
        </div>
        {!hasMessageTemplate && (
          <p className="mt-1.5 text-[calc(11px*var(--ui-scale))] text-ink-mute">
            Using the default template. Set your own in <em>Settings → Tracking Links</em>.
          </p>
        )}

        {qrSvg && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <div className="bg-white p-3 rounded-lg border border-line" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <p className="text-[calc(11px*var(--ui-scale))] text-ink-mute">Scan to open the page on a phone.</p>
          </div>
        )}
      </div>

      {expiringSoon && (
        <div
          className="rounded-md border border-warn/40 bg-warn-bg/60 px-3.5 py-2.5 flex items-center gap-3"
          data-testid="tracking-expiry-warning"
        >
          <AlertTriangle className="h-4 w-4 text-warn shrink-0" aria-hidden />
          <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-2 flex-1 m-0">
            {daysUntilExpiry !== null && daysUntilExpiry > 0
              ? `Link expires ${daysUntilExpiry === 1 ? "tomorrow" : `in ${daysUntilExpiry} days`}.`
              : "Link expires today."}
            {" "}Patients won't see updates after that.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[calc(11.5px*var(--ui-scale))] shrink-0"
            onClick={onExtend}
            disabled={isExtending}
            data-testid="button-extend-tracking-link"
          >
            <CalendarPlus className="h-3.5 w-3.5 mr-1" />
            {isExtending ? "Extending…" : `Extend ${EXTEND_BY_DAYS} days`}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Stat icon={<Eye className="h-3.5 w-3.5" />} label="Views" value={String(link.viewCount)} />
        <Stat icon={<CalendarClock className="h-3.5 w-3.5" />} label="Last viewed" value={lastViewed || "—"} small />
        <Stat
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="Expires"
          value={expiresAtLabel || "—"}
          small
          warn={expiringSoon}
        />
        <Stat icon={<Link2 className="h-3.5 w-3.5" />} label="Jobs covered" value={String(link.jobIds.length)} />
      </div>

      {isEdit && dirty && (
        <div className="rounded-md border border-otto-accent-line bg-otto-accent-soft px-3.5 py-2.5 flex items-center gap-3">
          <p className="text-[calc(12.5px*var(--ui-scale))] text-otto-accent-ink flex-1 m-0">
            You've changed link settings. Save to update what the patient sees.
          </p>
          <Button size="sm" onClick={onSaveEdits} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onEdit}>
          Edit settings
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onRevoke}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Revoke
        </Button>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  small,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  small?: boolean;
  warn?: boolean;
}) {
  return (
    <div className={cn("rounded-md border px-3 py-2.5", warn ? "border-warn/40 bg-warn-bg/40" : "border-line bg-panel")}>
      <div className={cn("text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-wider flex items-center gap-1", warn ? "text-warn" : "text-ink-mute")}>
        {icon}
        {label}
      </div>
      <div className={cn("mt-0.5 font-display font-medium text-ink", small ? "text-[calc(13px*var(--ui-scale))]" : "text-[calc(16px*var(--ui-scale))]")}>
        {value}
      </div>
    </div>
  );
}
