// Inline widget rendered inside the patient-tracking spotlight modal
// (commit 3, task J). Lets the user turn auto-generate on without
// leaving the announcement — same field the Settings panel and the
// setup wizard write. When the toggle flips ON, the orchestrator
// changes the primary CTA from "Open Tracking Links settings" to
// "Done" so the announcement collapses into a one-click accept.
//
// Generic-enough-to-not-bleed: the widget is its own component and
// gets plugged into WhatsNewModal via the `inlineWidget` prop. Future
// spotlights add their own widgets the same way.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { openOfficeSettings } from "./feature-spotlight-host";
import { AutoGenerateTrackingToggle } from "@/components/customization/auto-generate-tracking-toggle";
import type { Office } from "@shared/schema";

interface Props {
  /** Notify parent when the toggle flips to ON for the first time
   *  (lets the orchestrator swap the modal's primary CTA to "Done"). */
  onTurnedOn?: () => void;
}

export function PatientTrackingInlineWidget({ onTurnedOn }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const serverValue = useMemo(() => {
    const settings = (office?.settings || {}) as any;
    return !!settings?.trackingLinkDefaults?.autoGenerateTrackingLinks;
  }, [office?.settings]);

  // Local optimistic state so the toggle feels snappy regardless of
  // the office query refetch latency.
  const [checked, setChecked] = useState(serverValue);
  useEffect(() => setChecked(serverValue), [serverValue]);

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (!user?.officeId) throw new Error("No office");
      const existing = (office?.settings || {}) as any;
      const existingTld = (existing?.trackingLinkDefaults && typeof existing.trackingLinkDefaults === "object")
        ? existing.trackingLinkDefaults
        : {};
      const res = await apiRequest("PUT", `/api/offices/${user.officeId}`, {
        settings: {
          trackingLinkDefaults: {
            ...existingTld,
            autoGenerateTrackingLinks: next,
          },
        },
      });
      return res.json();
    },
    onSuccess: (_data, next) => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId] });
      if (next) {
        toast({ title: "Auto-generate turned on", description: "New jobs will get a tracking link automatically." });
        onTurnedOn?.();
      } else {
        toast({ title: "Auto-generate turned off" });
      }
    },
    onError: (error: Error, _next) => {
      setChecked(serverValue);
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    },
  });

  return (
    <AutoGenerateTrackingToggle
      accent
      testId="spotlight-patient-tracking-inline-widget"
      checked={checked}
      disabled={mutation.isPending || !office}
      onChange={(v) => {
        setChecked(v);
        mutation.mutate(v);
      }}
      label="Turn on auto-generate now"
      descriptionOn="Every new job will get a tracking link by default. You can still opt out per-job from the New Job dialog."
      descriptionOff="Flip the switch to start generating tracking links for every new job."
      footer={
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => openOfficeSettings("tracking")}
          className="mt-1 h-auto p-0 text-[calc(11.5px*var(--ui-scale))] text-otto-accent"
          data-testid="spotlight-configure-other-defaults"
        >
          Configure other defaults →
        </Button>
      }
    />
  );
}
