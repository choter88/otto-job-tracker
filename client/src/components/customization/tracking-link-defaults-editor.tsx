// Office Settings → Tracking Links tab. Sets the office-wide defaults for
// patient tracking links: which statuses are visible by default, and an
// optional default note.
//
// Patient-facing labels are NOT customizable — Otto uses one consistent
// vocabulary across all opticals so patients see familiar wording no
// matter which office they use.

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Share2 } from "lucide-react";
import { useMemo } from "react";

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

// `delayed` intentionally excluded — it surfaces as a banner on the patient
// page when active rather than as a sequential timeline step.
export const DEFAULT_VISIBLE_STATUSES = [
  "ordered",
  "in_progress",
  "ready_for_pickup",
];

export interface TrackingLinkDefaults {
  visibleStatuses?: string[];
  defaultNotes?: string;
  // Office-wide template the staff copies from the share view and pastes
  // into Weave / SMS / email. Supports `{url}` (required) and `{eta}`
  // placeholders. PHI never goes through this template — it's the office's
  // own outbound voice, not the patient page itself.
  messageTemplate?: string;
}

export const DEFAULT_MESSAGE_TEMPLATE = "Hi! Here's a link to follow your order: {url}";

interface Props {
  customStatuses: { id: string; label: string; color: string; order: number }[];
  value: TrackingLinkDefaults;
  onChange: (next: TrackingLinkDefaults) => void;
}

export default function TrackingLinkDefaultsEditor({ customStatuses, value, onChange }: Props) {
  const visible = useMemo(
    () => (Array.isArray(value.visibleStatuses) && value.visibleStatuses.length > 0
      ? value.visibleStatuses
      : DEFAULT_VISIBLE_STATUSES),
    [value.visibleStatuses],
  );
  const visibleSet = new Set(visible);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0 flex items-center gap-2">
          <Share2 className="h-[18px] w-[18px] text-otto-accent" />
          Patient tracking links
        </h3>
        <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-1">
          When you generate a tracking link from the worklist or job details, these defaults are pre-selected. You can still tweak them per-link.
        </p>
      </div>

      <section
        className="rounded-md border border-line bg-paper-2 px-3.5 py-2.5 flex items-start gap-2"
        data-testid="tracking-defaults-disclosure"
      >
        <ShieldCheck className="h-3.5 w-3.5 text-brand-emerald shrink-0 mt-0.5" />
        <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute leading-snug">
          Patient pages never show the patient's name, phone, or your office identity — just the statuses below, an optional ETA, and any per-link note.
        </p>
      </section>

      <section>
        <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
          Default visible statuses
        </Label>
        <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute mt-1 mb-2.5">
          Toggle a status off to hide it from patients by default. If a job is set to <em>Delayed</em>, it appears as a banner on the page automatically — no need to enable it here.
        </p>
        <div className="rounded-lg border border-line bg-panel divide-y divide-line-2" data-testid="tracking-defaults-statuses">
          {customStatuses.map((s) => {
            const checked = visibleSet.has(s.id);
            const patientLabel = PATIENT_FACING_STATUS_LABELS[s.id] ?? s.label;
            return (
              <label
                key={s.id}
                htmlFor={`def-vis-${s.id}`}
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-paper-2/50"
              >
                <Checkbox
                  id={`def-vis-${s.id}`}
                  checked={checked}
                  onCheckedChange={(v) => {
                    const next = v
                      ? Array.from(new Set([...visible, s.id]))
                      : visible.filter((x) => x !== s.id);
                    onChange({ ...value, visibleStatuses: next });
                  }}
                />
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[calc(13px*var(--ui-scale))] font-medium text-ink">{s.label}</div>
                  <div className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute">
                    Patient sees: <span className="text-ink-2">"{patientLabel}"</span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
          Default note (optional)
        </Label>
        <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute mt-1 mb-2">
          Pre-fill the per-link note field with text that's safe for any patient (avoid names, phone numbers, or clinical details).
        </p>
        <Textarea
          value={value.defaultNotes ?? ""}
          onChange={(e) => onChange({ ...value, defaultNotes: e.target.value })}
          placeholder="e.g. We'll text you as soon as your order is ready for pickup."
          className="min-h-[70px] bg-white text-[calc(13px*var(--ui-scale))]"
          maxLength={500}
        />
        <div className="mt-1 text-right text-[calc(11px*var(--ui-scale))] text-ink-faint">
          {(value.defaultNotes?.length ?? 0)}/500
        </div>
      </section>

      <section>
        <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
          Message template
        </Label>
        <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute mt-1 mb-2">
          When you click <em>Copy message</em> on a generated link, this text is copied to your clipboard with the link substituted in. Paste it into Weave, SMS, or email.
        </p>
        <Textarea
          value={value.messageTemplate ?? ""}
          onChange={(e) => onChange({ ...value, messageTemplate: e.target.value })}
          placeholder={DEFAULT_MESSAGE_TEMPLATE}
          className="min-h-[70px] bg-white text-[calc(13px*var(--ui-scale))] font-mono"
          maxLength={500}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[calc(11px*var(--ui-scale))] text-ink-mute">
          <span>Placeholders:</span>
          <code className="px-1.5 py-0.5 rounded bg-paper-2 text-ink-2">{"{url}"}</code>
          <span>(required)</span>
          <code className="px-1.5 py-0.5 rounded bg-paper-2 text-ink-2">{"{eta}"}</code>
          <span>(replaced with the ETA, or stripped if none)</span>
        </div>
      </section>
    </div>
  );
}

/**
 * Apply the office's message template, substituting {url} and {eta}.
 * If the template is empty or missing, falls back to the default.
 * Lines containing {eta} when no ETA is set are dropped entirely so the
 * message reads naturally instead of leaving "ETA: " or similar dangling.
 */
export function renderMessageTemplate(
  template: string | undefined | null,
  args: { url: string; eta: string | null },
): string {
  const tpl = (template ?? "").trim() || DEFAULT_MESSAGE_TEMPLATE;
  // If ETA is missing, drop any line that contains {eta} so we don't ship
  // "ETA: " with a hanging value.
  const lines = tpl.split(/\r?\n/);
  const filtered = args.eta
    ? lines
    : lines.filter((line) => !line.includes("{eta}"));
  return filtered
    .join("\n")
    .replace(/\{url\}/g, args.url)
    .replace(/\{eta\}/g, args.eta ?? "")
    .trim();
}
