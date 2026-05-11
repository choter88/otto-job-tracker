// Setup wizard step that lets the office configure their patient
// tracking link defaults during the first-run flow.
//
// Progressive disclosure: the toggle is the only thing above the fold.
// "Customize defaults" expands into the same editor that lives in
// Settings → Tracking Links — so power users can tune visible
// statuses, message template, per-job-type overrides etc. without
// leaving the wizard, but staff who just want sensible defaults can
// click Next without confronting every knob.
//
// Optional step — staff can click "Skip" if they want to leave
// defaults alone. New offices ship with `autoGenerateTrackingLinks:
// true` (see `shared/office-defaults.ts`) so skipping leaves the
// "auto-generate ON" state intact.

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import TrackingLinkDefaultsEditor, {
  type TrackingLinkDefaults,
} from "@/components/customization/tracking-link-defaults-editor";
import { AutoGenerateTrackingToggle } from "@/components/customization/auto-generate-tracking-toggle";
import type { CustomListItem } from "@/components/customization/sortable-list-editor";
import { cn } from "@/lib/utils";

interface StepTrackingLinksProps {
  // Pulled from current wizard draft state so the office sees the
  // statuses and job types they just defined in earlier steps.
  customStatuses: CustomListItem[];
  customJobTypes: CustomListItem[];
  value: TrackingLinkDefaults;
  onChange: (next: TrackingLinkDefaults) => void;
}

export default function StepTrackingLinks({
  customStatuses,
  customJobTypes,
  value,
  onChange,
}: StepTrackingLinksProps) {
  const [customizeOpen, setCustomizeOpen] = useState(false);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold">Patient tracking links</h2>
        <p className="text-muted-foreground mt-1">
          Otto gives your patients a public link to follow their order's
          status — no login, no PHI, no office identity. Auto-generate
          is on by default; every new job silently gets a shareable
          link you can hand to the patient.
        </p>
      </div>

      {/* Above-the-fold: just the toggle. Same shared component as
          Settings → Tracking Links and the spotlight inline widget. */}
      <AutoGenerateTrackingToggle
        testId="wizard-tracking-auto-generate-toggle"
        checked={!!value.autoGenerateTrackingLinks}
        onChange={(v) => onChange({ ...value, autoGenerateTrackingLinks: v })}
        descriptionOn="Recommended. Staff can still opt out per-job from the New Job dialog."
      />

      {/* Below-the-fold: power-user knobs. Collapsed by default so the
          wizard's tracking-links step reads as "one switch" rather
          than a config screen. The full editor (statuses, ETA,
          template, per-job-type overrides) lives inside. */}
      <Collapsible open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <CollapsibleTrigger
          className="w-full flex items-center justify-between px-3 py-2 rounded-md text-[calc(13px*var(--ui-scale))] text-ink-2 hover:bg-paper-2 group"
          data-testid="wizard-tracking-customize-trigger"
        >
          <span className="font-medium">Customize defaults</span>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-ink-mute transition-transform group-hover:text-ink",
              customizeOpen && "rotate-90",
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <TrackingLinkDefaultsEditor
            customStatuses={customStatuses as any}
            customJobTypes={customJobTypes as any}
            value={value}
            onChange={onChange}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
