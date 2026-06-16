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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FolderOpen, HelpCircle, Loader2 } from "lucide-react";

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

  const toggleAutoPrint = async (autoPrint: boolean) => {
    setBusy(true);
    try {
      await desktop.configure({ autoPrint });
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
    <div className="space-y-2">
      {/* Setup contexts (e.g. the wizard) pass a description; the page
          omits it — the card title already frames the section, so we don't
          repeat 3 lines of helper text every time the user lands here. */}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}

      {/* One-row primary state: switch · status pill · folder path · change.
          Folder takes the remaining width and truncates so the row stays
          one line at typical breakpoints. */}
      <div className="flex items-center gap-2 flex-wrap">
        <Switch
          checked={!!desktop.config?.enabled}
          onCheckedChange={(checked) => void toggleEnabled(checked)}
          disabled={busy || !canEdit}
          data-testid="switch-order-sheets-enabled"
          aria-label="Watch folder for order sheets"
        />
        <span className="text-sm font-medium text-ink">{desktop.config?.enabled ? "On" : "Off"}</span>

        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[calc(11px*var(--ui-scale))] font-medium",
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

        {desktop.config?.folder && (
          <span
            className="text-xs text-ink-mute font-mono truncate min-w-0 flex-1"
            title={desktop.config.folder}
            data-testid="text-order-sheets-folder"
          >
            {desktop.config.folder}
          </span>
        )}

        {desktop.pending.length > 0 && (
          <span
            className="inline-flex items-center gap-1 text-xs text-ink-mute shrink-0"
            data-testid="text-order-sheets-processing"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            {desktop.pending.length} processing…
          </span>
        )}

        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void chooseFolder()}
            disabled={busy}
            className="h-7 text-xs shrink-0"
            data-testid="button-order-sheets-choose-folder"
          >
            <FolderOpen className="h-3 w-3 mr-1" />
            {desktop.config?.folder ? "Change" : "Choose folder"}
          </Button>
        )}
      </div>

      {/* Auto-print — same line as a compact toggle. The help text moved
          to a tooltip since the row is already self-explanatory once
          you've seen it once. */}
      <div
        className={cn(
          "flex items-center gap-2 text-sm",
          !desktop.config?.enabled && "opacity-55",
        )}
      >
        <Switch
          checked={desktop.config?.autoPrint !== false}
          onCheckedChange={(checked) => void toggleAutoPrint(checked)}
          disabled={busy || !canEdit || !desktop.config?.enabled}
          data-testid="switch-order-sheets-autoprint"
          aria-label="Auto-print imported order sheets"
        />
        <span className="font-medium text-ink">Auto-print order sheets</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-ink-mute hover:text-ink" aria-label="Auto-print help">
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[260px]">
            {desktop.config?.enabled
              ? "When a sheet is imported, Otto opens it for printing on this computer — no need to print from your EHR. Your printer's dialog appears each time."
              : "Turn on folder watching above to use auto-print."}
          </TooltipContent>
        </Tooltip>
      </div>

      {watcherState === "error" && desktop.status?.error && (
        <p className="text-sm text-danger" data-testid="text-order-sheets-error">
          {desktop.status.error}
        </p>
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
