import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Check,
  Clock3,
  Copy,
  Eye,
  Hash,
  Info,
  Link2,
  MessageSquare,
  MoreVertical,
  Phone,
  QrCode,
  Save,
  Send,
  Share2,
  ShieldCheck,
  Sliders,
  Star,
  StickyNote,
  Trash2,
  Unlink,
  User,
  X,
} from "lucide-react";
import QRCode from "qrcode";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import JobCommentsPanel from "@/components/job-comments-panel";
import TrackingLinkDialog, { type TrackingLinkRecord } from "@/components/tracking-link-dialog";
import { renderMessageTemplate as renderTrackingMessageTemplate } from "@/components/customization/tracking-link-defaults-editor";
import { DEFAULT_VISIBLE_STATUSES } from "@shared/tracking-link-defaults";
import { TRACKER_NOTE_COMMENT_PREFIX } from "@/lib/tracker-note-comment";
import { getStatusBadgeStyle, getTypeBadgeStyle, getDestinationBadgeStyle } from "@/lib/default-colors";
import { sortByOrder } from "@/lib/custom-list-sort";
import { buildTrackStatuses, getStepIndex } from "@/lib/lifecycle";
import { formatPatientDisplayName } from "@shared/name-format";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { Job, Office } from "@shared/schema";

export type JobDetailsTab = "overview" | "comments" | "related" | "tracking";

interface JobStatusHistoryEntry {
  id: string;
  jobId: string;
  oldStatus: string | null;
  newStatus: string;
  changedAt: string | number | Date;
  changedBy: string | null;
  changedByUser: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
}

interface JobDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job?: Job;
  activeTab: JobDetailsTab;
  onActiveTabChange: (tab: JobDetailsTab) => void;
  onEditJob: (job: Job) => void;
  onSwitchJob?: (jobId: string) => void;
  flaggedJobIds?: string[];
  overdueJobIds?: Set<string>;
}

function toTitleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

