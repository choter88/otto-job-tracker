// Shared auto-generate-tracking-links toggle UI. Three surfaces wire to
// the same `office.settings.trackingLinkDefaults.autoGenerateTrackingLinks`
// field and previously duplicated this JSX:
//   - Office Settings → Tracking Links tab (TrackingLinkDefaultsEditor)
//   - Setup wizard step (step-tracking-links)
//   - Spotlight inline widget (patient-tracking-inline-widget)
//
// Visual variant `accent` shifts the surface to the otto-accent-soft
// background (used by the spotlight where the toggle is the modal's
// primary action). Default variant uses bg-panel so it sits cleanly
// inside Settings + Wizard cards.
//
// Each surface keeps its own state-management contract — Settings and
// Wizard lift state through `value/onChange` on the parent
// TrackingLinkDefaults object; the spotlight widget mutates the office
// row directly. This component is the visual primitive only.

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  /** Current toggle state. */
  checked: boolean;
  /** Fires when the user flips the switch. Errors handled by callers. */
  onChange: (next: boolean) => void;
  /** Disable the switch (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** Heading text — defaults to the standard Settings/Wizard label. */
  label?: string;
  /** Description shown when `checked === true`. */
  descriptionOn?: string;
  /** Description shown when `checked === false`. */
  descriptionOff?: string;
  /** Use the otto-accent-soft surface (for in-modal placement). */
  accent?: boolean;
  /** Stable id for the switch+label association + data-testid. */
  testId?: string;
  /** Optional slot rendered after the description (links, etc). */
  footer?: ReactNode;
}

const DEFAULT_LABEL = "Auto-generate tracking links for new jobs";
const DEFAULT_DESCRIPTION_ON =
  "Every new job gets a tracking link by default. Find it in Job Details → Patient tracking when you're ready to share.";
const DEFAULT_DESCRIPTION_OFF =
  "New jobs won't have tracking links unless you generate one from Job Details → Patient tracking.";

export function AutoGenerateTrackingToggle({
  checked,
  onChange,
  disabled,
  label = DEFAULT_LABEL,
  descriptionOn = DEFAULT_DESCRIPTION_ON,
  descriptionOff = DEFAULT_DESCRIPTION_OFF,
  accent = false,
  testId = "tracking-auto-generate-toggle",
  footer,
}: Props) {
  const switchId = `${testId}-switch`;
  return (
    <section
      className={cn(
        "rounded-lg border px-4 py-3 flex items-start gap-3",
        accent
          ? "border-otto-accent-line bg-otto-accent-soft/40"
          : "border-line bg-panel",
      )}
      data-testid={testId}
    >
      <Switch
        id={switchId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <Label
          htmlFor={switchId}
          className="text-[calc(13px*var(--ui-scale))] font-medium text-ink cursor-pointer flex items-center gap-1.5"
        >
          <Share2 className="h-3.5 w-3.5 text-otto-accent" />
          {label}
        </Label>
        <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute mt-0.5 leading-snug m-0">
          {checked ? descriptionOn : descriptionOff}
        </p>
        {footer}
      </div>
    </section>
  );
}
