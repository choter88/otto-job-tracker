// Office Settings → Tracking Links tab. Sets the office-wide defaults for
// patient tracking links: which statuses are visible by default, and an
// optional default note.
//
// Patient-facing labels are NOT customizable — Otto uses one consistent
// vocabulary across all opticals so patients see familiar wording no
// matter which office they use.

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, ShieldCheck, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MESSAGE_TEMPLATE,
  DEFAULT_VISIBLE_STATUSES,
  type TrackingLinkDefaults,
} from "@shared/tracking-link-defaults";
import {
  PATIENT_STATUS_VALUES,
  PATIENT_STATUS_SYNONYMS,
  type PatientStatus,
} from "@shared/patient-status-enum";
import { AutoGenerateTrackingToggle } from "./auto-generate-tracking-toggle";

// Re-export the shared constants/types so existing imports from this
// module keep working — the canonical source moved to
// `shared/tracking-link-defaults.ts` so the desktop server can seed new
// offices from the same defaults the UI uses.
export { DEFAULT_MESSAGE_TEMPLATE, DEFAULT_VISIBLE_STATUSES };
export type { TrackingLinkDefaults };

interface Props {
  customStatuses: { id: string; label: string; color: string; order: number }[];
  customJobTypes: { id: string; label: string; color: string; order: number }[];
  value: TrackingLinkDefaults;
  onChange: (next: TrackingLinkDefaults) => void;
}

