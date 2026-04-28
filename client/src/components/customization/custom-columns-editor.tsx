import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { CustomColumn } from "./columns-helpers";

export type { CustomColumn };

interface CustomColumnsEditorProps {
  columns: CustomColumn[];
  onChange: (next: CustomColumn[]) => void;
  emptyHint?: string;
}

function AddColumnDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (col: CustomColumn) => void;
}) {
  const [name, setName] = useState("");
  const [colType, setColType] = useState("text");
  const [optionsText, setOptionsText] = useState("");
  const [editableInWorklist, setEditableInWorklist] = useState(true);

  const options = optionsText.split("\n").map((o) => o.trim()).filter(Boolean);
  const isValid = name.trim().length > 0 && (colType !== "select" || options.length > 0);

  const handleSubmit = () => {
    if (!isValid) return;
    onAdd({
      id: `col_${Date.now()}`,
      name: name.trim(),
      type: colType,
      order: 999,
      active: true,
      editableInWorklist,
      ...(colType === "select" ? { options } : {}),
    });
    setName("");
    setColType("text");
    setOptionsText("");
    setEditableInWorklist(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Add Custom Column</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-sm font-medium">Column Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter column name"
              autoFocus
              data-testid="input-add-column-name"
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Column Type</Label>
            <Select value={colType} onValueChange={setColType}>
              <SelectTrigger data-testid="select-add-column-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="select">Select (Dropdown)</SelectItem>
                <SelectItem value="checkbox">Checkbox</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="number">Number</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {colType === "select" && (
            <div>
              <Label className="text-sm font-medium">Options (one per line)</Label>
              <textarea
                className="w-full min-h-[100px] mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={"Option 1\nOption 2\nOption 3"}
              />
              {optionsText.length > 0 && options.length === 0 && (
                <p className="text-xs text-destructive mt-1">Add at least one option</p>
              )}
              {options.length === 0 && optionsText.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">At least one option is required</p>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="add-col-worklist"
              checked={editableInWorklist}
              onChange={(e) => setEditableInWorklist(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <Label htmlFor="add-col-worklist" className="text-sm">
              Editable in worklist
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid} data-testid="button-confirm-add-column">
            Add Column
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { cleanColumnsForSave } from "./columns-helpers";

export default function CustomColumnsEditor({ columns, onChange, emptyHint }: CustomColumnsEditorProps) {
  const [addOpen, setAddOpen] = useState(false);

  const updateColumn = (id: string, updates: Partial<CustomColumn>) => {
    onChange(columns.map((col) => (col.id === id ? { ...col, ...updates } : col)));
  };
  const deleteColumn = (id: string) => onChange(columns.filter((col) => col.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
            Custom Columns
          </h3>
          <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-1">
            Optional fields you want to track on every job (lab order #, frame model, etc).
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-custom-column" className="shrink-0">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Column
        </Button>
      </div>

      <div className="space-y-3">
        {columns.map((column) => (
          <div key={column.id}>
            <div
              className="flex items-center gap-3 p-4 bg-panel border border-line rounded-lg hover:shadow-soft transition-shadow"
              data-testid={`custom-column-${column.id}`}
            >
              <GripVertical className="h-4 w-4 text-ink-mute cursor-move shrink-0" />

              <div className="flex-1 grid grid-cols-2 gap-3 min-w-0">
                <div>
                  <Label htmlFor={`column-name-${column.id}`} className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold mb-1 block">
                    Column Name
                  </Label>
                  <Input
                    id={`column-name-${column.id}`}
                    value={column.name}
                    onChange={(e) => updateColumn(column.id, { name: e.target.value })}
                    className="font-medium h-9"
                    data-testid={`input-column-name-${column.id}`}
                  />
                </div>

                <div>
                  <Label htmlFor={`column-type-${column.id}`} className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold mb-1 block">
                    Column Type
                  </Label>
                  <Select
                    value={column.type}
                    onValueChange={(value) => updateColumn(column.id, { type: value })}
                  >
                    <SelectTrigger
                      id={`column-type-${column.id}`}
                      data-testid={`select-column-type-${column.id}`}
                      className="h-9"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="select">Select (Dropdown)</SelectItem>
                      <SelectItem value="checkbox">Checkbox</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 text-[calc(11px*var(--ui-scale))] text-ink-mute shrink-0 self-end pb-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={column.editableInWorklist !== false}
                    onChange={(e) => updateColumn(column.id, { editableInWorklist: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-input accent-primary"
                  />
                  Worklist edit
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={column.active}
                    onChange={(e) => updateColumn(column.id, { active: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-input accent-primary"
                    data-testid={`switch-column-active-${column.id}`}
                  />
                  Active
                </label>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteColumn(column.id)}
                data-testid={`button-delete-column-${column.id}`}
                className="text-ink-mute hover:text-danger self-end"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {column.type === "select" && (
              <div className="ml-8 mt-2 mb-2 p-3 bg-paper-2 rounded-md border border-line-2">
                <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold mb-1.5 block">
                  Options (one per line)
                </Label>
                <textarea
                  className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-[calc(13px*var(--ui-scale))] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={(column.options || []).join("\n")}
                  onChange={(e) => updateColumn(column.id, { options: e.target.value.split("\n") })}
                  placeholder={"Option 1\nOption 2\nOption 3"}
                />
                <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute mt-1.5">
                  Users will pick from these options when setting this field.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {columns.length === 0 && (
        <div className="px-6 py-10 text-center bg-paper-2 rounded-lg border border-dashed border-line">
          <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute">
            {emptyHint || 'No custom columns yet. Click "Add Column" to create your first.'}
          </p>
        </div>
      )}

      <AddColumnDialog open={addOpen} onOpenChange={setAddOpen} onAdd={(col) => onChange([...columns, col])} />
    </div>
  );
}
