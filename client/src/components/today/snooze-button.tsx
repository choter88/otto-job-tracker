import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { snoozeUntilMs, SNOOZE_PRESET_LABELS, type SnoozePreset } from "@shared/snooze-presets";

const PRESETS: SnoozePreset[] = ["tomorrow", "friday", "next_week"];

function atEightAmLocal(date: Date): number {
  const d = new Date(date);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

export default function SnoozeButton({ jobId, onSnoozed }: { jobId: string; onSnoozed?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const snooze = useMutation({
    mutationFn: async (until: number) => {
      await apiRequest("POST", `/api/jobs/${jobId}/snooze`, {
        until,
        reason: reason.trim() ? reason.trim() : undefined,
      });
    },
    onSuccess: () => {
      setReason("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/today/activity"] });
      toast({ title: "Job snoozed." });
      onSnoozed?.();
    },
    onError: (e: any) => {
      toast({ title: "Couldn't snooze this job", description: e?.message, variant: "destructive" });
    },
  });

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(""); }}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="outline" data-testid={`snooze-${jobId}`}>Snooze</Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex flex-col sm:flex-row">
          <div className="p-3 space-y-2 border-b sm:border-b-0 sm:border-r w-44">
            <div className="text-xs font-medium text-ink mb-1">Snooze until…</div>
            {PRESETS.map((preset) => (
              <Button
                key={preset}
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={snooze.isPending}
                onClick={() => snooze.mutate(snoozeUntilMs(preset))}
                data-testid={`snooze-preset-${preset}-${jobId}`}
              >
                {SNOOZE_PRESET_LABELS[preset]}
              </Button>
            ))}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Add a reason (optional)"
              className="w-full text-xs px-2 py-1.5 rounded border border-line-2 bg-paper"
              data-testid={`snooze-reason-${jobId}`}
            />
          </div>
          <div className="p-3">
            <Calendar
              mode="single"
              disabled={{ before: new Date() }}
              onSelect={(date?: Date) => {
                if (!date) return;
                snooze.mutate(atEightAmLocal(date));
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
