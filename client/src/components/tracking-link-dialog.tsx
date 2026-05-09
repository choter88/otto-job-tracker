// Patient tracking-link dialog: one-click create with two optional inputs
// (ETA, note) shown by default. Heavier customization (visible-statuses
// override) is collapsed behind a disclosure since 90% of links use the
// office defaults set in Settings → Tracking Links.
//
// Linked-sibling detection: when the dialog is opened from the bulk action
// bar with a subset of a link group, we surface a one-line prompt at the
// top so the user can include the rest with one click. The job-details
// path opens with the full group already selected, so this prompt only
// fires when the user really did pick a subset.

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
  Sliders,
  Plus,
  MessageSquare,
} from "lucide-react";
import QRCode from "qrcode";
import { renderMessageTemplate } from "@/components/customization/tracking-link-defaults-editor";
import type { Job, Office } from "@shared/schema";

// Show the expiry warning + extend CTA when the link expires within this
// many days. Picked by feel: long enough that staff have time to react,
// short enough that it doesn't nag for the whole 30-day lifetime.
const EXPIRY_WARN_DAYS = 7;
const EXTEND_BY_DAYS = 30;

const DEFAULT_VISIBLE_STATUSES = ["ordered", "in_progress", "ready_for_pickup"];

export interface TrackingLinkRecord {
  id: string;
  token: string;
  url: string;
  jobIds: string[];
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
  // Jobs the user explicitly selected. The dialog will detect any linked
  // siblings not in this set and offer to include them.
  jobs: Job[];
  // If provided, the dialog opens directly into the share view against an
  // existing link (edit mode).
  existingLink?: TrackingLinkRecord;
  onCreated?: (link: TrackingLinkRecord) => void;
  onUpdated?: (link: TrackingLinkRecord) => void;
  onRevoked?: () => void;
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

  // Office-wide defaults (set via Settings → Tracking Links). Used to seed
  // the per-link state, so the user typically just clicks Generate.
  const officeDefaults = useMemo(() => {
    const settings = (office?.settings || {}) as any;
    const fromSettings = settings?.trackingLinkDefaults || {};
    const visible = Array.isArray(fromSettings.visibleStatuses) && fromSettings.visibleStatuses.length > 0
      ? (fromSettings.visibleStatuses as string[])
      : DEFAULT_VISIBLE_STATUSES;
    const defaultNotes = typeof fromSettings.defaultNotes === "string" ? fromSettings.defaultNotes : "";
    const messageTemplate = typeof fromSettings.messageTemplate === "string" ? fromSettings.messageTemplate : "";
    return { visibleStatuses: visible, defaultNotes, messageTemplate };
  }, [office?.settings]);

  const customStatuses = useMemo(
    () => sortByOrder(((office?.settings as any)?.customStatuses || []) as any[]),
    [office?.settings],
  );

