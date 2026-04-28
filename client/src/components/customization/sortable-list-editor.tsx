import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { chooseHighContrastColor, hexToHSL } from "@/lib/default-colors";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export type CustomListItem = {
  id: string;
  label: string;
  color: string;
  hsl?: string;
  order: number;
};

type ListType = "statuses" | "jobTypes" | "destinations";

interface SortableListEditorProps {
  items: CustomListItem[];
  onChange: (next: CustomListItem[]) => void;
  type: ListType;
  title?: string;
  description?: string;
}

function typeNoun(type: ListType): string {
  return type === "statuses" ? "Status" : type === "jobTypes" ? "Job Type" : "Destination";
}

const LOCKED_STATUS_FIRST = "job_created";
const LOCKED_STATUS_LAST = "completed";

function isLockedStatusId(id: string): boolean {
  return id === LOCKED_STATUS_FIRST || id === LOCKED_STATUS_LAST;
}

function SortableRow({
  item,
  type,
  isDraggable,
  position,
  onUpdate,
  onDelete,
}: {
  item: CustomListItem;
  type: ListType;
  isDraggable: boolean;
  /** 1-based position used for the numbered badge on status rows. */
  position: number;
  onUpdate: (id: string, updates: Partial<CustomListItem>) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isLocked = type === "statuses" && isLockedStatusId(item.id);
  // Status order matters (drives the lifecycle progress bar). Show a numbered
  // badge on status rows so users understand their position in the workflow.
  const showPositionNumber = type === "statuses";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-2 h-11 bg-panel border-b border-line-2 last:border-b-0 transition-colors hover:bg-panel-2",
        isDragging && "shadow-lg z-50 bg-panel border border-line rounded-md",
      )}
      data-testid={`custom-item-${item.id}`}
    >
      {isDraggable ? (
        <div
          {...attributes}
          {...listeners}
          className="cursor-move w-6 h-6 grid place-items-center text-ink-mute hover:text-ink-2 shrink-0"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
      ) : (
        <div className="w-6 h-6 grid place-items-center text-ink-faint shrink-0" title="Required position">
          <GripVertical className="h-3.5 w-3.5" />
        </div>
      )}

      {showPositionNumber && (
        <span
          className="w-5 h-5 rounded-full bg-paper-2 text-ink-mute font-mono text-[calc(10.5px*var(--ui-scale))] font-medium grid place-items-center shrink-0 tabular-nums"
          data-testid={`position-badge-${item.id}`}
          aria-label={`Position ${position}`}
        >
          {position}
        </span>
      )}

      <div className="flex-1 min-w-0">
        <Input
          value={item.label}
          onChange={(e) => onUpdate(item.id, { label: e.target.value })}
          className="h-7 px-2 text-[calc(13px*var(--ui-scale))] font-medium border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:bg-paper-2"
          data-testid={`input-label-${item.id}`}
        />
      </div>

      <label
        className="relative w-6 h-6 rounded-full cursor-pointer shrink-0 transition-transform hover:scale-110 ring-1 ring-line"
        style={{ backgroundColor: item.color || "#888888" }}
        title="Click to change color"
      >
        <input
          type="color"
          value={item.color}
          onChange={(e) =>
            onUpdate(item.id, { color: e.target.value, hsl: hexToHSL(e.target.value) })
          }
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          data-testid={`input-color-${item.id}`}
        />
      </label>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-ink-mute hover:text-danger"
        onClick={() => onDelete(item.id)}
        disabled={isLocked}
        data-testid={`button-delete-${item.id}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function AddItemDialog({
  open,
  onOpenChange,
  type,
  existingColors,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: ListType;
  existingColors: string[];
  onAdd: (item: CustomListItem) => void;
}) {
  const noun = typeNoun(type);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(() => chooseHighContrastColor(existingColors));

  const isValid = label.trim().length > 0;

  const handleSubmit = () => {
    if (!isValid) return;
    onAdd({
      id: `custom_${Date.now()}`,
      label: label.trim(),
      color,
      hsl: hexToHSL(color),
      order: 999,
    });
    setLabel("");
    setColor(chooseHighContrastColor(existingColors));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Add {noun}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-sm font-medium">Name</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`Enter ${noun.toLowerCase()} name`}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && isValid && handleSubmit()}
              data-testid={`input-add-${type}-label`}
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Color</Label>
            <div className="flex items-center gap-3 mt-1">
              <label
                className="w-10 h-10 rounded-lg cursor-pointer border border-border shadow-sm relative"
                style={{ backgroundColor: color }}
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="absolute opacity-0 w-0 h-0"
                />
              </label>
              <span className="text-sm text-muted-foreground">{color}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid} data-testid={`button-confirm-add-${type}`}>
            Add {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SortableListEditor({
  items,
  onChange,
  type,
  title,
  description,
}: SortableListEditorProps) {
  const [addOpen, setAddOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleUpdate = (id: string, updates: Partial<CustomListItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  };

  const handleDelete = (id: string) => {
    if (type === "statuses" && isLockedStatusId(id)) return;
    onChange(items.filter((item) => item.id !== id));
  };

  // Reassign the `order` field to match array position so persisted data
  // matches the drag-rendered order (and sort-by-order in lifecycle/filters
  // stays in sync with what the user sees here).
  const reindex = (list: CustomListItem[]): CustomListItem[] =>
    list.map((item, idx) => ({ ...item, order: idx + 1 }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    if (type === "statuses") {
      // job_created stays first, completed stays last
      const moving = items[oldIndex];
      if (isLockedStatusId(moving.id)) return;
      if (newIndex === 0 || newIndex === items.length - 1) return;
      const reordered = arrayMove(items, oldIndex, newIndex);
      const firstId = reordered[0]?.id;
      const lastId = reordered[reordered.length - 1]?.id;
      if (firstId !== LOCKED_STATUS_FIRST || lastId !== LOCKED_STATUS_LAST) return;
      onChange(reindex(reordered));
    } else {
      onChange(reindex(arrayMove(items, oldIndex, newIndex)));
    }
  };

  const handleAdd = (item: CustomListItem) => {
    // New items go at the end and inherit the next order index.
    onChange(reindex([...items, item]));
  };

  const itemIds = items.map((item) => item.id);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {title ? (
            <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
              {title}
            </h3>
          ) : null}
          {description ? (
            <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-1">
              {description}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          onClick={() => setAddOpen(true)}
          data-testid={`button-add-${type}`}
          className="shrink-0"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add {typeNoun(type)}
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="rounded-lg border border-line bg-panel overflow-hidden">
            {items.map((item, idx) => {
              const isDraggable = type !== "statuses" || !isLockedStatusId(item.id);
              return (
                <SortableRow
                  key={item.id}
                  item={item}
                  type={type}
                  isDraggable={isDraggable}
                  position={idx + 1}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {type === "statuses" ? (
        <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute leading-relaxed flex items-start gap-2">
          <span className="inline-block w-1.5 h-1.5 bg-otto-accent rounded-full mt-1.5 shrink-0" aria-hidden />
          <span>
            Statuses are numbered in workflow order — drag to rearrange. The
            lifecycle progress bar follows this order. "Job Created" and
            "Completed" stay first and last.
          </span>
        </p>
      ) : null}

      <AddItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        type={type}
        existingColors={items.map((i) => i.color)}
        onAdd={handleAdd}
      />
    </div>
  );
}
