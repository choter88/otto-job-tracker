// Order-sheet folder setup — the shared "pick a folder, turn it on" control.
//
// Rendered in two places with identical behavior:
//   • the Order Sheets page (Settings-style card), and
//   • the first-run setup wizard step.
// Keeping it in one component means the choose-folder → existing-files
// choice → live-status flow can't drift between the two surfaces.
//
// It owns the desktop bridge (useOrderSheetsDesktop), so it works only in
// the Electron app; in a browser/tablet it shows a "set this up on the
// front-desk computer" message instead. The chosen folder is stored
// per-machine in otto-config.json via the bridge — NOT in office settings
// — so there's nothing for the caller to persist.

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useOrderSheetsDesktop } from "@/hooks/use-order-sheets";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { FolderOpen, Loader2 } from "lucide-react";

interface OrderSheetFolderSetupProps {
  /**
   * Shown above the controls when the desktop bridge is available. Lets the
   * page and the wizard set their own framing. Omit for no intro line.
   */
  description?: string;
}

export default function OrderSheetFolderSetup({ description }: OrderSheetFolderSetupProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const desktop = useOrderSheetsDesktop();
  const canEdit = user?.role !== "view_only";

  const [enableDialogOpen, setEnableDialogOpen] = useState(false);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chooseFolder = async () => {
    setBusy(true);
    try {
      const folder = await desktop.pickFolder();
      if (folder) {
        setPendingFolder(folder);
        setEnableDialogOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const enableWatching = async (includeExisting: boolean) => {
    if (!pendingFolder) return;
    setBusy(true);
    try {
      await desktop.configure({ enabled: true, folder: pendingFolder, includeExisting });
      toast({
        title: "Watching for order sheets",
        description: includeExisting
          ? "New files and the files already in the folder will be imported."
          : "New files saved to the folder will be imported automatically.",
      });
    } finally {
      setBusy(false);
      setEnableDialogOpen(false);
      setPendingFolder(null);
    }
  };

  // Toggle is a shortcut: flipping ON with no folder yet jumps to the
  // picker; flipping OFF stops the watcher but remembers the folder.
  const toggleEnabled = async (enabled: boolean) => {
    if (enabled && !desktop.config?.folder) {
      await chooseFolder();
      return;
    }
    setBusy(true);
    try {
      await desktop.configure({ enabled });
    } finally {
      setBusy(false);
    }
  };

  const watcherState = desktop.status?.state || "stopped";
  const watching = desktop.config?.enabled && watcherState === "watching";

  if (!desktop.available) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-order-sheets-no-bridge">
        Folder watching runs in the Otto desktop app. Open Otto on the computer where order sheets are
        saved (usually the front desk) and set the folder there. Everything imported shows up here for
        the whole office.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {description && <p className="text-sm text-muted-foreground">{description}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={!!desktop.config?.enabled}
            onCheckedChange={(checked) => void toggleEnabled(checked)}
            disabled={busy || !canEdit}
            data-testid="switch-order-sheets-enabled"
            aria-label="Watch folder for order sheets"
          />
          <span className="text-sm font-medium text-ink">{desktop.config?.enabled ? "On" : "Off"}</span>
        </div>

        <span
          className={cn(
            "inline-flex items-center gap-2 px-3 py-[5px] rounded-full text-[calc(11.5px*var(--ui-scale))] font-medium",
            watching && "text-brand-emerald",
            watcherState === "error" && "bg-danger-bg text-danger",
            !watching && watcherState !== "error" && "bg-line-2 text-ink-mute",
          )}
          style={watching ? { background: "rgba(47, 158, 110, 0.10)" } : undefined}
          data-testid="status-order-sheets-watcher"
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              watching && "bg-brand-emerald animate-[ottoPulseDot_2.4s_ease-out_infinite]",
              watcherState === "error" && "bg-danger",
              !watching && watcherState !== "error" && "bg-ink-mute",
            )}
          />
          {watching ? "Watching" : watcherState === "error" ? "Problem with folder" : "Not watching"}
        </span>

        {desktop.pending.length > 0 && (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-ink-mute"
            data-testid="text-order-sheets-processing"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing {desktop.pending.length} file{desktop.pending.length === 1 ? "" : "s"}…
          </span>
        )}
      </div>

      {desktop.config?.folder && (
        <p
          className="text-xs text-ink-mute font-mono truncate"
          title={desktop.config.folder}
          data-testid="text-order-sheets-folder"
        >
          {desktop.config.folder}
        </p>
      )}

      {watcherState === "error" && desktop.status?.error && (
        <p className="text-sm text-danger" data-testid="text-order-sheets-error">
          {desktop.status.error}
        </p>
      )}

      {canEdit && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void chooseFolder()}
            disabled={busy}
            data-testid="button-order-sheets-choose-folder"
          >
            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
            {desktop.config?.folder ? "Change folder" : "Choose folder"}
          </Button>
        </div>
      )}

      {/* Existing-files choice when enabling */}
      <AlertDialog open={enableDialogOpen} onOpenChange={setEnableDialogOpen}>
        <AlertDialogContent data-testid="dialog-order-sheets-existing">
          <AlertDialogHeader>
            <AlertDialogTitle>Import files already in this folder?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block font-mono text-xs truncate">{pendingFolder}</span>
              <span className="block">
                Otto can import the order sheets already sitting in this folder, or only watch for new ones
                saved from now on.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setEnableDialogOpen(false);
                setPendingFolder(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => void enableWatching(true)}
              disabled={busy}
              data-testid="button-order-sheets-include-existing"
            >
              Import existing too
            </Button>
            <AlertDialogAction
              onClick={() => void enableWatching(false)}
              disabled={busy}
              data-testid="button-order-sheets-new-only"
            >
              Only new files
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