export default function TrackingLinkDefaultsEditor({ customStatuses, customJobTypes, value, onChange }: Props) {
  const visible = useMemo(
    () => (Array.isArray(value.visibleStatuses) && value.visibleStatuses.length > 0
      ? value.visibleStatuses
      : DEFAULT_VISIBLE_STATUSES),
    [value.visibleStatuses],
  );
  const visibleSet = new Set(visible);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-[calc(16px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0 flex items-center gap-2">
          <Share2 className="h-4 w-4 text-otto-accent" />
          Patient tracking links
        </h3>
        <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute mt-0.5 m-0 leading-snug">
          Auto-generate is on by default for new offices — staff can opt out per-job from the New Job dialog. The switch below lets you turn it off office-wide.
        </p>
      </div>

      {/* Auto-generate toggle — kept here as the office-wide kill
          switch (offices that want to disable auto-gen entirely flip
          it here). Same component as wizard + spotlight surfaces. */}
      <AutoGenerateTrackingToggle
        checked={!!value.autoGenerateTrackingLinks}
        onChange={(v) => onChange({ ...value, autoGenerateTrackingLinks: v })}
      />

      <p
        className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute leading-snug flex items-start gap-1.5 m-0"
        data-testid="tracking-defaults-disclosure"
      >
        <ShieldCheck className="h-3.5 w-3.5 text-brand-emerald shrink-0 mt-0.5" />
        Patient pages never show the patient's name, phone, or your office identity — just the statuses below, an optional ETA, and any per-link notes.
      </p>

      <section>
        <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
          Default visible statuses
        </Label>
        <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute mt-0.5 mb-1.5 m-0 leading-snug">
          Toggle off to hide from patients by default. <em>Delayed</em> auto-renders as a banner on the page — no need to enable here.
        </p>
        <div className="rounded-lg border border-line bg-panel divide-y divide-line-2" data-testid="tracking-defaults-statuses">
          {customStatuses.map((s) => {
            const checked = visibleSet.has(s.id);
            return (
              <label
                key={s.id}
                htmlFor={`def-vis-${s.id}`}
                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-paper-2/50 cursor-pointer"
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
                <span className="text-[calc(13px*var(--ui-scale))] font-medium text-ink">
                  {s.label}
                </span>
              </label>
            );
          })}
        </div>

        <PatientLabelSynonymPicker />
      </section>

      <PerJobTypeOverridesSection
        customStatuses={customStatuses}
        customJobTypes={customJobTypes}
        globalDefault={visible}
        byJobType={value.byJobType ?? {}}
        onChange={(next) => onChange({ ...value, byJobType: next })}
      />

      <section>
        <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
          Default note <span className="text-ink-faint normal-case tracking-normal font-normal">— optional</span>
        </Label>
        <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute mt-0.5 mb-1 m-0 leading-snug">
          Pre-fills the first note when staff opens a new link. Avoid names, phone numbers, or clinical details.
        </p>
        <Textarea
          value={value.defaultNotes ?? ""}
          onChange={(e) => onChange({ ...value, defaultNotes: e.target.value })}
          placeholder="e.g. We'll text you as soon as your order is ready for pickup."
          className="min-h-[52px] bg-white text-[calc(13px*var(--ui-scale))]"
          maxLength={500}
        />
        <div className="mt-0.5 text-right text-[calc(11px*var(--ui-scale))] text-ink-faint tabular-nums">
          {(value.defaultNotes?.length ?? 0)}/500
        </div>
      </section>

      <section>
        <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
          Message template
        </Label>
        <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute mt-0.5 mb-1 m-0 leading-snug">
          Copied to your clipboard when staff clicks <em>Copy message</em>. Supports <code className="px-1 py-0.5 rounded bg-paper-2 text-ink-2 text-[calc(11px*var(--ui-scale))]">{"{url}"}</code> (required) and <code className="px-1 py-0.5 rounded bg-paper-2 text-ink-2 text-[calc(11px*var(--ui-scale))]">{"{eta}"}</code>.
        </p>
        <Textarea
          value={value.messageTemplate ?? ""}
          onChange={(e) => onChange({ ...value, messageTemplate: e.target.value })}
          placeholder={DEFAULT_MESSAGE_TEMPLATE}
          className="min-h-[52px] bg-white text-[calc(12.5px*var(--ui-scale))] font-mono"
          maxLength={500}
        />
      </section>
    </div>
  );
}

// Per-job-type override section. Per-type overrides are opt-in: each row
// has a switch. When off, that type uses the global default. When on, the
// office picks per-type visible statuses. Patient-facing labels still
// resolve through Otto's static map first; this only changes which
// statuses are listed.
function PerJobTypeOverridesSection({
  customStatuses,
  customJobTypes,
  globalDefault,
  byJobType,
  onChange,
}: {
  customStatuses: { id: string; label: string; color: string; order: number }[];
  customJobTypes: { id: string; label: string; color: string; order: number }[];
  globalDefault: string[];
  byJobType: Record<string, { visibleStatuses?: string[] }>;
  onChange: (next: Record<string, { visibleStatuses?: string[] }>) => void;
}) {
  const sortedTypes = useMemo(
    () => customJobTypes.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [customJobTypes],
  );
  const orderedStatuses = customStatuses.filter((s) => s.id !== "delayed");

  if (sortedTypes.length === 0) return null;

  // Hide the whole section behind a disclosure when no overrides
  // are active — most offices use the global defaults across all job
  // types. Expand defaults to open when at least one override exists.
  const hasAnyOverride = Object.values(byJobType).some(
    (e) => Array.isArray(e?.visibleStatuses),
  );

  return (
    <Collapsible defaultOpen={hasAnyOverride}>
      <CollapsibleTrigger
        className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[calc(12px*var(--ui-scale))] text-ink-mute hover:bg-paper-2 group"
        data-testid="tracking-by-job-type-trigger"
      >
        <ChevronRight
          className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90"
          aria-hidden
        />
        <span>Different defaults by job type</span>
        <span className="text-ink-faint">— optional</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1.5">
      <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute mb-1.5 m-0 leading-snug px-3">
        Override the global default per job type. Useful when, e.g., contacts skip a "Quality Check" stage that glasses go through.
      </p>
      <div className="rounded-lg border border-line bg-panel divide-y divide-line-2" data-testid="tracking-defaults-by-job-type">
        {sortedTypes.map((t) => {
          const entry = byJobType[t.id];
          const overrideOn = Array.isArray(entry?.visibleStatuses);
          const effective = overrideOn ? (entry!.visibleStatuses as string[]) : globalDefault;
          const effectiveSet = new Set(effective);
          return (
            <div key={t.id} className="px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} aria-hidden />
                <span className="text-[calc(13px*var(--ui-scale))] font-medium text-ink min-w-[120px]">{t.label}</span>
                <span className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute flex-1 truncate">
                  {overrideOn
                    ? `Custom — ${effective.length} status${effective.length === 1 ? "" : "es"}`
                    : "Using global default"}
                </span>
                <Switch
                  checked={overrideOn}
                  onCheckedChange={(v) => {
                    const next = { ...byJobType };
                    if (v) {
                      next[t.id] = { visibleStatuses: globalDefault };
                    } else {
                      delete next[t.id];
                    }
                    onChange(next);
                  }}
                  aria-label={`Override defaults for ${t.label}`}
                />
              </div>
              {overrideOn && (
                <div className={cn("mt-2 ml-5 grid grid-cols-2 gap-x-3 gap-y-1.5")}>
                  {orderedStatuses.map((s) => {
                    const checked = effectiveSet.has(s.id);
                    const id = `vis-${t.id}-${s.id}`;
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
                            const current = effective;
                            const nextList = v
                              ? Array.from(new Set([...current, s.id]))
                              : current.filter((x) => x !== s.id);
                            onChange({ ...byJobType, [t.id]: { visibleStatuses: nextList } });
                          }}
                        />
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} aria-hidden />
                        <span>{s.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </CollapsibleContent>
    </Collapsible>
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

/**
 * Patient-facing label picker. Each canonical status has a finite list
 * of synonyms (defined portal-side); the office picks ONE per status.
 * No free text reaches the portal — only an integer index. Storage is
 * portal-side (per-office row), not in the local office.settings, so
 * this component owns its own data fetch/save loop independent of the
 * surrounding TrackingLinkDefaults form.
 */
function PatientLabelSynonymPicker() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ choices: Record<string, number> }>({
    queryKey: ["/api/tracking-label-choices"],
    queryFn: async () => {
      const res = await fetch("/api/tracking-label-choices", { credentials: "include" });
      if (!res.ok) return { choices: {} };
      return res.json();
    },
  });
  const serverChoices = data?.choices ?? {};

  const [draft, setDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    setDraft(serverChoices);
    // Effect intentionally re-runs only when server state shifts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (choices: Record<string, number>) => {
      const res = await apiRequest("PATCH", "/api/tracking-label-choices", { choices });
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tracking-label-choices"] });
      toast({ title: "Patient-facing labels saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't save labels", description: error.message, variant: "destructive" });
    },
  });

  const dirty = useMemo(() => {
    const keys = Array.from(new Set([...Object.keys(draft), ...Object.keys(serverChoices)]));
    for (const k of keys) {
      if ((draft[k] ?? 0) !== (serverChoices[k] ?? 0)) return true;
    }
    return false;
  }, [draft, serverChoices]);

  const hasAnyOverride = useMemo(
    () => Object.values(serverChoices).some((v) => typeof v === "number" && v !== 0),
    [serverChoices],
  );

  return (
    <Collapsible defaultOpen={hasAnyOverride}>
      <CollapsibleTrigger
        className="w-full mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[calc(12px*var(--ui-scale))] text-ink-mute hover:bg-paper-2 group"
        data-testid="tracking-customize-patient-labels-trigger"
      >
        <ChevronRight
          className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90"
          aria-hidden
        />
        <span>Customize patient-facing labels</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1.5 space-y-2">
        <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute leading-snug m-0 px-0.5">
          Pick the wording patients see for each step. Choices are from a finite vocabulary — no free text — so the page stays consistent and outside HIPAA scope.
        </p>
        <div className="rounded-lg border border-line bg-panel divide-y divide-line-2" data-testid="tracking-label-synonym-picker">
          {PATIENT_STATUS_VALUES.map((status) => {
            const synonyms = PATIENT_STATUS_SYNONYMS[status];
            const chosen = draft[status] ?? 0;
            return (
              <div key={status} className="flex items-center gap-2.5 px-3 py-2">
                <span className="text-[calc(12.5px*var(--ui-scale))] text-ink-2 min-w-[130px] capitalize">
                  {status.replace(/_/g, " ")}
                </span>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {synonyms.map((label, idx) => {
                    const selected = chosen === idx;
                    return (
                      <button
                        key={`${status}-${idx}`}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, [status]: idx }))}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-[calc(12px*var(--ui-scale))] border transition-colors",
                          selected
                            ? "bg-otto-accent text-white border-otto-accent"
                            : "bg-white text-ink border-line hover:bg-paper-2",
                        )}
                        data-testid={`label-syn-${status}-${idx}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          {dirty && (
            <button
              type="button"
              className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute hover:text-ink"
              onClick={() => setDraft(serverChoices)}
            >
              Discard
            </button>
          )}
          <button
            type="button"
            className={cn(
              "px-2.5 py-1 rounded-md text-[calc(12px*var(--ui-scale))] font-medium",
              dirty && !saveMutation.isPending
                ? "bg-otto-accent text-white hover:opacity-95"
                : "bg-paper-2 text-ink-faint cursor-not-allowed",
            )}
            disabled={!dirty || saveMutation.isPending || isLoading}
            onClick={() => saveMutation.mutate(draft)}
            data-testid="tracking-label-synonym-save"
          >
            {saveMutation.isPending ? "Saving…" : "Save labels"}
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
