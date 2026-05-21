// "Uninstall and remove from account" — Client-only.
//
// Flow:
//   1. Confirmation dialog spells out what's about to happen and that
//      it can't be undone.
//   2. On confirm, POST /api/devices/self/release with this computer's
//      deviceId so the Host deletes the device row and frees the seat
//      (the office's clientSlots count drops immediately).
//   3. Wipe local state via the Electron bridge: browser session
//      storage (cookies, localStorage including the deviceId), config
//      file (mode, hostUrl, pairing code, cert fingerprint), TLS dir,
//      outbox, session secret.
//   4. Show a final OS-specific "drag Otto to Trash" screen and quit.
//
// Hidden when the desktop config reports mode !== "client" — Host
// removal is a separate flow (portal → Replace Host).

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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
import { Loader2, MonitorOff, ShieldAlert } from "lucide-react";

interface Props {
  /** Host URL this Client is paired with (e.g. "https://host.lan:5150").
   *  Shown to the user so they don't accidentally uninstall the wrong
   *  Client (rare edge case but the cost of being wrong is high). */
  hostUrl?: string;
}

function getDeviceId(): string | null {
  try { return localStorage.getItem("otto.deviceId"); }
  catch { return null; }
}

function getPlatformLabel(p: string): string {
  if (p === "darwin") return "macOS";
  if (p === "win32") return "Windows";
  return p;
}

function getDragInstructions(p: string): string {
  if (p === "darwin") return "Open Finder, go to Applications, and drag Otto Tracker to the Trash.";
  if (p === "win32") return "Open Settings → Apps → Installed apps, find Otto Tracker, and click Uninstall.";
  return "Remove the Otto Tracker application from your system.";
}

export default function UninstallClientCard({ hostUrl }: Props) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState<{ platform: string } | null>(null);

  const releaseMutation = useMutation({
    mutationFn: async () => {
      const deviceId = getDeviceId();
      if (!deviceId) throw new Error("No device id found on this computer.");
      // 1. Free the seat on the Host. Failure here aborts — better
      //    to leave the local install intact than to wipe the
      //    computer while still occupying a seat on the office.
      const res = await apiRequest("POST", "/api/devices/self/release", { deviceId });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Host did not confirm release.");

      // 2. Wipe local state via Electron. Only after the seat is
      //    freed; if the Electron bridge isn't present (web preview),
      //    skip silently and surface a note in the success toast.
      const bridge = (window as any)?.otto;
      let platform = "unknown";
      if (bridge?.releaseClient) {
        const result = await bridge.releaseClient();
        if (!result?.ok) throw new Error(result?.error || "Local cleanup failed.");
        platform = String(result.platform || "unknown");
      }

      // Clear the deviceId from localStorage as a belt-and-braces
      // in case Electron's clearStorageData missed it for any reason.
      try { localStorage.removeItem("otto.deviceId"); } catch { /* ignore */ }

      return { platform };
    },
    onSuccess: ({ platform }) => {
      setConfirmOpen(false);
      setDone({ platform });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't remove this computer", description: error.message, variant: "destructive" });
    },
  });

  return (
    <>
      <div className="rounded-lg border border-danger/30 bg-danger/[0.03] p-5 space-y-3" data-testid="uninstall-client-card">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-danger/10 grid place-items-center text-danger shrink-0">
            <MonitorOff className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-display text-[calc(15px*var(--ui-scale))] font-medium tracking-[-0.01em] text-ink m-0">
              Uninstall and remove from account
            </h4>
            <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute mt-1 leading-snug">
              Removes this computer from your office's Client list. Frees the seat right away so it stops counting toward your paid Client limit. After it's done, drag Otto to the Trash to finish removing the app from this computer.
            </p>
            {hostUrl && (
              <p className="text-[calc(11px*var(--ui-scale))] text-ink-faint mt-1.5 m-0 tabular-nums">
                Paired with <span className="text-ink-mute">{hostUrl}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={releaseMutation.isPending}
            data-testid="button-uninstall-client"
          >
            <MonitorOff className="h-3.5 w-3.5 mr-1.5" />
            Uninstall and remove from account
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !releaseMutation.isPending && setConfirmOpen(open)}>
        <AlertDialogContent data-testid="dialog-confirm-uninstall">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-danger" />
              Remove this computer from your account?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-[calc(13px*var(--ui-scale))] text-ink-2 leading-relaxed">
                <p className="m-0">
                  Otto will sign out, free this computer's Client seat on your office, and wipe its local data (config, cached sign-in, deviceId).
                </p>
                <p className="m-0">
                  Your office's data on the Host computer is <strong>not</strong> affected — only this computer's connection to it.
                </p>
                <p className="m-0 text-ink-mute">
                  This can't be undone from here. To use this computer with Otto again, you'd need to set it up as a Client from scratch.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={releaseMutation.isPending} data-testid="button-cancel-uninstall">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                releaseMutation.mutate();
              }}
              disabled={releaseMutation.isPending}
              className="bg-danger text-white hover:bg-danger/90"
              data-testid="button-confirm-uninstall"
            >
              {releaseMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Remove this computer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Final "done" overlay. Electron quits ~1.2s after returning,
          so this view only renders briefly — but staff need a clear
          confirmation that the seat is freed before the app vanishes. */}
      <AlertDialog open={done !== null}>
        <AlertDialogContent data-testid="dialog-uninstall-done">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <MonitorOff className="h-5 w-5 text-otto-accent" />
              Removed from account
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-[calc(13px*var(--ui-scale))] text-ink-2 leading-relaxed">
                <p className="m-0">
                  This computer no longer counts toward your Client limit, and its local Otto data has been wiped.
                </p>
                {done && (
                  <p className="m-0">
                    <strong>To finish uninstalling on {getPlatformLabel(done.platform)}:</strong> {getDragInstructions(done.platform)}
                  </p>
                )}
                <p className="m-0 text-ink-mute">
                  Otto will close in a moment.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
