// Active-tracking-link panel for the Job Details → Patient tracking
// tab. Pulled out of `job-details-modal.tsx` so the modal file stays
// readable; the panel owns all the share-surface local state (QR
// visibility, copy-feedback, inline-edit form) and bubbles mutations
// up via callbacks. Parent keeps the queries + the AlertDialog +
// the empty-state.
//
// Local-state ownership rationale: QR visibility, the copy-feedback
// indicators, and the inline-edit draft are pure UI state. Putting
// them next to the JSX they drive keeps the parent's signal-to-noise
// high. Use a `key` derived from `link.id` at the call site so a
// revoke + regenerate resets the panel cleanly instead of carrying
// over stale state.

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarPlus,
  Check,
  ChevronDown,
  Copy,
  Eye,
  QrCode,
  Save,
  Sliders,
  StickyNote,
  Trash2,
} from "lucide-react";
import QRCode from "qrcode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { renderMessageTemplate as renderTrackingMessageTemplate } from "@/components/customization/tracking-link-defaults-editor";
import {
  PATIENT_STATUS_VALUES,
  patientLabelForStatus,
  type PatientStatus,
} from "@shared/patient-status-enum";
import { cn } from "@/lib/utils";
import type { Job } from "@shared/schema";
import type { TrackingLinkRecord } from "@/components/tracking-link-dialog";

function toTitleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

interface Props {
  link: TrackingLinkRecord;
  job: Job;
  customStatuses: Array<{ id: string; label: string; color: string; order: number }>;
  /** Office's outbound message template (used by Copy message). */
  messageTemplate: string | undefined;
  trackingExpiringSoon: boolean;
  trackingDaysUntilExpiry: number | null;

  /** Append a new timestamped note. LOCAL-ONLY — notes are stored on
   *  this host and never sent to the portal. The patient page does not
   *  render notes. */
  onAddNote: (args: { linkToken: string; jobIds: string[]; content: string }) => void;
  isAddingNote: boolean;
  /** Locally-stored notes for this link. Fetched from the desktop's
   *  `/api/tracking-links/notes/:token` endpoint by the parent. */
  localNotes: { id: string; content: string; createdAt: string }[];

  onExtend: (linkId: string) => void;
  isExtending: boolean;

  /** Per-link patient-status visibility (canonical enum values). Null
   *  while loading or when the link has never been configured. */
  linkVisibility: PatientStatus[] | null;
  /** Office-wide synonym choices for previewing labels in the editor. */
  labelChoices: Record<string, number> | undefined;
  /** Persist a new per-link visibility set. */
  onSaveVisibility: (args: { linkId: string; visibleStatuses: PatientStatus[] }) => void;
  isSavingVisibility: boolean;

  onRequestRevoke: () => void;
}

