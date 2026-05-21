// Settings → Computers (Host-only, owner/manager only).
//
// Live list of Client computers paired with this office's Host:
//   - Currently-connected pill (real-time, driven by sync-manager's
//     `office_updated` broadcasts on WS connect/disconnect)
//   - Who's logged in on that Client right now
//   - Inline rename (user-set `name` overrides the parsed
//     `auto_label` for display)
//   - Force-remove (revokes the recovery token + deletes the row +
//     frees the seat)
//
// All data via /api/devices, which returns the resolved displayName
// per row plus presence info. The list refreshes on the global
// `office_updated` event, which sync-manager invalidates queries on
// — so live presence Just Works without an explicit subscription.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Loader2, Pencil, Check as CheckIcon, X as XIcon, Trash2, ShieldAlert, MonitorCheck, Monitor } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface DeviceRow {
  id: string;
  displayName: string;
  name: string | null;
  autoLabel: string | null;
  connected: boolean;
  loggedInUser: { id: string; firstName: string; lastName: string } | null;
  firstSeenAt: string;
  lastSeenAt: string;
  blocked: boolean;
}

interface DevicesResponse {
  devices: DeviceRow[];
  connectedCount: number;
}

export default function ComputersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<DevicesResponse>({
    queryKey: ["/api/devices"],
    queryFn: async () => {
      const res = await fetch("/api/devices", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load devices (${res.status})`);
      return res.json();
    },
  });

  const renameMutation = useMutation({
    mutationFn: async (args: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/devices/${args.id}`, { name: args.name });
      return res.json();
    },
    onSuccess: () => {
      setEditingId(null);
      setEditDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't rename", description: error.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/devices/${id}`);
      return res.json();
    },
    onSuccess: () => {
      setConfirmRemoveId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({ title: "Computer removed", description: "Its seat is freed and it can't auto-reconnect." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't remove", description: error.message, variant: "destructive" });
    },
  });

  const beginRename = (row: DeviceRow) => {
    setEditingId(row.id);
    setEditDraft(row.name ?? row.displayName);
  };

  const commitRename = (id: string) => {
    const trimmed = editDraft.trim();
    renameMutation.mutate({ id, name: trimmed });
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const rowToRemove = data?.devices.find((d) => d.id === confirmRemoveId) ?? null;

  return (
    <div className="space-y-5" data-testid="computers-tab">
      <div>
        <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
          Computers
        </h3>
        <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-1">
          Every Client computer paired with this office. Rename to identify which is which; remove to free a seat.
        </p>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-line bg-panel py-10 grid place-items-center text-ink-mute text-[calc(12.5px*var(--ui-scale))]">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-[calc(12.5px*var(--ui-scale))] text-danger">
          Couldn't load the device list.
        </div>
      )}

      {data && data.devices.length === 0 && (
        <div className="rounded-lg border border-line bg-panel px-5 py-8 text-center">
          <div className="h-10 w-10 rounded-full bg-paper-2 grid place-items-center text-ink-mute mx-auto mb-2">
            <Monitor className="h-4 w-4" />
          </div>
          <p className="text-[calc(13px*var(--ui-scale))] text-ink m-0">No Clients paired yet.</p>
          <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute mt-1 m-0">
            When a staff member sets up Otto on another computer and points it at this Host, it'll show up here.
          </p>
        </div>
      )}

      {data && data.devices.length > 0 && (
        <>
          <div className="text-[calc(12px*var(--ui-scale))] text-ink-mute">
            <span className="font-medium text-ink">{data.connectedCount}</span> connected · <span>{data.devices.length}</span> total
          </div>
          <div className="rounded-lg border border-line bg-panel divide-y divide-line-2 overflow-hidden">
            {data.devices.map((row) => (
              <ComputerRow
                key={row.id}
                row={row}
                editing={editingId === row.id}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                onBeginRename={() => beginRename(row)}
                onCommitRename={() => commitRename(row.id)}
                onCancelRename={cancelRename}
                onRequestRemove={() => setConfirmRemoveId(row.id)}
                isSavingRename={renameMutation.isPending && editingId === row.id}
              />
            ))}
          </div>
        </>
      )}

      <AlertDialog open={confirmRemoveId !== null} onOpenChange={(open) => !removeMutation.isPending && !open && setConfirmRemoveId(null)}>
        <AlertDialogContent data-testid="dialog-confirm-remove-computer">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-danger" />
              Remove {rowToRemove?.displayName ?? "this computer"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-[calc(13px*var(--ui-scale))] text-ink-2 leading-relaxed">
                <p className="m-0">
                  This frees the seat right away. The computer will stop being able to connect to your office; the next time it tries, the person using it will see a "removed from office" message.
                </p>
                <p className="m-0 text-ink-mute">
                  Office data isn't affected — only this Client's link to it.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmRemoveId) removeMutation.mutate(confirmRemoveId);
              }}
              disabled={removeMutation.isPending}
              className="bg-danger text-white hover:bg-danger/90"
              data-testid="button-confirm-remove-computer"
            >
              {removeMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Remove computer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ComputerRow({
  row,
  editing,
  editDraft,
  setEditDraft,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onRequestRemove,
  isSavingRename,
}: {
  row: DeviceRow;
  editing: boolean;
  editDraft: string;
  setEditDraft: (v: string) => void;
  onBeginRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onRequestRemove: () => void;
  isSavingRename: boolean;
}) {
  const lastSeenRelative = (() => {
    try { return formatDistanceToNow(new Date(row.lastSeenAt), { addSuffix: true }); }
    catch { return null; }
  })();
  const firstSeenRelative = (() => {
    try { return formatDistanceToNow(new Date(row.firstSeenAt), { addSuffix: true }); }
    catch { return null; }
  })();

  const subtitle = (() => {
    if (row.connected) {
      const who = row.loggedInUser ? `${row.loggedInUser.firstName} ${row.loggedInUser.lastName}`.trim() : null;
      return who ? `Connected · ${who}` : "Connected";
    }
    return lastSeenRelative ? `Last seen ${lastSeenRelative}` : "Last seen recently";
  })();

  return (
    <div className="px-4 py-3 flex items-center gap-3" data-testid={`device-row-${row.id}`}>
      {/* Status indicator. Green = currently connected, gray =
          offline. Tooltips would be nice but a colored dot reads
          fast enough on its own. */}
      <div
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          row.connected ? "bg-brand-emerald shadow-[0_0_0_3px_var(--brand-emerald-soft,rgba(16,185,129,0.15))]" : "bg-ink-faint/40",
        )}
        aria-label={row.connected ? "Connected" : "Offline"}
      />

      {/* Name + subtitle. When editing, swap in an input field; on
          save, blur to commit (or Enter / click checkmark). Escape
          cancels. */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onCommitRename(); }
                if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
              }}
              placeholder={row.autoLabel || "Computer name"}
              maxLength={60}
              className="h-7 text-[calc(13px*var(--ui-scale))] bg-white max-w-[280px]"
              data-testid={`device-rename-input-${row.id}`}
            />
            <Button
              type="button"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onCommitRename}
              disabled={isSavingRename}
              data-testid={`device-rename-save-${row.id}`}
            >
              {isSavingRename ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckIcon className="h-3 w-3" />}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-ink-mute hover:text-ink"
              onClick={onCancelRename}
              disabled={isSavingRename}
              data-testid={`device-rename-cancel-${row.id}`}
            >
              <XIcon className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onBeginRename}
            className="group flex items-center gap-1.5 text-left max-w-full"
            data-testid={`device-name-${row.id}`}
          >
            <span className="text-[calc(13.5px*var(--ui-scale))] font-medium text-ink truncate">
              {row.displayName}
            </span>
            <Pencil className="h-3 w-3 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
            {/* Show the auto-label as muted suffix when the row has a
                user-set name, so admins can still see "this is the
                Mac · Chrome computer" without expanding anything. */}
            {row.name && row.autoLabel && (
              <span className="text-[calc(11px*var(--ui-scale))] text-ink-faint truncate">
                · {row.autoLabel}
              </span>
            )}
          </button>
        )}
        <div className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute mt-0.5 flex items-center gap-1.5">
          {row.connected && <MonitorCheck className="h-3 w-3 text-brand-emerald shrink-0" aria-hidden />}
          <span className="truncate">{subtitle}</span>
          {firstSeenRelative && !row.connected && (
            <span className="text-ink-faint truncate">· paired {firstSeenRelative}</span>
          )}
        </div>
      </div>

      {!editing && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-ink-mute hover:text-danger"
          onClick={onRequestRemove}
          aria-label={`Remove ${row.displayName}`}
          data-testid={`device-remove-${row.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
