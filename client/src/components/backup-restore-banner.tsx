import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Archive, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useOnboarding } from "@/hooks/use-onboarding";

const DISMISS_KEY_PREFIX = "otto.backupRestoreBannerDismissed.";

function dismissKey(officeId: string | null | undefined): string | null {
  if (!officeId) return null;
  return `${DISMISS_KEY_PREFIX}${officeId}`;
}

/**
 * Shown once after a backup-restore install. The user dismisses it permanently
 * (per-office, in localStorage). They can also click "Review settings" to open
 * the wizard in review mode.
 */
export default function BackupRestoreBanner() {
  const { user } = useAuth();
  const { showBackupRestoreBanner } = useOnboarding();
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const key = dismissKey(user?.officeId);
    if (!key) return;
    setDismissed(localStorage.getItem(key) === "1");
  }, [user?.officeId]);

  if (!showBackupRestoreBanner || dismissed) return null;

  function handleDismiss() {
    const key = dismissKey(user?.officeId);
    if (key) localStorage.setItem(key, "1");
    setDismissed(true);
  }

  function handleReview() {
    navigate("/setup");
  }

  return (
    <div
      className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 mb-4 flex items-start gap-3"
      data-testid="backup-restore-banner"
    >
      <div className="rounded-md bg-blue-500/10 p-1.5 mt-0.5 shrink-0">
        <Archive className="h-4 w-4 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Restored from backup</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Your statuses, types, labs, and other settings were restored from your snapshot.
          Want to review them?
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" variant="outline" onClick={handleReview} data-testid="button-review-restored">
          Review settings
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={handleDismiss}
          aria-label="Dismiss"
          data-testid="button-dismiss-restore-banner"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