export function ActiveTrackingLinkPanel({
  link,
  job,
  customStatuses,
  messageTemplate,
  trackingExpiringSoon,
  trackingDaysUntilExpiry,
  onAddNote,
  isAddingNote,
  localNotes,
  onExtend,
  isExtending,
  linkVisibility,
  labelChoices,
  onSaveVisibility,
  isSavingVisibility,
  onRequestRevoke,
}: Props) {
  const { toast } = useToast();

  const [qrVisible, setQrVisible] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);

  // Inline-edit state for per-link visibility. Seeded from the parent's
  // `linkVisibility` prop on open + on link change; closed on save /
  // cancel. Stored locally only — the portal never sees per-link
  // visibility config (it only sees the events the desktop chooses to
  // emit). `delayed` is intentionally not toggleable — it surfaces
  // as a regular timeline event when emitted, and is rarely configured
  // off.
  const [inlineEditOpen, setInlineEditOpen] = useState(false);
  const [editVisible, setEditVisible] = useState<PatientStatus[]>([]);
  useEffect(() => {
    if (!inlineEditOpen) return;
    setEditVisible(
      Array.isArray(linkVisibility) && linkVisibility.length > 0
        ? [...linkVisibility]
        : ["received", "sent_to_lab", "in_progress", "ready_for_pickup"],
    );
  }, [inlineEditOpen, link.id, linkVisibility]);

  // Note composer — fresh blank draft for each new entry. Notes are
  // local-only: they're written to the desktop's SQLite and read back
  // via the parent's `localNotes` prop. They are NOT shown on the
  // patient page — the staff sees them as an internal audit log of
  // what they've considered communicating, not as something the
  // patient is reading.
  const [noteDraft, setNoteDraft] = useState("");

  // Chronologically-sorted view for display.
  const displayedNotes = useMemo(() => {
    return localNotes.slice().sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [localNotes]);

  // Lazy QR SVG — only generated when the panel is shown to avoid
  // doing crypto-style canvas work on every modal open.
  useEffect(() => {
    if (!qrVisible || !link.url) {
      setQrSvg(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const svg = await QRCode.toString(link.url, {
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
  }, [qrVisible, link.url]);

  const handleCopyURL = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
      toast({ title: "URL copied" });
      // Split telemetry: `tracking_link_copy_url` and
      // `tracking_link_copy_message` are distinct events so each can
      // be measured independently. `metadata.source` further breaks
      // down where the copy fired from (toast | tracking_tab |
      // configure_dialog).
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          eventType: "tracking_link_copy_url",
          metadata: { source: "tracking_tab" },
        }),
      }).catch(() => {});
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  // Memoized so it can both display in the preview card AND feed the
  // copy handler — keeps the visible message identical to what's
  // pasted into the patient's SMS / email. ETA is no longer
  // round-tripped through the portal; staff who want to include an
  // ETA can edit the message after pasting.
  const renderedMessage = useMemo(() => {
    const etaFormatted: string | null = null;
    return renderTrackingMessageTemplate(messageTemplate, {
      url: link.url,
      eta: etaFormatted,
    });
  }, [link.url, messageTemplate]);

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(renderedMessage);
      setMessageCopied(true);
      setTimeout(() => setMessageCopied(false), 2000);
      // No toast — the button itself self-confirms via the Check icon
      // for 2s.
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          eventType: "tracking_link_copy_message",
          metadata: { source: "tracking_tab" },
        }),
      }).catch(() => {});
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const statusMeta = customStatuses.find((s) => s.id === job.status);
  const statusLabel = statusMeta?.label ?? toTitleCase(job.status || "");
  const statusColor = statusMeta?.color ?? "#94a3b8";

  return (
    <div className="space-y-5" data-testid="tracking-tab-active">
      {/* Share section — the 90% surface. Status + a labeled "More"
          dropdown trigger above, then a single share card with two
          stacked rows: URL (raw link + its own Copy) and Message
          (preview of the rendered template + Copy). Staff sees what
          they're about to paste before choosing — the message
          preview is the whole point of the template-based flow. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[calc(12px*var(--ui-scale))]"
                data-testid="tracking-link-actions-menu"
              >
                More
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
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
                {inlineEditOpen ? "Close editor" : "Edit visible statuses"}
              </DropdownMenuItem>
              {trackingExpiringSoon && (
                <DropdownMenuItem
                  onSelect={() => onExtend(link.id)}
                  disabled={isExtending}
                  data-testid="menu-extend"
                >
                  <CalendarPlus className="h-3.5 w-3.5 mr-2" />
                  Extend 30 days
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onRequestRevoke}
                className="text-destructive focus:text-destructive"
                data-testid="menu-revoke"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Revoke link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          className="rounded-lg border border-line bg-panel divide-y divide-line-2"
          data-testid="tracking-share-card"
        >
          {/* URL row — raw link with its own copy button. The 10%
              workflow where the office's message template doesn't
              fit (e.g. pasting into a third-party tool that expects
              just the URL). */}
          <div className="px-3.5 py-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[calc(10.5px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
                Link URL
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-[calc(11.5px*var(--ui-scale))]"
                onClick={handleCopyURL}
                data-testid="button-copy-tracking-url"
              >
                {urlCopied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <code
              className="block text-[calc(12px*var(--ui-scale))] font-mono text-ink-2 truncate"
              title={link.url}
              data-testid="tracking-link-summary"
            >
              {link.url}
            </code>
          </div>

          {/* Message row — preview of the office's outbound template
              with {url} + {eta} substituted. Staff sees the exact
              text that'll land on the clipboard, then decides. */}
          <div className="px-3.5 py-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[calc(10.5px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
                Message
              </span>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-[calc(11.5px*var(--ui-scale))]"
                onClick={handleCopyMessage}
                data-testid="button-copy-tracking-message"
              >
                {messageCopied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p
              className="text-[calc(12.5px*var(--ui-scale))] text-ink-2 leading-relaxed whitespace-pre-wrap break-words m-0"
              data-testid="tracking-message-preview"
            >
              {renderedMessage}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[calc(11px*var(--ui-scale))] text-ink-faint">
          {link.expiresAt && (
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
                  : `Expired ${format(new Date(link.expiresAt), "MMM d")}`}
            </span>
          )}
        </div>

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

      {/* Inline edit: per-link visibility. Stored locally — the portal
          never sees per-link visibility config. The desktop's event-
          emit code paths consult this when deciding whether to push a
          status change to the portal. Labels shown here preview the
          office's chosen synonym from settings. */}
      {inlineEditOpen && (
        <section
          className="rounded-lg border border-line bg-panel p-4 space-y-3"
          data-testid="tracking-tab-inline-edit"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-[calc(11px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute m-0 flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              Visible to patient
            </h4>
          </div>
          <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute leading-snug m-0">
            Choose which steps this patient sees on the public tracking page. Stays on this computer.
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {PATIENT_STATUS_VALUES.filter((s) => s !== "delayed" && s !== "cancelled").map((s) => {
              const checked = editVisible.includes(s);
              const id = `inline-vis-${s}`;
              const label = patientLabelForStatus(s, labelChoices);
              return (
                <label
                  key={s}
                  htmlFor={id}
                  className="flex items-center gap-2 cursor-pointer text-[calc(12.5px*var(--ui-scale))] text-ink"
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(v) => {
                      setEditVisible((prev) =>
                        v
                          ? Array.from(new Set([...prev, s])) as PatientStatus[]
                          : prev.filter((x) => x !== s),
                      );
                    }}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={() =>
                onSaveVisibility({
                  linkId: link.id,
                  visibleStatuses: editVisible,
                })
              }
              disabled={isSavingVisibility}
              data-testid="button-save-inline-edit"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {isSavingVisibility ? "Saving…" : "Save"}
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

      {/* Notes for patient — chronological timeline + composer for a
          new entry. Each saved note becomes its own timestamped row
          on the patient's tracking page (no overwrites) so the
          patient sees a series of updates instead of just the most
          recent one. */}
      <section data-testid="tracking-tab-note" className="space-y-2.5">
        <div className="flex items-center gap-1.5">
          <StickyNote className="h-3.5 w-3.5 text-ink-mute" />
          <h4 className="text-[calc(11px*var(--ui-scale))] font-semibold uppercase tracking-[0.10em] text-ink-mute m-0">
            Notes for patient
          </h4>
        </div>

        {displayedNotes.length > 0 && (
          <ol
            className="rounded-lg border border-line bg-panel divide-y divide-line-2"
            data-testid="tracking-notes-list"
          >
            {displayedNotes
              .slice()
              .reverse()
              .map((entry) => (
                <li
                  key={entry.id}
                  className="px-3.5 py-2.5"
                  data-testid={`tracking-note-${entry.id}`}
                >
                  <div className="text-[calc(11px*var(--ui-scale))] text-ink-faint font-medium tabular-nums">
                    {formatNoteTimestamp(new Date(entry.createdAt))}
                  </div>
                  <p className="mt-0.5 text-[calc(13px*var(--ui-scale))] text-ink-2 leading-relaxed whitespace-pre-wrap break-words m-0">
                    {entry.content}
                  </p>
                </li>
              ))}
          </ol>
        )}

        <div className="rounded-lg border border-line bg-panel p-3 space-y-2">
          <div className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute leading-snug">
            Add a local note about this patient's order — e.g. <em>"Lens was delayed. Called patient on 6/1."</em> Notes stay on this computer and are NOT shown to the patient.
          </div>
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="e.g. Called patient — expects pickup next Tuesday."
            maxLength={500}
            className="min-h-[64px] bg-white text-[calc(13px*var(--ui-scale))]"
            data-testid="tracking-note-textarea"
          />
          <div className="flex items-center justify-between text-[calc(11px*var(--ui-scale))] text-ink-faint">
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-warn" aria-hidden />
              Notes are stored locally on this host and also appear in <em>Comments</em>.
            </span>
            <span className="tabular-nums">{noteDraft.length}/500</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                onAddNote({
                  linkToken: link.token,
                  jobIds: link.jobIds,
                  content: noteDraft.trim(),
                });
                setNoteDraft("");
              }}
              disabled={noteDraft.trim().length === 0 || isAddingNote}
              data-testid="button-save-patient-note"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {isAddingNote ? "Saving…" : "Save note"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function formatNoteTimestamp(d: Date): string {
  // Human-friendly relative for today/yesterday, absolute beyond.
  // Matches the patient-page formatting so staff sees the same
  // labels their patient will see.
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today · ${time}`;
  if (isYesterday) return `Yesterday · ${time}`;
  return format(d, "MMM d · h:mm a");
}
