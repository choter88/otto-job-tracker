import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ACTIVITY_CATALOG,
  type ActivityType,
  type TileType,
  type TodayConfig,
} from "@shared/today-defaults";

const TILE_TYPES: { type: TileType; label: string }[] = [
  { type: "queue", label: "Job queue" },
  { type: "stats", label: "Office snapshot" },
  { type: "team", label: "Team activity" },
];

interface TileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "queue" | "activity";
  slotIndex?: number;
  config: TodayConfig;
  customStatuses: { id: string; label: string }[];
  role: string;
  onSave: (next: TodayConfig) => void;
}

export default function TileEditDialog({
  open,
  onOpenChange,
  kind,
  slotIndex,
  config,
  customStatuses,
  role,
  onSave,
}: TileEditDialogProps) {
  const [draft, setDraft] = useState<TodayConfig>(config);
  const privileged = role === "owner" || role === "manager";

  // Reset draft to current config whenever the dialog opens.
  useEffect(() => {
    if (open) setDraft(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    onSave(draft);
    onOpenChange(false);
  };

  const cancel = () => onOpenChange(false);

  // Helpers for queue-slot edits.
  const setSlot = (patch: Partial<TodayConfig["slots"][number]>) => {
    if (slotIndex == null) return;
    const slots = [...draft.slots] as TodayConfig["slots"];
    slots[slotIndex] = { ...slots[slotIndex], ...patch };
    setDraft({ ...draft, slots });
  };

  const slot = kind === "queue" && slotIndex != null ? draft.slots[slotIndex] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-80 max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {kind === "queue" ? "Edit tile" : "Edit activity feed"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {kind === "queue" && slot != null && (
            <>
              {privileged && (
                <div className="rounded-md border border-otto-accent-line bg-otto-accent-soft p-2.5">
                  <label className="text-xs font-semibold text-otto-accent-ink">Show this tile as</label>
                  <select
                    className="w-full text-sm border border-line rounded px-2 py-1.5 mt-1 bg-background"
                    value={slot.type}
                    onChange={(e) => setSlot({ type: e.target.value as TileType })}
                    data-testid="edit-tile-type"
                  >
                    {TILE_TYPES.map((t) => (
                      <option key={t.type} value={t.type}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-ink-mute mt-1.5">
                    Owners &amp; managers can swap a job queue for analytics, stats, or team activity.
                  </p>
                </div>
              )}

              {slot.type === "queue" && (
                <>
                  <div>
                    <label className="text-xs font-medium">Title</label>
                    <input
                      className="w-full text-sm border rounded px-2 py-1 mt-1 bg-background"
                      value={slot.title ?? ""}
                      onChange={(e) => setSlot({ title: e.target.value })}
                      data-testid="edit-title"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium">Statuses</label>
                    <div className="max-h-40 overflow-auto space-y-1 mt-1">
                      {customStatuses.map((s) => {
                        const checked = (slot.statusIds ?? []).includes(s.id);
                        return (
                          <label key={s.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              data-testid={`edit-status-${s.id}`}
                              onChange={(e) =>
                                setSlot({
                                  statusIds: e.target.checked
                                    ? [...(slot.statusIds ?? []), s.id]
                                    : (slot.statusIds ?? []).filter((id) => id !== s.id),
                                })
                              }
                            />
                            {s.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {kind === "activity" && (
            <div>
              <label className="text-xs font-medium">Show in this feed</label>
              <div className="space-y-1 mt-1">
                {ACTIVITY_CATALOG.map((a) => {
                  const checked = draft.activityFilter.includes(a.type);
                  return (
                    <label key={a.type} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        data-testid={`edit-activity-${a.type}`}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            activityFilter: e.target.checked
                              ? [...draft.activityFilter, a.type as ActivityType]
                              : draft.activityFilter.filter((t) => t !== a.type),
                          })
                        }
                      />
                      {a.label}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button size="xs" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button size="xs" onClick={save} data-testid="edit-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
