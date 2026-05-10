// Setup wizard step that lets the office configure their patient
// tracking link defaults during the first-run flow. Reuses the same
// editor that lives in Settings → Tracking Links so the config UX is
// identical in both surfaces.
//
// Optional step — staff can click "Skip" if they want to leave
// defaults alone. Defaults are sensible (the standard visible
// statuses, no per-job-type overrides, no custom note, no message
// template, no patient-label overrides) so skipping yields a working
// tracking link experience on day one.

import TrackingLinkDefaultsEditor, {
  type TrackingLinkDefaults,
} from "@/components/customization/tracking-link-defaults-editor";
import type { CustomListItem } from "@/components/customization/sortable-list-editor";

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
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Patient tracking links</h2>
        <p className="text-muted-foreground mt-1">
          Otto can give your patients a public link to follow their order's
          status — no login, no PHI, no office identity. Configure what they
          see by default below. You can fine-tune per link later when you
          generate one from a job.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          This step is optional — defaults are already sensible. Skip if you
          want to come back later from <em>Office Settings → Tracking Links</em>.
        </p>
      </div>
      <TrackingLinkDefaultsEditor
        customStatuses={customStatuses as any}
        customJobTypes={customJobTypes as any}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