export default function JobDetailsModal({
  open,
  onOpenChange,
  job,
  activeTab,
  onActiveTabChange,
  onEditJob,
  onSwitchJob,
  flaggedJobIds = [],
  overdueJobIds = new Set(),
}: JobDetailsModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId && open,
  });

  const { data: statusHistory = [], isLoading: historyLoading } = useQuery<JobStatusHistoryEntry[]>({
    queryKey: ["/api/jobs", job?.id, "status-history"],
    queryFn: async () => {
      if (!job?.id) return [];
      const res = await fetch(`/api/jobs/${job.id}/status-history`, { credentials: "include" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || payload?.message || res.statusText || "Failed to load status history");
      }
      return res.json();
    },
    enabled: !!job?.id && open,
  });

  const { data: relatedData } = useQuery<{ jobs: any[]; groupId: string | null }>({
    queryKey: ["/api/jobs", job?.id, "related"],
    queryFn: async () => {
      if (!job?.id) return { jobs: [], groupId: null };
      const res = await fetch(`/api/jobs/${job.id}/related`, { credentials: "include" });
      if (!res.ok) return { jobs: [], groupId: null };
      const data = await res.json();
      // Handle both old format (array) and new format ({ jobs, groupId })
      if (Array.isArray(data)) return { jobs: data, groupId: null };
      return data;
    },
    enabled: !!job?.id && open,
  });
  const relatedJobs = relatedData?.jobs ?? [];
  const linkGroupId = relatedData?.groupId ?? null;

  // Patient tracking links covering this job. We pass through both the focus
  // job and any auto/manually linked siblings — a single link can cover the
  // whole group, and we want to surface it from any sibling's detail view.
  const groupJobIds = useMemo(() => {
    const ids = new Set<string>();
    if (job?.id) ids.add(job.id);
    for (const rj of relatedJobs) {
      if (rj?.id && !rj.archived) ids.add(rj.id);
    }
    return Array.from(ids);
  }, [job?.id, relatedJobs]);

  const { data: trackingLinks } = useQuery<{ links: TrackingLinkRecord[] }>({
    queryKey: ["/api/tracking-links/list", groupJobIds.slice().sort().join(",")],
    queryFn: async () => {
      if (groupJobIds.length === 0) return { links: [] };
      const res = await apiRequest("POST", "/api/tracking-links/list", { jobIds: groupJobIds });
      return res.json();
    },
    enabled: open && groupJobIds.length > 0,
  });

  const activeTrackingLink = useMemo<TrackingLinkRecord | null>(() => {
    const links = trackingLinks?.links ?? [];
    const active = links.filter((l) => !l.revokedAt);
    if (active.length === 0) return null;
    // Prefer the most recently created active link.
    return active.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [trackingLinks?.links]);

  // Empty-state "Customize and generate" path opens the dialog; the
  // primary "Generate tracking link" CTA uses `directGenerateMutation`
  // below and skips the dialog entirely. Dialog is create-only now —
  // active-link edits live inline (see `inlineEditOpen`).
  const [trackingDialogOpen, setTrackingDialogOpen] = useState(false);
  const [trackingUrlCopied, setTrackingUrlCopied] = useState(false);
  const [trackingMessageCopied, setTrackingMessageCopied] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);

  // Inline edit state — replaces the dialog-hop "Edit settings" flow.
  // Seeded from the active link on open; reset on close. Save calls
  // PATCH /api/tracking-links/:id, then collapses.
  const [inlineEditOpen, setInlineEditOpen] = useState(false);
  const [editVisible, setEditVisible] = useState<string[]>([]);
  const [editEta, setEditEta] = useState<string>("");

  // Days until the active link expires — drives the warn state and the
  // Extend CTA below. Recomputed on render; we don't bother memoizing.
  const trackingDaysUntilExpiry = activeTrackingLink?.expiresAt
    ? Math.ceil((new Date(activeTrackingLink.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const trackingExpiringSoon = typeof trackingDaysUntilExpiry === "number" && trackingDaysUntilExpiry <= 7;

  const extendTrackingMutation = useMutation({
    mutationFn: async (linkId: string) => {
      const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const res = await apiRequest("PATCH", `/api/tracking-links/${linkId}`, { expiresAt: newExpiresAt });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
      toast({ title: "Link extended", description: "Now valid for another 30 days." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't extend link", description: error.message, variant: "destructive" });
    },
  });

  // One-click generate for the empty-state path. Posts with the
  // office's default visibleStatuses + defaultNotes; the dialog's
  // "Customize and generate" link stays for the rare per-job tweak.
  const directGenerateMutation = useMutation({
    mutationFn: async () => {
      if (!job?.id) throw new Error("No job");
      const settings = (office?.settings || {}) as any;
      const tld = (settings?.trackingLinkDefaults || {}) as {
        visibleStatuses?: string[];
        defaultNotes?: string;
      };
      const visibleStatuses =
        Array.isArray(tld.visibleStatuses) && tld.visibleStatuses.length > 0
          ? tld.visibleStatuses
          : DEFAULT_VISIBLE_STATUSES;
      const customNotes =
        typeof tld.defaultNotes === "string" && tld.defaultNotes.trim().length > 0
          ? tld.defaultNotes
          : null;
      const res = await apiRequest("POST", "/api/tracking-links", {
        jobIds: [job.id],
        visibleStatuses,
        customNotes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
      toast({ title: "Tracking link generated", description: "Copy the message to share with your patient." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't generate link", description: error.message, variant: "destructive" });
    },
  });

  // Inline-edit save (visible-statuses + ETA). PATCH on the active
  // link; the broader "edit notes/template/etc" surface lives in the
  // bigger TrackingLinkDialog still — though only via the empty-state
  // customize path now, never as an active-link edit.
  const updateInlineSettingsMutation = useMutation({
    mutationFn: async () => {
      if (!activeTrackingLink) throw new Error("No link");
      const res = await apiRequest("PATCH", `/api/tracking-links/${activeTrackingLink.id}`, {
        visibleStatuses: editVisible,
        eta: editEta ? new Date(editEta + "T00:00:00").toISOString() : null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
      setInlineEditOpen(false);
      toast({ title: "Tracking link updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
    },
  });

  const revokeTrackingMutation = useMutation({
    mutationFn: async (linkId: string) => {
      const res = await apiRequest("POST", `/api/tracking-links/${linkId}/revoke`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
      setConfirmRevokeOpen(false);
      toast({ title: "Tracking link revoked", description: "The link is no longer active." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't revoke", description: error.message, variant: "destructive" });
    },
  });

  // Seed the inline-edit form whenever it's opened. Reset whenever the
  // active link changes (e.g. revoke + regenerate) so stale values
  // don't leak between sessions.
  useEffect(() => {
    if (!inlineEditOpen) return;
    if (!activeTrackingLink) return;
    setEditVisible(
      activeTrackingLink.visibleStatuses.length > 0
        ? [...activeTrackingLink.visibleStatuses]
        : [...DEFAULT_VISIBLE_STATUSES],
    );
    setEditEta(activeTrackingLink.eta ? activeTrackingLink.eta.slice(0, 10) : "");
  }, [inlineEditOpen, activeTrackingLink?.id]);

  // Reset the inline editor + QR panel when the active link goes away
  // or when the modal closes. Avoids the QR/edit panel "ghosting" into
  // an empty-state view if the user revokes from the overflow menu.
  useEffect(() => {
    if (!activeTrackingLink || !open) {
      setInlineEditOpen(false);
      setQrVisible(false);
    }
  }, [activeTrackingLink?.id, open]);

  // Lazy-load the QR SVG when the panel is toggled visible. Cleared
  // when the URL changes or the panel hides so we don't paint a stale
  // QR after a revoke + regenerate.
  useEffect(() => {
    if (!qrVisible || !activeTrackingLink?.url) {
      setQrSvg(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const svg = await QRCode.toString(activeTrackingLink.url, {
          type: "svg",
          margin: 1,
          width: 200,
        });
        if (!cancelled) setQrSvg(svg);
      } catch {
        if (!cancelled) setQrSvg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qrVisible, activeTrackingLink?.url]);

  // ── "Note for patient" composer state + save flow ──
  // Two side effects per save:
  //   1. PATCH the tracking link's customNotes — what the patient sees on
  //      the public page.
  //   2. POST a job comment prefixed with TRACKER_NOTE_COMMENT_PREFIX so
  //      staff can see in the Comments tab (a) that a tracker note was
  //      set/updated, (b) what was set, and (c) when. Acts as the audit
  //      trail because the patient page only shows the *current* note.
  const [patientNoteDraft, setPatientNoteDraft] = useState("");
  const [patientNoteDirty, setPatientNoteDirty] = useState(false);
  // Seed the draft when the active link changes (or first loads).
  useEffect(() => {
    if (!activeTrackingLink) {
      setPatientNoteDraft("");
      setPatientNoteDirty(false);
      return;
    }
    setPatientNoteDraft(activeTrackingLink.customNotes ?? "");
    setPatientNoteDirty(false);
  }, [activeTrackingLink?.id, activeTrackingLink?.customNotes]);

  const updatePatientNoteMutation = useMutation({
    mutationFn: async ({ linkId, jobId, note }: { linkId: string; jobId: string; note: string }) => {
      const trimmed = note.trim();
      // 1. Update the tracking link's note (PHI scan happens server-side
      //    on the desktop). Empty string clears the note.
      const res = await apiRequest("PATCH", `/api/tracking-links/${linkId}`, {
        customNotes: trimmed.length > 0 ? trimmed : null,
      });
      const json = await res.json();
      // 2. Audit comment on the job. Use a marker prefix so the Comments
      //    tab can render it distinctly; trim at create time so a note
      //    that's just whitespace doesn't generate an empty comment.
      if (trimmed.length > 0) {
        await apiRequest("POST", `/api/jobs/${jobId}/comments`, {
          content: TRACKER_NOTE_COMMENT_PREFIX + trimmed,
        }).catch((err) => {
          // Comment failure shouldn't block the patient-facing update.
          console.error("[tracking note] comment audit failed:", err);
        });
      }
      return json.link as TrackingLinkRecord;
    },
    onSuccess: () => {
      setPatientNoteDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job?.id, "comments"] });
      toast({ title: "Note updated", description: "The patient will see your update on their tracking page." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't save note", description: error.message, variant: "destructive" });
    },
  });

  // Group notes for linked jobs
  const { data: groupNotes = [] } = useQuery<any[]>({
    queryKey: ["/api/link-groups", linkGroupId, "notes"],
    queryFn: async () => {
      if (!linkGroupId) return [];
      const res = await fetch(`/api/link-groups/${linkGroupId}/notes`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!linkGroupId && open,
  });

  const [newGroupNote, setNewGroupNote] = useState("");

  const addGroupNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!linkGroupId) throw new Error("No link group");
      const res = await apiRequest("POST", `/api/link-groups/${linkGroupId}/notes`, { content });
      return res.json();
    },
    onSuccess: () => {
      setNewGroupNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/link-groups", linkGroupId, "notes"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add note", description: error.message, variant: "destructive" });
    },
  });

  const deleteGroupNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiRequest("DELETE", `/api/link-groups/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/link-groups", linkGroupId, "notes"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete note", description: error.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/jobs/${jobId}/link`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job?.id, "related"] });
      toast({ title: "Job unlinked" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to unlink job", description: error.message, variant: "destructive" });
    },
  });

  // Star (flag) state — moved here from the worklist when the star column was
  // removed. The modal owns both the action and the "why is this starred?"
  // note prompt now. flaggedJobs comes from the per-user endpoint, so the
  // filled-star state reflects the *current viewer's* star, matching the
  // worklist patient-cell indicator.
  const [starDialogOpen, setStarDialogOpen] = useState(false);
  const [starNote, setStarNote] = useState("");

  const { data: flaggedJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs/flagged"],
    enabled: open,
  });
  const isStarredByMe = !!job?.id && flaggedJobs.some((f: any) => f.id === job.id && f.flaggedBy?.id === user?.id);

  const starJobMutation = useMutation({
    mutationFn: async ({ jobId, note }: { jobId: string; note: string }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/flag`, { importantNote: note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flagged"] });
      setStarDialogOpen(false);
      setStarNote("");
      toast({ title: "Starred", description: "Job added to your Starred list." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't star", description: error.message, variant: "destructive" });
    },
  });

  const unstarJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/jobs/${jobId}/flag`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flagged"] });
      toast({ title: "Star removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't unstar", description: error.message, variant: "destructive" });
    },
  });

  const handleToggleStar = () => {
    if (!job?.id) return;
    if (isStarredByMe) {
      unstarJobMutation.mutate(job.id);
    } else {
      setStarNote("");
      setStarDialogOpen(true);
    }
  };

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      if (!job?.id) return;
      // Server endpoint is PUT /api/jobs/:id (not PATCH). Earlier code used
      // PATCH which silently 405'd, making the Advance / Mark CTA buttons
      // appear inert.
      await apiRequest("PUT", `/api/jobs/${job.id}`, { status: newStatus });
    },
    onSuccess: (_data, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job?.id, "status-history"] });
      const label = customStatuses.find((s: any) => s.id === newStatus)?.label || newStatus;
      toast({ title: "Status updated", description: `Set to ${label}.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    },
  });

  const customStatuses = useMemo(() => sortByOrder((office?.settings?.customStatuses || []) as any[]), [office?.settings?.customStatuses]);
  const customJobTypes = useMemo(() => sortByOrder((office?.settings?.customJobTypes || []) as any[]), [office?.settings?.customJobTypes]);
  const customOrderDestinations = useMemo(
    () => sortByOrder((office?.settings?.customOrderDestinations || []) as any[]),
    [office?.settings?.customOrderDestinations],
  );
  const customColumns = useMemo(
    () => sortByOrder((office?.settings?.customColumns || []) as any[]).filter((col: any) => col.active),
    [office?.settings?.customColumns],
  );
  const jobIdentifierMode = useMemo(() => (office?.settings?.jobIdentifierMode || "patientName") as string, [office?.settings?.jobIdentifierMode]);
  const useTrayNumber = jobIdentifierMode === "trayNumber";

  const getStatusLabel = (status: string) =>
    customStatuses.find((entry) => entry.id === status)?.label || toTitleCase(status);
  const getJobTypeLabel = (jobType: string) =>
    customJobTypes.find((entry) => entry.id === jobType)?.label || toTitleCase(jobType);
  const getDestinationLabel = (destination: string) =>
    customOrderDestinations.find((entry) => entry.id === destination || entry.label === destination)?.label ||
    toTitleCase(destination);

  const getStatusBadgeColor = (status: string) =>
    getStatusBadgeStyle(status, customStatuses);

  const getJobTypeBadgeColor = (jobType: string) =>
    getTypeBadgeStyle(jobType, customJobTypes);

  // Used by the Related tab's per-row destination badge.
  const getDestinationBadgeColor = (destination: string) =>
    getDestinationBadgeStyle(destination, customOrderDestinations);

  if (!job) return null;

  const patientDisplayName = useTrayNumber
    ? job.trayNumber || "Tray not set"
    : formatPatientDisplayName(job.patientFirstName, job.patientLastName) || "Unnamed patient";

  const statusBadgeColor = getStatusBadgeColor(job.status);

  // Compute the next forward status for the "Mark <next>" footer button.
  const trackStatuses = buildTrackStatuses(customStatuses);
  const currentStepIdx = getStepIndex(trackStatuses, job.status);
  const nextStatus = currentStepIdx >= 0 && currentStepIdx < trackStatuses.length - 1
    ? trackStatuses[currentStepIdx + 1]
    : null;
  const previousStatus = currentStepIdx > 0 ? trackStatuses[currentStepIdx - 1] : null;

  // Job comments — used for activity timeline + tab badge counts.
  const lastUpdatedRelative = (() => {
    try {
      return formatDistanceToNow(new Date(job.updatedAt), { addSuffix: true });
    } catch {
      return "";
    }
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed height keeps the footer + tabs anchored regardless of which
          tab is showing — tab bodies scroll internally. hideClose suppresses
          Radix's default top-right X (we render our own inside the custom
          header). */}
      <DialogContent
        hideClose
        className="max-w-[1013px] w-[min(1013px,calc(100vw-48px))] h-[min(720px,calc(100vh-64px))] p-0 overflow-hidden flex flex-col gap-0"
        data-testid="dialog-job-details"
      >
        {/* Header — patient/tray identifier, status pill, star, close X */}
        <div className="flex items-center gap-3 px-6 py-[18px] border-b border-line">
          <h3 className="font-display text-[calc(20px*var(--ui-scale))] font-medium tracking-[-0.025em] text-ink m-0 truncate">
            {patientDisplayName}
          </h3>
          <Badge
            className="border-0 shrink-0"
            style={{ backgroundColor: statusBadgeColor.background, color: statusBadgeColor.text }}
            data-testid="badge-job-status"
          >
            {getStatusLabel(job.status)}
          </Badge>
          {job.isRedoJob && (
            <Badge className="border-0 shrink-0 bg-danger-bg text-danger" data-testid="badge-redo">
              REDO
            </Badge>
          )}
          <span className="flex-1" />
          {/* Star toggle — sits in the header next to Close because starring
              is an "about this job" action, not a workflow action. Filled
              star + warn color reads "starred by you" without needing a
              tooltip; the unstarred state is a quiet outline. */}
          <button
            type="button"
            onClick={handleToggleStar}
            disabled={starJobMutation.isPending || unstarJobMutation.isPending}
            className={cn(
              "h-8 px-2.5 rounded-md grid grid-flow-col items-center gap-1.5 shrink-0 text-[calc(12.5px*var(--ui-scale))] font-medium transition-colors",
              isStarredByMe
                ? "bg-warn-bg/60 text-warn hover:bg-warn-bg ring-1 ring-warn/20"
                : "text-ink-mute hover:bg-line-2 hover:text-ink",
            )}
            aria-pressed={isStarredByMe}
            title={isStarredByMe ? "Remove your star" : "Star this job"}
            data-testid="button-star-job"
          >
            <Star
              className={cn(
                "h-4 w-4",
                isStarredByMe ? "fill-warn text-warn" : "text-current",
              )}
              aria-hidden
            />
            <span className="hidden sm:inline">
              {isStarredByMe ? "Starred" : "Star"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-8 h-8 rounded-md grid place-items-center text-ink-mute hover:bg-line-2 hover:text-ink shrink-0"
            aria-label="Close"
            data-testid="button-close-job-details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            onActiveTabChange(value as JobDetailsTab);
            const tabEvent = value === "comments"
              ? "job_detail_tab_comments"
              : value === "related"
                ? "job_detail_tab_related"
                : value === "tracking"
                  ? "job_detail_tab_tracking"
                  : "job_detail_tab_overview";
            fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ eventType: tabEvent }) }).catch(() => {});
          }}
          className="flex-1 flex flex-col min-h-0"
        >
          {/* Underline-style tabs (mockup). Trigger row is fixed-height so
              switching tabs doesn't reflow the modal even when the Related
              trigger appears asynchronously. */}
          <TabsList className="flex h-[40px] shrink-0 bg-transparent p-0 px-4 border-b border-line rounded-none justify-start gap-0">
            <TabsTrigger
              value="overview"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-ink data-[state=active]:border-b-2 data-[state=active]:border-ink rounded-none px-3.5 py-2.5 -mb-px text-[calc(13px*var(--ui-scale))] font-medium text-ink-mute hover:text-ink-2 gap-1.5"
              data-testid="tab-job-details-overview"
            >
              <Info className="h-[14px] w-[14px]" />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="comments"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-ink data-[state=active]:border-b-2 data-[state=active]:border-ink rounded-none px-3.5 py-2.5 -mb-px text-[calc(13px*var(--ui-scale))] font-medium text-ink-mute hover:text-ink-2 gap-1.5"
              data-testid="tab-job-details-comments"
            >
              <MessageSquare className="h-[14px] w-[14px]" />
              Comments
            </TabsTrigger>
            <TabsTrigger
              value="tracking"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-ink data-[state=active]:border-b-2 data-[state=active]:border-ink rounded-none px-3.5 py-2.5 -mb-px text-[calc(13px*var(--ui-scale))] font-medium text-ink-mute hover:text-ink-2 gap-1.5"
              data-testid="tab-job-details-tracking"
            >
              <Share2 className="h-[14px] w-[14px]" />
              Patient tracking
              {activeTrackingLink && (
                <span
                  className="ml-0.5 inline-flex items-center justify-center h-4 px-1.5 rounded-full text-[calc(10px*var(--ui-scale))] font-semibold bg-otto-accent text-white"
                  aria-label="Active tracking link"
                >
                  Live
                </span>
              )}
            </TabsTrigger>
            {relatedJobs.length > 0 && (
              <TabsTrigger
                value="related"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-ink data-[state=active]:border-b-2 data-[state=active]:border-ink rounded-none px-3.5 py-2.5 -mb-px text-[calc(13px*var(--ui-scale))] font-medium text-ink-mute hover:text-ink-2 gap-1.5"
                data-testid="tab-job-details-related"
              >
                <Link2 className="h-[14px] w-[14px]" />
                Related <span className="text-[calc(11px*var(--ui-scale))] font-mono text-ink-faint">{relatedJobs.length + 1}</span>
              </TabsTrigger>
            )}
          </TabsList>

          {/* Reverted from forceMount + data-[state=inactive]:hidden because
              keeping the Comments panel mounted while hidden made it appear
              empty when the user actually clicked into the tab (the panel
              has its own focus + read-mark side effects that mis-fired in
              the hidden mount). overflow-y-scroll on every tab keeps the
              scrollbar gutter present so switching tabs doesn't shift the
              tab body width on systems with non-overlay scrollbars. */}
          <TabsContent
            value="overview"
            className="mt-0 flex-1 min-h-0 overflow-y-scroll px-6 py-5"
          >
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-7">
              {/* Left column: Patient & Order, Custom fields, Notes */}
              <div>
                <h4 className="flex items-center gap-1.5 text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute mb-3">
                  <User className="h-3 w-3" aria-hidden />
                  Patient &amp; Order
                </h4>
                <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3 text-[calc(13px*var(--ui-scale))]">
                  <dt className="text-ink-mute pt-0.5">{useTrayNumber ? "Tray" : "Patient"}</dt>
                  <dd className="m-0 flex items-center gap-2">
                    {/* Avatar tinted with the current status color so the
                        identity in the header pill carries through to the
                        body — gives the modal a cohesive accent rather than
                        a bland gray circle. */}
                    <span
                      className="w-7 h-7 rounded-full grid place-items-center text-[calc(10.5px*var(--ui-scale))] font-semibold tracking-wider shrink-0 ring-1 ring-inset ring-line"
                      style={{ backgroundColor: statusBadgeColor.background, color: statusBadgeColor.text }}
                      aria-hidden
                    >
                      {(patientDisplayName || "?").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0] || "").join("").toUpperCase() || "?"}
                    </span>
                    <span className="font-medium">{patientDisplayName}</span>
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Phone</dt>
                  <dd className="m-0 flex items-center gap-1.5">
                    <span className="font-mono text-[calc(12.5px*var(--ui-scale))]">{job.phone || "—"}</span>
                    {job.phone && (
                      <button
                        type="button"
                        onClick={() => { window.location.href = `tel:${job.phone}`; }}
                        className="w-6 h-6 rounded grid place-items-center text-otto-accent-ink hover:bg-otto-accent-soft hover:text-otto-accent-strong transition-colors"
                        aria-label="Call"
                        title="Call"
                        data-testid="button-call-patient"
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Job type</dt>
                  <dd className="m-0">
                    {(() => {
                      const c = getJobTypeBadgeColor(job.jobType);
                      return (
                        <Badge
                          className="border-0"
                          style={{ backgroundColor: c.background, color: c.text }}
                        >
                          {getJobTypeLabel(job.jobType)}
                        </Badge>
                      );
                    })()}
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Sent to</dt>
                  <dd className="m-0">
                    <Badge className="border-0 bg-paper-2 text-ink-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-ink-3 mr-1.5" />
                      {getDestinationLabel(job.orderDestination)}
                    </Badge>
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Created</dt>
                  <dd className="m-0 font-mono text-[calc(12.5px*var(--ui-scale))]">
                    {format(new Date(job.createdAt), "MMM d · HH:mm")}
                  </dd>

                  <dt className="text-ink-mute pt-0.5">Updated</dt>
                  <dd className="m-0 font-mono text-[calc(12.5px*var(--ui-scale))]">
                    {lastUpdatedRelative}
                  </dd>
                </dl>

                {customColumns.length > 0 && (
                  <>
                    <div className="border-t border-line my-5" />
                    <h4 className="flex items-center gap-1.5 text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute mb-3">
                      <Hash className="h-3 w-3" aria-hidden />
                      Custom fields
                    </h4>
                    <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3 text-[calc(13px*var(--ui-scale))]">
                      {customColumns.map((column: any) => {
                        const value = (job.customColumnValues as Record<string, any>)?.[column.id];
                        const displayValue =
                          column.type === "checkbox" ? (value ? "Yes" : "No") : value || "—";
                        return (
                          <div key={column.id} className="contents">
                            <dt className="text-ink-mute pt-0.5">{column.name}</dt>
                            <dd className="m-0 font-medium">{displayValue}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </>
                )}

                <div className="border-t border-line my-5" />
                <h4 className="flex items-center gap-1.5 text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute mb-3">
                  <StickyNote className="h-3 w-3" aria-hidden />
                  Notes
                </h4>
                {/* Warm notepaper tint + amber left-rail evokes a real
                    sticky note without leaving the design language —
                    --warn-bg is the same amber Otto already uses for
                    overdue / warning surfaces, just dialed back. */}
                <div className="rounded-lg bg-warn-bg/40 border border-warn/15 border-l-[3px] border-l-warn/60 px-3.5 py-2.5 text-[calc(13px*var(--ui-scale))] leading-relaxed text-ink-2 min-h-[60px]">
                  {job.notes?.trim() ? (
                    <p className="whitespace-pre-wrap m-0">{job.notes}</p>
                  ) : (
                    <p className="text-ink-mute italic m-0">No notes added.</p>
                  )}
                </div>

              </div>

              {/* Right column: Timeline (lifecycle history with actor + timestamp). */}
              <div>
                <h4 className="flex items-center gap-1.5 text-[calc(10.5px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute mb-3">
                  <Clock3 className="h-3 w-3" aria-hidden />
                  Timeline
                </h4>
                <div className="relative pl-[18px]">
                  {/* Vertical line behind timeline dots */}
                  <span className="absolute left-[5px] top-2 bottom-2 w-[1.5px] bg-line" aria-hidden />
                  {trackStatuses.map((s) => {
                    const stepIdx = trackStatuses.findIndex((t) => t.id === s.id);
                    const isPast = stepIdx < currentStepIdx;
                    const isCurrent = stepIdx === currentStepIdx;
                    const entry = statusHistory.find((e) => e.newStatus === s.id);
                    const actorName = entry
                      ? (entry.changedByUser?.firstName || entry.changedByUser?.lastName
                          ? `${entry.changedByUser?.firstName || ""} ${entry.changedByUser?.lastName || ""}`.trim()
                          : "System")
                      : null;
                    // Past dots inherit each step's own status color so the
                    // timeline reads as a journey through the office's
                    // status palette instead of a uniform gray run. Current
                    // step keeps the otto-accent glow as the focal point;
                    // pending stays empty/outlined.
                    const stepColor = isPast ? getStatusBadgeColor(s.id) : null;
                    return (
                      <div key={s.id} className="relative py-1.5">
                        <span
                          className={cn(
                            "absolute -left-[17px] top-2 w-[9px] h-[9px] rounded-full",
                            isCurrent && "bg-otto-accent ring-[1.5px] ring-otto-accent shadow-[0_0_0_4px_var(--otto-accent-soft)]",
                            !isPast && !isCurrent && "bg-panel ring-[1.5px] ring-line-strong",
                          )}
                          style={
                            stepColor
                              ? { backgroundColor: stepColor.text, boxShadow: `0 0 0 1.5px ${stepColor.text}` }
                              : undefined
                          }
                          aria-hidden
                        />
                        <div className={cn(
                          "text-[calc(13px*var(--ui-scale))] leading-tight",
                          isCurrent ? "font-semibold text-ink" : "font-medium text-ink",
                          !isPast && !isCurrent && "text-ink-2",
                        )}>
                          {s.label}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {entry ? (
                            <>
                              <span className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute">{actorName}</span>
                              <span className="font-mono text-[calc(11px*var(--ui-scale))] text-ink-mute">
                                {format(new Date(entry.changedAt), "MMM d · HH:mm")}
                              </span>
                            </>
                          ) : isCurrent ? (
                            <span className="text-[calc(11.5px*var(--ui-scale))] text-otto-accent-ink italic">in progress · now</span>
                          ) : (
                            <span className="text-[calc(11.5px*var(--ui-scale))] text-ink-faint italic">pending</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* No bottom "Loading…" sentinel — the timeline renders
                      its skeleton state from trackStatuses synchronously and
                      fills in actor/timestamps as statusHistory arrives, so
                      we avoid a height shift when the async query resolves. */}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent
            value="comments"
            className="mt-0 flex-1 min-h-0 overflow-hidden"
          >
            <div className="h-full overflow-hidden bg-panel">
              <JobCommentsPanel job={job} />
            </div>
          </TabsContent>

          {/* Patient tracking tab — share-first redesign:
              big "Copy message" CTA, URL as caption, overflow menu for
              the rare actions (QR / edit / extend / revoke), inline
              editor when staff want to tweak settings. */}
          <TabsContent
            value="tracking"
            className="mt-0 flex-1 min-h-0 overflow-y-scroll px-6 py-5"
          >
            {activeTrackingLink ? (
              <div className="space-y-5" data-testid="tracking-tab-active">
                {/* Share section — the 90% surface. Compact header with
                    the job's current status + an overflow menu; below,
                    the dominant "Copy message" button. */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    {(() => {
                      const statusMeta = customStatuses.find((s: any) => s.id === job.status);
                      const statusLabel = statusMeta?.label ?? toTitleCase(job.status || "");
                      const statusColor = statusMeta?.color ?? "#94a3b8";
                      return (
                        <Badge
                          variant="outline"
                          className="h-6 gap-1.5 border-line bg-paper-2 text-ink-2 font-medium"
                          style={{ borderColor: statusColor + "55" }}
                          data-testid="tracking-tab-status-badge"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: statusColor }}
                            aria-hidden
                          />
                          {statusLabel}
                        </Badge>
                      );
                    })()}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-ink-mute hover:text-ink"
                          aria-label="Tracking link actions"
                          data-testid="tracking-link-actions-menu"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          onSelect={async () => {
                            try {
                              await navigator.clipboard.writeText(activeTrackingLink.url);
                              setTrackingUrlCopied(true);
                              setTimeout(() => setTrackingUrlCopied(false), 2000);
                              toast({ title: "URL copied" });
                            } catch {
                              toast({ title: "Copy failed", variant: "destructive" });
                            }
                          }}
                          data-testid="menu-copy-url"
                        >
                          <Copy className="h-3.5 w-3.5 mr-2" />
                          Copy URL only
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setQrVisible((v) => !v)}
                          data-testid="menu-toggle-qr"
                        >
                          <QrCode className="h-3.5 w-3.5 mr-2" />
                          {qrVisible ? "Hide QR code" : "Show QR code"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setInlineEditOpen((v) => !v)}
                          data-testid="menu-edit-settings"
                        >
                          <Sliders className="h-3.5 w-3.5 mr-2" />
                          {inlineEditOpen ? "Close editor" : "Edit settings"}
                        </DropdownMenuItem>
                        {trackingExpiringSoon && (
                          <DropdownMenuItem
                            onSelect={() => extendTrackingMutation.mutate(activeTrackingLink.id)}
                            disabled={extendTrackingMutation.isPending}
                            data-testid="menu-extend"
                          >
                            <CalendarPlus className="h-3.5 w-3.5 mr-2" />
                            Extend 30 days
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => setConfirmRevokeOpen(true)}
                          className="text-destructive focus:text-destructive"
                          data-testid="menu-revoke"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Revoke link
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Primary CTA — copies the office's message template
                      with {url} and {eta} substituted. This is the 90%
                      workflow: staff paste into Weave / SMS / email. */}
                  <Button
                    size="lg"
                    className="w-full h-12 text-[calc(14px*var(--ui-scale))] font-semibold gap-2"
                    onClick={async () => {
                      const settings = (office?.settings || {}) as any;
                      const template = settings?.trackingLinkDefaults?.messageTemplate;
                      const etaFormatted = activeTrackingLink.eta
                        ? format(new Date(activeTrackingLink.eta), "EEEE, MMMM d")
                        : null;
                      const message = renderTrackingMessageTemplate(template, {
                        url: activeTrackingLink.url,
                        eta: etaFormatted,
                      });
                      try {
                        await navigator.clipboard.writeText(message);
                        setTrackingMessageCopied(true);
                        setTimeout(() => setTrackingMessageCopied(false), 2000);
                        toast({
                          title: "Message copied",
                          description: "Paste into Weave, SMS, or email.",
                        });
                        fetch("/api/track", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({
                            eventType: "tracking_link_copy_link",
                            metadata: { source: "tracking_tab_message" },
                          }),
                        }).catch(() => {});
                      } catch {
                        toast({ title: "Copy failed", variant: "destructive" });
                      }
                    }}
                    data-testid="button-copy-tracking-message"
                  >
                    {trackingMessageCopied ? (
                      <>
                        <Check className="h-4 w-4" />
                        Message copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        Copy message
                      </>
                    )}
                  </Button>

                  {/* URL caption + meta footer. */}
                  <div className="space-y-1.5">
                    <div
                      className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute font-mono truncate"
                      title={activeTrackingLink.url}
                      data-testid="tracking-link-summary"
                    >
                      {activeTrackingLink.url}
                      {trackingUrlCopied && (
                        <span className="ml-2 text-brand-emerald not-italic font-sans">Copied</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[calc(11px*var(--ui-scale))] text-ink-faint">
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {activeTrackingLink.viewCount} view{activeTrackingLink.viewCount === 1 ? "" : "s"}
                      </span>
                      {activeTrackingLink.lastViewedAt && (
                        <span>· last {format(new Date(activeTrackingLink.lastViewedAt), "MMM d · HH:mm")}</span>
                      )}
                      {activeTrackingLink.expiresAt && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            trackingExpiringSoon ? "text-warn font-medium" : "",
                          )}
                          data-testid="tracking-link-expiry"
                        >
                          {trackingExpiringSoon && <AlertTriangle className="h-3 w-3" aria-hidden />}
                          {trackingDaysUntilExpiry !== null && trackingDaysUntilExpiry > 0
                            ? `Expires ${trackingDaysUntilExpiry === 1 ? "tomorrow" : `in ${trackingDaysUntilExpiry} days`}`
                            : trackingDaysUntilExpiry === 0
                              ? "Expires today"
                              : `Expired ${format(new Date(activeTrackingLink.expiresAt), "MMM d")}`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* QR panel — toggled from the overflow menu. */}
                  {qrVisible && (
                    <div
                      className="rounded-lg border border-line bg-panel p-4 flex items-center justify-center"
                      data-testid="tracking-tab-qr"
                    >
                      {qrSvg ? (
                        <div
                          className="w-[200px] h-[200px]"
                          dangerouslySetInnerHTML={{ __html: qrSvg }}
                        />
                      ) : (
                        <span className="text-[calc(12px*var(--ui-scale))] text-ink-mute">Loading QR…</span>
                      )}
                    </div>
                  )}
                </section>

                {/* Inline editor — replaces the dialog-hop. Visible
                    statuses + ETA only; bigger edits (notes, template,
                    etc.) go through Settings → Tracking Links. */}
                {inlineEditOpen && (
                  <section
                    className="rounded-lg border border-line bg-panel p-4 space-y-3"
                    data-testid="tracking-tab-inline-edit"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-[calc(11px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute m-0 flex items-center gap-1.5">
                        <Sliders className="h-3.5 w-3.5" />
                        Edit tracking settings
                      </h4>
                    </div>
                    <div>
                      <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
                        Visible statuses
                      </Label>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                        {customStatuses
                          .filter((s: any) => s.id !== "delayed")
                          .map((s: any) => {
                            const checked = editVisible.includes(s.id);
                            const id = `inline-vis-${s.id}`;
                            return (
                              <label
                                key={s.id}
                                htmlFor={id}
                                className="flex items-center gap-2 cursor-pointer text-[calc(12.5px*var(--ui-scale))] text-ink"
                              >
                                <Checkbox
                                  id={id}
                                  checked={checked}
                                  onCheckedChange={(v) => {
                                    setEditVisible((prev) =>
                                      v
                                        ? Array.from(new Set([...prev, s.id]))
                                        : prev.filter((x) => x !== s.id),
                                    );
                                  }}
                                />
                                <span
                                  className="h-1.5 w-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: s.color }}
                                  aria-hidden
                                />
                                <span>{s.label}</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                    <div>
                      <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
                        Estimated ready
                      </Label>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Input
                          type="date"
                          value={editEta}
                          onChange={(e) => setEditEta(e.target.value)}
                          className="max-w-[220px] bg-white"
                          data-testid="tracking-inline-eta"
                        />
                        {editEta && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-[calc(11.5px*var(--ui-scale))] text-ink-mute hover:text-ink"
                            onClick={() => setEditEta("")}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => updateInlineSettingsMutation.mutate()}
                        disabled={updateInlineSettingsMutation.isPending}
                        data-testid="button-save-inline-edit"
                      >
                        <Save className="h-3.5 w-3.5 mr-1.5" />
                        {updateInlineSettingsMutation.isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-ink-mute hover:text-ink"
                        onClick={() => setInlineEditOpen(false)}
                        data-testid="button-cancel-inline-edit"
                      >
                        Cancel
                      </Button>
                    </div>
                  </section>
                )}

                {/* Note for patient composer. The current note (if any) is
                    what's on the patient page right now; the textarea is
                    the next note that will be saved. Saving updates the
                    tracker AND posts a tracker-note comment to the job. */}
                <section data-testid="tracking-tab-note">
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-[calc(11px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute m-0 flex items-center gap-1.5">
                      <StickyNote className="h-3.5 w-3.5" />
                      Note for patient
                    </h4>
                    {patientNoteDirty && (
                      <span className="text-[calc(11px*var(--ui-scale))] text-ink-mute italic">
                        Unsaved
                      </span>
                    )}
                  </div>
                  <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute leading-snug mb-2">
                    A short message the patient will see on their tracking page. Use this for generic updates the patient should know about — e.g. <em>"Lens was delayed. We expect it to arrive on 6/1."</em> Don't include patient names, phone numbers, or anything clinical.
                  </p>
                  <Textarea
                    value={patientNoteDraft}
                    onChange={(e) => {
                      setPatientNoteDraft(e.target.value);
                      setPatientNoteDirty(e.target.value !== (activeTrackingLink.customNotes ?? ""));
                    }}
                    placeholder="e.g. Lens was delayed — we expect it to arrive on June 1."
                    maxLength={500}
                    className="min-h-[88px] bg-white text-[calc(13px*var(--ui-scale))]"
                    data-testid="tracking-note-textarea"
                  />
                  <div className="mt-1 flex items-center justify-between text-[calc(11px*var(--ui-scale))] text-ink-faint">
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warn" aria-hidden />
                      Saved notes are also added to <em>Comments</em> as an audit trail.
                    </span>
                    <span className="tabular-nums">{patientNoteDraft.length}/500</span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => updatePatientNoteMutation.mutate({
                        linkId: activeTrackingLink.id,
                        jobId: job.id,
                        note: patientNoteDraft,
                      })}
                      disabled={!patientNoteDirty || updatePatientNoteMutation.isPending}
                      data-testid="button-save-patient-note"
                    >
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {updatePatientNoteMutation.isPending ? "Saving…" : "Save"}
                    </Button>
                    {patientNoteDirty && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-ink-mute hover:text-ink ml-auto"
                        onClick={() => {
                          setPatientNoteDraft(activeTrackingLink.customNotes ?? "");
                          setPatientNoteDirty(false);
                        }}
                      >
                        Discard
                      </Button>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              // No active link — empty state. Primary "Generate" CTA
              // fires POST /api/tracking-links directly with the
              // office's defaults; "Customize and generate" opens the
              // dialog for per-job tweaks before generating.
              (() => {
                const officeAutoGenerate = !!((office?.settings as any)?.trackingLinkDefaults?.autoGenerateTrackingLinks);
                return (
                  <div
                    className="rounded-lg border border-line bg-panel px-5 py-6 max-w-lg mx-auto text-center"
                    data-testid="tracking-tab-empty"
                  >
                    <div className="h-12 w-12 rounded-full bg-otto-accent-soft text-otto-accent mx-auto grid place-items-center mb-3">
                      <Share2 className="h-5 w-5" />
                    </div>
                    <h4 className="font-display text-[calc(16px*var(--ui-scale))] font-medium text-ink m-0">
                      No tracking link for this job
                    </h4>
                    <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute mt-1.5 max-w-sm mx-auto">
                      {officeAutoGenerate
                        ? "This job was created without a tracking link, or the link was revoked. Generate one now to start sharing status with the patient."
                        : "Auto-generate is off for your office, so jobs don't get tracking links by default. Turn it on in Settings → Tracking Links, or generate one just for this job."}
                    </p>
                    <Button
                      size="sm"
                      className="mt-4"
                      onClick={() => directGenerateMutation.mutate()}
                      disabled={directGenerateMutation.isPending || !job?.id}
                      data-testid="button-generate-tracking-link"
                    >
                      <Share2 className="h-3.5 w-3.5 mr-1.5" />
                      {directGenerateMutation.isPending ? "Generating…" : "Generate tracking link"}
                    </Button>
                    <div className="mt-3">
                      <button
                        type="button"
                        className="text-[calc(12px*var(--ui-scale))] text-ink-mute hover:text-otto-accent underline-offset-2 hover:underline"
                        onClick={() => setTrackingDialogOpen(true)}
                        data-testid="button-customize-and-generate"
                      >
                        Customize and generate
                      </button>
                    </div>
                  </div>
                );
              })()
            )}
          </TabsContent>

          {/* Revoke confirmation — reachable from the overflow menu's
              destructive item. Kept outside the active-link block so
              focus management works cleanly when the link disappears
              after a successful revoke. */}
          <AlertDialog open={confirmRevokeOpen} onOpenChange={setConfirmRevokeOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke tracking link?</AlertDialogTitle>
                <AlertDialogDescription>
                  The patient will no longer be able to open this link. This can't be undone — you'll need to generate a new link if you want to share status again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-revoke">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => activeTrackingLink && revokeTrackingMutation.mutate(activeTrackingLink.id)}
                  disabled={revokeTrackingMutation.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-revoke"
                >
                  {revokeTrackingMutation.isPending ? "Revoking…" : "Revoke link"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Related Jobs tab — auto-detected by patient name match + manually linked */}
          {relatedJobs.length > 0 && (
            <TabsContent
              value="related"
              className="mt-0 flex-1 min-h-0 overflow-y-scroll px-6 py-5"
            >
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Related jobs for this patient (auto-detected by name match and manually linked).
                </p>
                <div className="border rounded-lg overflow-hidden bg-white dark:bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{useTrayNumber ? "Tray #" : "Patient"}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Type</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Lab</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Created</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Current job row */}
                      <tr className="border-b bg-primary/5">
                        <td className="px-3 py-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            {flaggedJobIds.includes(job.id) && (
                              <Star className="h-3 w-3 fill-yellow-500 text-yellow-500 shrink-0" />
                            )}
                            <span className="font-medium">{patientDisplayName}</span>
                            <span className="text-muted-foreground">(This job)</span>
                            {overdueJobIds.has(job.id) && (
                              <Badge className="text-[calc(10px*var(--ui-scale))] px-1.5 py-0 h-4 border-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">OVERDUE</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(() => { const c = getJobTypeBadgeColor(job.jobType); return <Badge className="text-xs border-0" style={{ backgroundColor: c.background, color: c.text }}>{getJobTypeLabel(job.jobType)}</Badge>; })()}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(() => { const c = getStatusBadgeColor(job.status); return <Badge className="text-xs border-0" style={{ backgroundColor: c.background, color: c.text }}>{getStatusLabel(job.status)}</Badge>; })()}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(() => { const c = getDestinationBadgeColor(job.orderDestination); return <Badge className="text-xs border-0" style={{ backgroundColor: c.background, color: c.text }}>{getDestinationLabel(job.orderDestination)}</Badge>; })()}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {format(new Date(job.createdAt), "MMM d, yyyy")}
                        </td>
                        <td className="px-3 py-2 text-xs"></td>
                      </tr>
                      {/* Related job rows */}
                      {relatedJobs.map((rj: any) => {
                        const rjDisplayName = useTrayNumber
                          ? (rj.trayNumber || "Tray not set")
                          : (formatPatientDisplayName(rj.patientFirstName, rj.patientLastName) || "Unnamed");
                        const rjTypeBadge = getJobTypeBadgeColor(rj.jobType);
                        const rjStatusBadge = getStatusBadgeColor(rj.status);
                        const rjDestBadge = getDestinationBadgeColor(rj.orderDestination);
                        const isClickable = !rj.archived && onSwitchJob;
                        return (
                          <tr
                            key={rj.id}
                            className={`border-b last:border-b-0 transition-colors ${isClickable ? "hover:bg-muted/30 cursor-pointer" : "hover:bg-muted/20"}`}
                            onClick={isClickable ? () => onSwitchJob!(rj.id) : undefined}
                          >
                            <td className="px-3 py-2 text-xs">
                              <div className="flex items-center gap-1.5">
                                {flaggedJobIds.includes(rj.id) && (
                                  <Star className="h-3 w-3 fill-yellow-500 text-yellow-500 shrink-0" />
                                )}
                                <span className="font-medium">{rjDisplayName}</span>
                                {rj.archived && (
                                  <Badge variant="secondary" className="text-[calc(10px*var(--ui-scale))] px-1 py-0">archived</Badge>
                                )}
                                {overdueJobIds.has(rj.id) && (
                                  <Badge className="text-[calc(10px*var(--ui-scale))] px-1.5 py-0 h-4 border-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">OVERDUE</Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <Badge className="text-xs border-0" style={{ backgroundColor: rjTypeBadge.background, color: rjTypeBadge.text }}>{getJobTypeLabel(rj.jobType)}</Badge>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <Badge className="text-xs border-0" style={{ backgroundColor: rjStatusBadge.background, color: rjStatusBadge.text }}>{getStatusLabel(rj.status)}</Badge>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <Badge className="text-xs border-0" style={{ backgroundColor: rjDestBadge.background, color: rjDestBadge.text }}>{getDestinationLabel(rj.orderDestination)}</Badge>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {format(new Date(rj.createdAt), "MMM d, yyyy")}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {rj.manualLink && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); unlinkMutation.mutate(rj.id); }}
                                  disabled={unlinkMutation.isPending}
                                >
                                  <Unlink className="h-3 w-3 mr-1" />
                                  Unlink
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Group Notes — shared across all linked jobs */}
                {linkGroupId && (
                  <div className="mt-6 rounded-lg border border-border bg-white dark:bg-card overflow-hidden">
                    {/* Section header */}
                    <div className="px-4 py-3 border-b border-border bg-muted/30 dark:bg-muted/10">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold text-foreground">Group Notes</h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Shared across all linked jobs in this group.
                      </p>
                    </div>

                    {/* Notes list */}
                    <div className="divide-y divide-border/50">
                      {groupNotes.length === 0 && (
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                          No notes yet. Add one below.
                        </div>
                      )}
                      {groupNotes.map((note: any) => (
                        <div key={note.id} className="px-4 py-3 group hover:bg-muted/20 transition-colors">
                          <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                          <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              {note.createdByName} &middot; {format(new Date(note.createdAt), "MMM d, yyyy h:mm a")}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => deleteGroupNoteMutation.mutate(note.id)}
                              disabled={deleteGroupNoteMutation.isPending}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Composer */}
                    <div className="px-4 py-3 border-t border-border bg-muted/10">
                      <div className="flex gap-2">
                        <Textarea
                          placeholder="Add a note..."
                          value={newGroupNote}
                          onChange={(e) => setNewGroupNote(e.target.value)}
                          className="min-h-[48px] text-sm resize-none bg-white dark:bg-background"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && newGroupNote.trim()) {
                              e.preventDefault();
                              addGroupNoteMutation.mutate(newGroupNote);
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          className="shrink-0 h-auto"
                          disabled={!newGroupNote.trim() || addGroupNoteMutation.isPending}
                          onClick={() => addGroupNoteMutation.mutate(newGroupNote)}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          )}

        </Tabs>

        {/* Footer — three-zone layout: left meta · centered status nav · right destructive/dismiss.
            Status mutation buttons sit dead-center so the user's eyes land on
            the primary lifecycle action rather than scanning a long row of
            mixed-purpose CTAs. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-6 py-3.5 border-t border-line bg-panel-2">
          <span className="flex items-center gap-1.5 text-[calc(11.5px*var(--ui-scale))] font-mono text-ink-mute justify-self-start">
            {lastUpdatedRelative ? (
              <>
                <Clock3 className="h-3 w-3" aria-hidden />
                Updated {lastUpdatedRelative}
              </>
            ) : null}
          </span>
          <div className="flex items-center gap-2 justify-self-center">
            {previousStatus && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateStatusMutation.mutate(previousStatus.id)}
                data-testid="button-revert-status"
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                Revert to {previousStatus.label}
              </Button>
            )}
            {nextStatus && (
              <Button
                size="sm"
                onClick={() => updateStatusMutation.mutate(nextStatus.id)}
                data-testid="button-advance-status"
              >
                Advance to {nextStatus.label}
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 justify-self-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEditJob(job)}
              data-testid="button-edit-job-from-details"
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* Star this job — note required so the team knows why */}
      <Dialog
        open={starDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setStarDialogOpen(false);
            setStarNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle asChild>
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-warn fill-warn" aria-hidden />
                <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
                  Star this job
                </h3>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2.5">
            <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute">
              Why are you starring this? Your team sees this note on the
              Starred page so they know what to keep an eye on.
            </p>
            <Textarea
              value={starNote}
              onChange={(e) => setStarNote(e.target.value)}
              placeholder="e.g., Patient called twice asking about status, needs follow-up by Friday…"
              rows={4}
              autoFocus
              className="resize-none bg-warn-bg/30 border-warn/20 focus-visible:ring-warn/40"
              data-testid="textarea-star-note"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStarDialogOpen(false);
                setStarNote("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (job?.id && starNote.trim()) {
                  starJobMutation.mutate({ jobId: job.id, note: starNote.trim() });
                }
              }}
              disabled={!starNote.trim() || starJobMutation.isPending}
              data-testid="button-confirm-star"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {starJobMutation.isPending ? "Saving…" : "Star job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Patient tracking link dialog — opened only from the empty-
          state "Customize and generate" link in the Tracking tab.
          Always create-mode now (active-link edits live inline in the
          tab, not in this dialog). */}
      <TrackingLinkDialog
        open={trackingDialogOpen}
        onOpenChange={setTrackingDialogOpen}
        jobs={job ? [job, ...relatedJobs.filter((rj: any) => !rj.archived)] : []}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/tracking-links/list"] });
        }}
      />
    </Dialog>
  );
}
