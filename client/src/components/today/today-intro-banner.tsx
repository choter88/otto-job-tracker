import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// One-time notice the first time a user lands on the new Today tab, pointing
// out they can switch their default view back to Worklist. Shown-once is
// tracked per user in localStorage (set on first appearance), so it never
// returns after the first visit. ponytail: no server flag — a per-device
// dismissal is the right weight for a gentle one-time hint.
const seenKey = (userId: string) => `otto.today.intro.${userId}`;

export default function TodayIntroBanner({ userId }: { userId: string }) {
  const [show, setShow] = useState(() => {
    try {
      return !localStorage.getItem(seenKey(userId));
    } catch {
      return false;
    }
  });
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (show) {
      try {
        localStorage.setItem(seenKey(userId), "1");
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useWorklist = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/user/preferences", { defaultView: "worklist" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/preferences"] });
      setShow(false);
      toast({ title: "Worklist is now your default view." });
      setLocation("/dashboard/all");
    },
    onError: (e: any) =>
      toast({ title: "Couldn't update your default view", description: e?.message, variant: "destructive" }),
  });

  if (!show) return null;

  return (
    <div
      className="flex-none flex items-center gap-3 rounded-xl border border-otto-accent-line bg-otto-accent-soft px-4 py-2.5 text-sm"
      data-testid="today-intro-banner"
    >
      <span className="text-ink">
        <strong>Today</strong> is your new home view. Prefer the classic list? You can make Worklist your default again.
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="xs"
          onClick={() => useWorklist.mutate()}
          disabled={useWorklist.isPending}
          data-testid="today-intro-use-worklist"
        >
          Use Worklist as default
        </Button>
        <button
          onClick={() => setShow(false)}
          className="text-ink-mute hover:text-ink"
          aria-label="Dismiss"
          data-testid="today-intro-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