  // Linked-job sibling detection. We pull the office's full link-group map
  // and compute, for the explicitly-passed `jobs`, any siblings that aren't
  // already included. If the user is editing an existing link we skip the
  // prompt — the link's job set is already settled.
  const { data: linkGroupsMap } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/jobs/linked-ids"],
    enabled: open && !existingLink && jobs.length > 0,
  });

  // Cross-cache lookup: the worklist already has all jobs in queryClient. We
  // pull from there to render sibling badges (jobType, etc.) without an
  // extra fetch.
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
      for (const id of groupJobIds) {
        if (!selectedIds.has(id)) siblingIdSet.add(id);
      }
    }
    return allJobs.filter((j) => siblingIdSet.has(j.id));
  }, [linkGroupsMap, jobs, allJobs]);

  // The set the user has chosen to actually share — defaults to the
  // explicit selection; user can opt-in to siblings from the prompt.
  const [includeSiblings, setIncludeSiblings] = useState(false);
  useEffect(() => {
    if (!open) return;
    setIncludeSiblings(false);
  }, [open]);

  const effectiveJobs = useMemo<Job[]>(() => {
    if (!includeSiblings) return jobs;
    const map = new Map<string, Job>();
    for (const j of jobs) map.set(j.id, j);
    for (const j of siblingJobs) map.set(j.id, j);
    return Array.from(map.values());
  }, [includeSiblings, jobs, siblingJobs]);

  // ── Editable form state ─────────────────────────────────────────────
  const [visible, setVisible] = useState<string[]>([]);
  const [eta, setEta] = useState<string>(""); // ISO yyyy-mm-dd or ""
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
      setNotes(existingLink.customNotes ?? "");
      setGeneratedLink(existingLink);
      setPhase("share");
      setCustomizeOpen(false);
    } else {
      setVisible(officeDefaults.visibleStatuses);
      setEta("");
      setNotes(officeDefaults.defaultNotes || "");
      setGeneratedLink(null);
      setPhase("configure");
      setCustomizeOpen(false);
    }
    setCopied("none");
  }, [open, existingLink, officeDefaults]);

  const effectiveJobIds = useMemo(() => effectiveJobs.map((j) => j.id), [effectiveJobs]);

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
      toast({ title: "Tracking link generated", description: "Copy the URL or QR to share with your patient." });
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

  const [qrSvg, setQrSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!generatedLink?.url) {
      setQrSvg(null);
      return;
    }
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
      toast({ title: "Copy failed", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  };

  const handleCopyMessage = async () => {
    if (!generatedLink?.url) return;
    const etaFormatted = generatedLink.eta
      ? format(new Date(generatedLink.eta), "EEEE, MMMM d")
      : null;
    const message = renderMessageTemplate(officeDefaults.messageTemplate, {
      url: generatedLink.url,
      eta: etaFormatted,
    });
    try {
      await navigator.clipboard.writeText(message);
      setCopied("message");
      setTimeout(() => setCopied("none"), 2000);
      toast({ title: "Message copied", description: "Paste into Weave, SMS, or email." });
    } catch {
      toast({ title: "Copy failed", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  };

  // Push the link's expiry out by EXTEND_BY_DAYS days. The patient's URL
  // (token) stays the same, so any text/email already in their hands keeps
  // working — no need to re-send.
  const extendMutation = useMutation({
    mutationFn: async () => {
      if (!generatedLink) throw new Error("No link to extend");
      const newExpiresAt = new Date(Date.now() + EXTEND_BY_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const res = await apiRequest("PATCH", `/api/tracking-links/${generatedLink.id}`, {
        expiresAt: newExpiresAt,
      });
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

  const isEdit = !!existingLink;
  const dirty = isEdit && (
    JSON.stringify([...visible].sort()) !== JSON.stringify([...(existingLink!.visibleStatuses || [])].sort())
    || (eta || "") !== (existingLink!.eta?.slice(0, 10) || "")
    || (notes || "") !== (existingLink!.customNotes || "")
  );

  const visibleSet = new Set(visible);

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

                <section>
                  <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Estimated ready (optional)
                  </Label>
                  <Input
                    type="date"
                    value={eta}
                    onChange={(e) => setEta(e.target.value)}
                    className="mt-1.5 max-w-[220px] bg-white"
                  />
                </section>

                <section>
                  <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold flex items-center gap-1.5">
                    <StickyNote className="h-3.5 w-3.5" />
                    Note for the patient (optional)
                  </Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Your frames arrived early — we'll text you when ready."
                    className="mt-1.5 min-h-[68px] bg-white text-[calc(13px*var(--ui-scale))]"
                    maxLength={500}
                  />
                  <div className="mt-1.5 flex items-start gap-2 rounded-md border border-warn-bg bg-warn-bg/40 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-warn shrink-0 mt-0.5" aria-hidden />
                    <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-2 leading-snug">
                      Don't include patient names, phone numbers, or clinical details. The page is public.
                    </p>
                  </div>
                  <div className="mt-1 text-right text-[calc(11px*var(--ui-scale))] text-ink-faint">
                    {notes.length}/500
                  </div>
                </section>

                <Collapsible open={customizeOpen} onOpenChange={setCustomizeOpen}>
                  <CollapsibleTrigger
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-line bg-paper-2 hover:bg-paper text-[calc(12.5px*var(--ui-scale))] text-ink-2 font-medium transition-colors"
                    data-testid="tracking-customize-toggle"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Sliders className="h-3.5 w-3.5" />
                      Customize visible statuses for this patient
                    </span>
                    <ChevronDown className={cn("h-4 w-4 text-ink-mute transition-transform", customizeOpen && "rotate-180")} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3">
                    <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute mb-2 leading-snug">
                      Office defaults from Settings are pre-selected. Untoggle a status to hide it from this patient.
                    </p>
                    <div className="rounded-md border border-line bg-panel divide-y divide-line-2">
                      {customStatuses.map((s: any) => {
                        const checked = visibleSet.has(s.id);
                        return (
                          <label
                            key={s.id}
                            htmlFor={`vis-${s.id}`}
                            className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-paper-2/50"
                          >
                            <Checkbox
                              id={`vis-${s.id}`}
                              checked={checked}
                              onCheckedChange={(v) => {
                                setVisible((prev) =>
                                  v
                                    ? Array.from(new Set([...prev, s.id]))
                                    : prev.filter((x) => x !== s.id),
                                );
                              }}
                            />
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: s.color }}
                              aria-hidden
                            />
                            <span className="text-[calc(13px*var(--ui-scale))] text-ink">
                              {s.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex items-start gap-2 rounded-md border border-line bg-paper-2 px-3 py-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-brand-emerald shrink-0 mt-0.5" />
                  <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute leading-snug">
                    The patient page shows no name, contact info, or office identity — only the statuses, ETA, and your note.
                  </p>
                </div>
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
                  disabled={createMutation.isPending || effectiveJobIds.length === 0}
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

  return (
    <div
      className="rounded-md border border-otto-accent-line bg-otto-accent-soft px-3.5 py-2.5"
      data-testid="track-scope"
    >
      <div className="text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-wider text-otto-accent-ink">
        Tracking
      </div>
      <p className="mt-0.5 text-[calc(13px*var(--ui-scale))] text-ink m-0">
        {jobs.length === 1 ? "This job" : `${jobs.length} jobs`} — patient will see "{list}".
      </p>
    </div>
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
      <div className="h-7 w-7 rounded-full bg-info/15 grid place-items-center text-info shrink-0 mt-0.5">
        <Link2 className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[calc(12.5px*var(--ui-scale))] font-medium text-ink">
          {siblingJobs.length === 1 ? "1 linked job not included" : `${siblingJobs.length} linked jobs not included`}
        </div>
        <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute mt-0.5 m-0">
          Also tracking: {summary}. The patient probably wants one link covering everything.
        </p>
      </div>
      <Button
        size="sm"
        variant={included ? "secondary" : "outline"}
        className="h-7 text-[calc(11.5px*var(--ui-scale))] shrink-0"
        onClick={() => onToggle(!included)}
        data-testid="button-include-siblings"
      >
        {included ? (
          <>
            <Check className="h-3.5 w-3.5 mr-1" />
            Included
          </>
        ) : (
          <>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Include
          </>
        )}
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

  // Days-until-expiry — used to drive the warn state. Negative means already
  // expired (the public lookup would already 404; this is here for safety).
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
              <>
                <Check className="h-4 w-4 mr-1.5" />
                Message copied
              </>
            ) : (
              <>
                <MessageSquare className="h-4 w-4 mr-1.5" />
                Copy message
              </>
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
          <p className="text-[calc(12.5px*var(--ui-scale))] text-otto-accent-ink flex-1">
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
    <div
      className={cn(
        "rounded-md border px-3 py-2.5",
        warn ? "border-warn/40 bg-warn-bg/40" : "border-line bg-panel",
      )}
    >
      <div
        className={cn(
          "text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-wider flex items-center gap-1",
          warn ? "text-warn" : "text-ink-mute",
        )}
      >
        {icon}
        {label}
      </div>
      <div className={cn("mt-0.5 font-display font-medium text-ink", small ? "text-[calc(13px*var(--ui-scale))]" : "text-[calc(16px*var(--ui-scale))]")}>
        {value}
      </div>
    </div>
  );
}
