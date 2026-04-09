import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Settings,
  ListTodo,
  Tag,
  Bell,
  MessageSquare,
  Building,
  Save,
  Plus,
  Trash2,
  GripVertical,
  Columns,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  Tablet,
} from "lucide-react";
import NotificationRules from "./notification-rules";
import { DEFAULT_STATUS_COLORS, DEFAULT_JOB_TYPE_COLORS, DEFAULT_DESTINATION_COLORS, chooseHighContrastColor, getColorForBadge, hexToHSL, normalizeToHex } from "@/lib/default-colors";
import { ensureReadyForPickupTemplate } from "@shared/message-template-defaults";
import type { Office } from "@shared/schema";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SortableItemProps {
  id: string;
  item: any;
  type: 'statuses' | 'jobTypes' | 'destinations';
  isDraggable: boolean;
  updateCustomItem: (type: 'statuses' | 'jobTypes' | 'destinations', id: string, updates: any) => void;
  deleteCustomItem: (type: 'statuses' | 'jobTypes' | 'destinations', id: string) => void;
}

function SortableItem({ id, item, type, isDraggable, updateCustomItem, deleteCustomItem }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: id,
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2.5 bg-card border border-border rounded-lg hover:shadow-soft transition-shadow ${
        isDragging ? 'shadow-lg z-50' : ''
      }`}
      data-testid={`custom-item-${item.id}`}
    >
      {isDraggable ? (
        <div {...attributes} {...listeners} className="cursor-move">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      ) : (
        <div className="cursor-not-allowed opacity-50">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      
      <div className="flex-1">
        <Input
          value={item.label}
          onChange={(e) => updateCustomItem(type, item.id, { label: e.target.value })}
          className="font-medium"
          data-testid={`input-label-${item.id}`}
        />
      </div>

      <label
        className="relative w-9 h-9 rounded-md cursor-pointer border border-border/50 shrink-0 transition-shadow hover:shadow-md"
        style={{ backgroundColor: item.color || "#888888" }}
        title="Click to change color"
      >
        <input
          type="color"
          value={item.color}
          onChange={(e) => updateCustomItem(type, item.id, { color: e.target.value })}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          data-testid={`input-color-${item.id}`}
        />
      </label>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => deleteCustomItem(type, item.id)}
        disabled={item.id === 'job_created' || item.id === 'completed'}
        data-testid={`button-delete-${item.id}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function InviteCodeSection() {
  const [copied, setCopied] = useState(false);

  const { data: inviteData, isLoading: inviteLoading, error: inviteError } = useQuery<{ inviteCode: string; expiresAt?: number }>({
    queryKey: ["/api/invite-code"],
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/invite-code/regenerate");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/invite-code"], data);
      toast({ title: "Invite code regenerated", description: "The old code is no longer valid." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to regenerate", description: error.message, variant: "destructive" });
    },
  });

  const inviteCode = inviteData?.inviteCode || "";
  const displayCode = inviteCode.length === 6
    ? `${inviteCode.slice(0, 3)} ${inviteCode.slice(3)}`
    : inviteCode;

  const handleCopy = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Invite Code</h3>
        <p className="text-sm text-muted-foreground">
          Share this code with team members so they can join your practice from their own computer.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        {inviteLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
            <span className="ml-3 text-sm text-muted-foreground">Loading invite code...</span>
          </div>
        ) : inviteError ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              Could not load the invite code. Make sure this computer is connected to the internet.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-3">Your practice's invite code</p>
              <div className="flex items-center justify-center gap-3">
                <span className="text-4xl font-mono font-bold tracking-[0.3em] select-all">
                  {displayCode || "------"}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  disabled={!inviteCode}
                  title="Copy invite code"
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-center">
              <Button
                variant="outline"
                onClick={() => regenerateMutation.mutate()}
                disabled={regenerateMutation.isPending}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
                {regenerateMutation.isPending ? "Regenerating..." : "Generate New Code"}
              </Button>
            </div>

            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                Team members enter this code on their computer when setting up Otto for the first time.
                Regenerating creates a new code and invalidates the old one.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-modal: Add Status / Job Type / Destination ────────────────────

function TabletSettingsContent() {
  const [tabletUrl, setTabletUrl] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/tablet/api/qr-setup")
      .then((r) => r.json())
      .then((data) => setTabletUrl(data.url))
      .catch(() => {});
    fetch("/tablet/api/sessions")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) ? setSessions(data) : null)
      .catch(() => {});
  }, []);

  const handleCopy = () => {
    if (tabletUrl) {
      navigator.clipboard.writeText(tabletUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Tablet Lab Board</h3>
        <p className="text-sm text-muted-foreground">
          Set up a tablet in your lab for technicians to view and manage jobs.
          Open the URL below on your tablet's browser, or scan the QR code.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <div>
          <Label className="text-sm font-medium">Tablet URL</Label>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono break-all">
              {tabletUrl || "Loading..."}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={!tabletUrl}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            The tablet must be on the same network as this computer.
          </p>
        </div>

        <div>
          <Label className="text-sm font-medium">Setup Instructions</Label>
          <ol className="mt-1 text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Open Chrome on the tablet</li>
            <li>Navigate to the URL above</li>
            <li>Tap the browser menu and select "Add to Home Screen"</li>
            <li>Select your name and enter your PIN to sign in</li>
          </ol>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Connected Tablets
        </h4>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tablets currently connected.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <span className="text-sm font-medium">{s.firstName} {s.lastName}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Last seen {new Date(s.lastSeenAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddItemModal({
  open,
  onOpenChange,
  type,
  existingColors,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'statuses' | 'jobTypes' | 'destinations';
  existingColors: string[];
  onAdd: (item: { id: string; label: string; color: string; hsl: string; order: number }) => void;
}) {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(() => chooseHighContrastColor(existingColors));

  const typeLabel = type === 'statuses' ? 'Status' : type === 'jobTypes' ? 'Job Type' : 'Destination';
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
    setLabel('');
    setColor(chooseHighContrastColor(existingColors));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Add {typeLabel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-sm font-medium">Name</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`Enter ${typeLabel.toLowerCase()} name`}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && isValid && handleSubmit()}
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Color</Label>
            <div className="flex items-center gap-3 mt-1">
              <label
                className="w-10 h-10 rounded-lg cursor-pointer border border-border shadow-sm"
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!isValid}>Add {typeLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-modal: Add Custom Column ──────────────────────────────────────

function AddColumnModal({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (col: { id: string; name: string; type: string; order: number; active: boolean; editableInWorklist: boolean; options?: string[] }) => void;
}) {
  const [name, setName] = useState('');
  const [colType, setColType] = useState('text');
  const [optionsText, setOptionsText] = useState('');
  const [editableInWorklist, setEditableInWorklist] = useState(true);

  const options = optionsText.split('\n').map(o => o.trim()).filter(Boolean);
  const isValid = name.trim().length > 0 && (colType !== 'select' || options.length > 0);

  const handleSubmit = () => {
    if (!isValid) return;
    onAdd({
      id: `col_${Date.now()}`,
      name: name.trim(),
      type: colType,
      order: 999,
      active: true,
      editableInWorklist,
      ...(colType === 'select' ? { options } : {}),
    });
    setName('');
    setColType('text');
    setOptionsText('');
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
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Column Type</Label>
            <Select value={colType} onValueChange={setColType}>
              <SelectTrigger>
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
          {colType === 'select' && (
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
              id="new-col-worklist"
              checked={editableInWorklist}
              onChange={(e) => setEditableInWorklist(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <Label htmlFor="new-col-worklist" className="text-sm">Editable in worklist</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!isValid}>Add Column</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("general");
  const [addItemModal, setAddItemModal] = useState<{ type: 'statuses' | 'jobTypes' | 'destinations' } | null>(null);
  const [addColumnModalOpen, setAddColumnModalOpen] = useState(false);

  const { data: office, isLoading } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId && open,
  });

  const updateOfficeMutation = useMutation({
    mutationFn: async (settings: any) => {
      const res = await apiRequest("PUT", `/api/offices/${user?.officeId}`, {
        settings,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId] });
      toast({
        title: "Success",
        description: "Settings saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [customStatuses, setCustomStatuses] = useState<any[]>([]);
  const [customJobTypes, setCustomJobTypes] = useState<any[]>([]);
  const [customOrderDestinations, setCustomOrderDestinations] = useState<any[]>([]);
  const [customColumns, setCustomColumns] = useState<any[]>([]);
  const [messageTemplates, setMessageTemplates] = useState<Record<string, string>>({});
  const [jobIdentifierMode, setJobIdentifierMode] = useState<"patientName" | "trayNumber">("patientName");
  const [activeId, setActiveId] = useState<string | null>(null);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Initialize state when office data loads
  useEffect(() => {
    if (office?.settings) {
      const settings = office.settings as any;
      // Initialize with defaults if no custom settings exist
      const existingStatuses = Array.isArray(settings.customStatuses) ? settings.customStatuses : [];
      const existingTypes = Array.isArray(settings.customJobTypes) ? settings.customJobTypes : [];
      const existingDestinations = Array.isArray(settings.customOrderDestinations) ? settings.customOrderDestinations : [];
      const existingColumns = Array.isArray(settings.customColumns) ? settings.customColumns : [];
      const existingTemplates =
        settings.smsTemplates && typeof settings.smsTemplates === "object" && !Array.isArray(settings.smsTemplates)
          ? settings.smsTemplates
          : {};
      
      // Normalize color fields to hex so <input type="color"> works correctly
      const normalizeItems = (items: any[]) =>
        items.map((item) => ({
          ...item,
          color: normalizeToHex(item.color, item.hsl, item.hex),
          hsl: item.hsl || (item.color && /^#/.test(item.color) ? hexToHSL(item.color) : item.hsl || ""),
        }));

      // Merge existing settings with defaults (existing settings take priority)
      const mergedStatuses = existingStatuses.length > 0
        ? normalizeItems(existingStatuses)
        : DEFAULT_STATUS_COLORS.map(def => ({
            id: def.id,
            label: def.label,
            color: def.hex,
            hsl: def.hsl,
            order: def.order
          }));

      const mergedTypes = existingTypes.length > 0
        ? normalizeItems(existingTypes)
        : DEFAULT_JOB_TYPE_COLORS.map(def => ({
            id: def.id,
            label: def.label,
            color: def.hex,
            hsl: def.hsl,
            order: def.order
          }));

      const mergedDestinations = existingDestinations.length > 0
        ? normalizeItems(existingDestinations)
        : DEFAULT_DESTINATION_COLORS.map(def => ({
            id: def.id,
            label: def.label,
            color: def.hex,
            hsl: def.hsl,
            order: def.order
          }));

      setCustomStatuses(mergedStatuses);
      setCustomJobTypes(mergedTypes);
      setCustomOrderDestinations(mergedDestinations);
      setCustomColumns(existingColumns);
      setMessageTemplates(ensureReadyForPickupTemplate(existingTemplates, mergedStatuses));
      setJobIdentifierMode(settings.jobIdentifierMode === "trayNumber" ? "trayNumber" : "patientName");
    }
  }, [office]);

  const handleSaveSettings = () => {
    // Clean up empty options from select columns before saving
    const cleanedColumns = customColumns.map((col) =>
      col.type === 'select' && col.options
        ? { ...col, options: col.options.map((o: string) => o.trim()).filter(Boolean) }
        : col,
    );

    // Validate: select columns must have at least one option
    const emptySelectCol = cleanedColumns.find(
      (col) => col.type === 'select' && (!col.options || col.options.length === 0),
    );
    if (emptySelectCol) {
      toast({
        title: "Missing options",
        description: `Select column "${emptySelectCol.name}" needs at least one option.`,
        variant: "destructive",
      });
      return;
    }

    const updatedSettings = {
      ...(office?.settings || {}),
      customStatuses,
      customJobTypes,
      customOrderDestinations,
      customColumns: cleanedColumns,
      jobIdentifierMode,
      // Desktop/offline mode: Otto Tracker does not send SMS. We keep templates as copy helpers.
      smsEnabled: false,
      smsTemplates: messageTemplates,
    };

    updateOfficeMutation.mutate(updatedSettings);
  };

  const addCustomItem = (type: 'statuses' | 'jobTypes' | 'destinations') => {
    const existingColors =
      type === 'statuses'
        ? customStatuses.map((s) => s.color)
        : type === 'jobTypes'
          ? customJobTypes.map((t) => t.color)
          : customOrderDestinations.map((d) => d.color);

    const color = chooseHighContrastColor(existingColors);

    const newItem = {
      id: `custom_${Date.now()}`,
      label: `New ${type === 'statuses' ? 'Status' : type === 'jobTypes' ? 'Type' : 'Destination'}`,
      color,
      hsl: hexToHSL(color),
      order: 999,
    };

    if (type === 'statuses') {
      setCustomStatuses([...customStatuses, newItem]);
    } else if (type === 'jobTypes') {
      setCustomJobTypes([...customJobTypes, newItem]);
    } else {
      setCustomOrderDestinations([...customOrderDestinations, newItem]);
    }
  };

  const updateCustomItem = (type: 'statuses' | 'jobTypes' | 'destinations', id: string, updates: any) => {
    // If color is being updated, also calculate and store HSL
    if (updates.color && updates.color.startsWith('#')) {
      updates.hsl = hexToHSL(updates.color);
    }
    
    if (type === 'statuses') {
      setCustomStatuses(customStatuses.map(item => 
        item.id === id ? { ...item, ...updates } : item
      ));
    } else if (type === 'jobTypes') {
      setCustomJobTypes(customJobTypes.map(item => 
        item.id === id ? { ...item, ...updates } : item
      ));
    } else {
      setCustomOrderDestinations(customOrderDestinations.map(item => 
        item.id === id ? { ...item, ...updates } : item
      ));
    }
  };

  const deleteCustomItem = (type: 'statuses' | 'jobTypes' | 'destinations', id: string) => {
    if (type === 'statuses') {
      // Don't allow deleting required statuses
      if (id === 'job_created' || id === 'completed') return;
      setCustomStatuses(customStatuses.filter(item => item.id !== id));
      setMessageTemplates((prev) => {
        if (!prev || !(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else if (type === 'jobTypes') {
      setCustomJobTypes(customJobTypes.filter(item => item.id !== id));
    } else {
      setCustomOrderDestinations(customOrderDestinations.filter(item => item.id !== id));
    }
  };

  const addCustomColumn = () => {
    const newColumn = {
      id: `col_${Date.now()}`,
      name: 'New Column',
      type: 'text',
      order: customColumns.length,
      active: true,
    };
    setCustomColumns([...customColumns, newColumn]);
  };

  const updateCustomColumn = (id: string, updates: any) => {
    setCustomColumns(customColumns.map(col => 
      col.id === id ? { ...col, ...updates } : col
    ));
  };

  const deleteCustomColumn = (id: string) => {
    setCustomColumns(customColumns.filter(col => col.id !== id));
  };

  // Drag and drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent, type: 'statuses' | 'jobTypes' | 'destinations') => {
    const { active, over } = event;
    
    setActiveId(null);

    if (!over || active.id === over.id) {
      return;
    }

    if (type === 'statuses') {
      const oldIndex = customStatuses.findIndex(item => item.id === active.id);
      const newIndex = customStatuses.findIndex(item => item.id === over.id);

      // Prevent moving job_created or completed
      if (customStatuses[oldIndex].id === 'job_created' || customStatuses[oldIndex].id === 'completed') {
        return;
      }

      // Prevent dropping on position 0 (job_created) or last position (completed)
      if (newIndex === 0 || newIndex === customStatuses.length - 1) {
        return;
      }

      const reorderedStatuses = arrayMove(customStatuses, oldIndex, newIndex);
      
      // Post-move validation: Ensure job_created is still first and completed is still last
      const jobCreatedIndex = reorderedStatuses.findIndex(s => s.id === 'job_created');
      const completedIndex = reorderedStatuses.findIndex(s => s.id === 'completed');

      if (jobCreatedIndex !== 0 || completedIndex !== reorderedStatuses.length - 1) {
        // Invalid move - don't apply
        return;
      }

      setCustomStatuses(reorderedStatuses);
    } else if (type === 'jobTypes') {
      const oldIndex = customJobTypes.findIndex(item => item.id === active.id);
      const newIndex = customJobTypes.findIndex(item => item.id === over.id);
      const reorderedTypes = arrayMove(customJobTypes, oldIndex, newIndex);
      setCustomJobTypes(reorderedTypes);
    } else if (type === 'destinations') {
      const oldIndex = customOrderDestinations.findIndex(item => item.id === active.id);
      const newIndex = customOrderDestinations.findIndex(item => item.id === over.id);
      const reorderedDestinations = arrayMove(customOrderDestinations, oldIndex, newIndex);
      setCustomOrderDestinations(reorderedDestinations);
    }
  };

  const renderCustomItemList = (
    items: any[], 
    type: 'statuses' | 'jobTypes' | 'destinations',
    title: string,
    description: string
  ) => {
    const itemIds = items.map(item => item.id);

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => setAddItemModal({ type })}
            data-testid={`button-add-${type}`}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add {type === 'statuses' ? 'Status' : type === 'jobTypes' ? 'Type' : 'Destination'}
          </Button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={(event) => handleDragEnd(event, type)}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {items.map((item) => {
                // For statuses, only middle items are draggable
                const isDraggable = type === 'statuses' 
                  ? item.id !== 'job_created' && item.id !== 'completed'
                  : true;

                return (
                  <SortableItem
                    key={item.id}
                    id={item.id}
                    item={item}
                    type={type}
                    isDraggable={isDraggable}
                    updateCustomItem={updateCustomItem}
                    deleteCustomItem={deleteCustomItem}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {type === 'statuses' && (
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-xs text-muted-foreground">
              <span className="inline-block w-2 h-2 bg-info rounded-full mr-2"></span>
              "Job Created" and "Completed" statuses cannot be moved or deleted as they are required for workflow.
            </p>
          </div>
        )}
      </div>
    );
  };

  if (!open || isLoading) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] p-0 overflow-hidden flex flex-col gap-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Settings className="h-5 w-5" />
            Office Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            <div className="border-b border-border bg-muted/20 md:border-b-0 md:border-r md:w-56 md:shrink-0">
              <TabsList className="h-auto w-full justify-start bg-transparent p-2 md:flex-col md:items-stretch md:gap-1 overflow-x-auto md:overflow-visible">
                <TabsTrigger
                  value="general"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start border-l-[3px] border-l-transparent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:border-l-primary data-[state=active]:shadow-none"
                  data-testid="tab-general"
                >
                  <Settings className="h-4 w-4" />
                  <span className="truncate">General</span>
                </TabsTrigger>
                <TabsTrigger
                  value="statuses"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start border-l-[3px] border-l-transparent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:border-l-primary data-[state=active]:shadow-none"
                  data-testid="tab-statuses"
                >
                  <ListTodo className="h-4 w-4" />
                  <span className="truncate">Job Statuses</span>
                </TabsTrigger>
                <TabsTrigger
                  value="types"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start border-l-[3px] border-l-transparent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:border-l-primary data-[state=active]:shadow-none"
                  data-testid="tab-types"
                >
                  <Tag className="h-4 w-4" />
                  <span className="truncate">Job Types</span>
                </TabsTrigger>
                <TabsTrigger
                  value="destinations"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start border-l-[3px] border-l-transparent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:border-l-primary data-[state=active]:shadow-none"
                  data-testid="tab-destinations"
                >
                  <Building className="h-4 w-4" />
                  <span className="truncate">Destinations</span>
                </TabsTrigger>
                <TabsTrigger
                  value="customColumns"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start border-l-[3px] border-l-transparent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:border-l-primary data-[state=active]:shadow-none"
                  data-testid="tab-custom-columns"
                >
                  <Columns className="h-4 w-4" />
                  <span className="truncate">Custom Columns</span>
                </TabsTrigger>
                <TabsTrigger
                  value="notifications"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start border-l-[3px] border-l-transparent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:border-l-primary data-[state=active]:shadow-none"
                  data-testid="tab-notifications"
                >
                  <Bell className="h-4 w-4" />
                  <span className="truncate">Overdue Rules</span>
                </TabsTrigger>
                <TabsTrigger
                  value="messages"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start border-l-[3px] border-l-transparent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:border-l-primary data-[state=active]:shadow-none"
                  data-testid="tab-messages"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="truncate">Messages</span>
                </TabsTrigger>
                <TabsTrigger
                  value="tablet"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start border-l-[3px] border-l-transparent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:border-l-primary data-[state=active]:shadow-none"
                  data-testid="tab-tablet"
                >
                  <Tablet className="h-4 w-4" />
                  <span className="truncate">Tablet</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-w-0 min-h-0">
              <div className="h-full overflow-y-auto px-5 py-4">
                <TabsContent value="general" className="mt-0">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">General Settings</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Configure how jobs are identified and displayed in your practice.
                  </p>
                </div>

                <div className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">Job Identifier Mode</Label>
                      <p className="text-xs text-muted-foreground">
                        Choose how jobs are identified in your practice.
                      </p>
                    </div>
                    <Select 
                      value={jobIdentifierMode} 
                      onValueChange={(value: "patientName" | "trayNumber") => setJobIdentifierMode(value)}
                    >
                      <SelectTrigger className="w-48" data-testid="select-identifier-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="patientName">Patient Name</SelectItem>
                        <SelectItem value="trayNumber">Tray Number</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="mt-3 p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">
                      {jobIdentifierMode === "patientName" 
                        ? "Jobs will be identified by patient first and last name (e.g., \"Jane Smith\")."
                        : "Jobs will be identified by a manually-entered tray number. Patient name fields will not be required."}
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="statuses" className="mt-0">
              {renderCustomItemList(
                customStatuses,
                'statuses',
                'Custom Job Statuses',
                'Customize the workflow stages for your jobs. Drag to reorder.'
              )}
            </TabsContent>

            <TabsContent value="types" className="mt-0">
              {renderCustomItemList(
                customJobTypes,
                'jobTypes',
                'Custom Job Types',
                'Define the types of jobs your practice handles.'
              )}
            </TabsContent>

            <TabsContent value="destinations" className="mt-0">
              {renderCustomItemList(
                customOrderDestinations,
                'destinations',
                'Order Destinations',
                'Manage the labs and vendors you work with.'
              )}
            </TabsContent>

            <TabsContent value="customColumns" className="mt-0">
              <div className="space-y-4">
                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">Custom Columns</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create custom columns to track additional information for your jobs.
                  </p>
                  <Button
                    onClick={() => setAddColumnModalOpen(true)}
                    data-testid="button-add-custom-column"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Column
                  </Button>
                </div>

                <div className="space-y-3">
                  {customColumns.map((column) => (
                    <div key={column.id}>
                    <div
                      className="flex items-center gap-3 p-4 bg-card border border-border rounded-lg hover:shadow-soft transition-shadow"
                      data-testid={`custom-column-${column.id}`}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                      
                      <div className="flex-1 grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor={`column-name-${column.id}`} className="text-xs text-muted-foreground mb-1">
                            Column Name
                          </Label>
                          <Input
                            id={`column-name-${column.id}`}
                            value={column.name}
                            onChange={(e) => updateCustomColumn(column.id, { name: e.target.value })}
                            className="font-medium"
                            data-testid={`input-column-name-${column.id}`}
                          />
                        </div>

                        <div>
                          <Label htmlFor={`column-type-${column.id}`} className="text-xs text-muted-foreground mb-1">
                            Column Type
                          </Label>
                          <Select
                            value={column.type}
                            onValueChange={(value) => updateCustomColumn(column.id, { type: value })}
                          >
                            <SelectTrigger 
                              id={`column-type-${column.id}`}
                              data-testid={`select-column-type-${column.id}`}
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

                      <div className="flex flex-col gap-1.5 text-[11px] text-muted-foreground shrink-0">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={column.editableInWorklist !== false}
                            onChange={(e) => updateCustomColumn(column.id, { editableInWorklist: e.target.checked })}
                            className="h-3.5 w-3.5 rounded border-input accent-primary"
                          />
                          Worklist edit
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={column.active}
                            onChange={(e) => updateCustomColumn(column.id, { active: e.target.checked })}
                            className="h-3.5 w-3.5 rounded border-input accent-primary"
                            data-testid={`switch-column-active-${column.id}`}
                          />
                          Active
                        </label>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteCustomColumn(column.id)}
                        data-testid={`button-delete-column-${column.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Select type: options editor */}
                    {column.type === 'select' && (
                      <div className="ml-8 mt-2 mb-2 p-3 bg-muted/50 rounded-md border border-border">
                        <Label className="text-xs text-muted-foreground mb-2 block">Options (one per line)</Label>
                        <textarea
                          className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          value={(column.options || []).join('\n')}
                          onChange={(e) => {
                            // Preserve all lines including empty ones during editing
                            // so Enter key works naturally — empty lines are cleaned on save
                            const options = e.target.value.split('\n');
                            updateCustomColumn(column.id, { options });
                          }}
                          placeholder={"Option 1\nOption 2\nOption 3"}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Users will pick from these options when setting this field.
                        </p>
                      </div>
                    )}
                    </div>
                  ))}
                </div>

                {customColumns.length === 0 && (
                  <div className="p-8 text-center bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      No custom columns yet. Click "Add Column" to create your first custom column.
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="notifications" className="mt-0">
              <NotificationRules />
            </TabsContent>

            <TabsContent value="tablet" className="mt-0">
              <TabletSettingsContent />
            </TabsContent>

            <TabsContent value="messages" className="mt-0">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Message Templates</h3>
                  <p className="text-sm text-muted-foreground">
                    Otto Tracker doesn’t send texts. Use these templates to copy/paste into your office’s texting system.
                    Templates are configured per Job Status, so any custom statuses you add are supported automatically.
                  </p>
                </div>

                <div className="p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">Available variables</h4>
                  <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                    <p><code>{"{patient_first_name}"}</code> - Patient first name</p>
                    <p><code>{"{patient_last_name}"}</code> - Patient last name</p>
                    <p><code>{"{patient_name}"}</code> - Patient full name</p>
                    <p><code>{"{order_id}"}</code> - Order ID</p>
                    <p><code>{"{job_type}"}</code> - Job type label (supports custom types)</p>
                    <p><code>{"{status}"}</code> - Status label (supports custom statuses)</p>
                    <p><code>{"{destination}"}</code> - Destination label (supports custom destinations)</p>
                    <p><code>{"{office_name}"}</code> - Practice name</p>
                    <p><code>{"{office_phone}"}</code> - Practice phone</p>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Tip: You can preview and copy the final message from any job in the Worklist.
                  </p>
                </div>

                <div className="space-y-4">
                  {customStatuses.map((status) => {
                    const colorValue = status?.hsl || status?.color || status?.hex || "";
                    const badgeColors = getColorForBadge(colorValue);
                    return (
                      <div
                        key={status.id}
                        className="p-4 bg-card border border-border rounded-lg space-y-3"
                        data-testid={`message-template-card-${status.id}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge
                              className="shrink-0"
                              style={{ backgroundColor: badgeColors.background, color: badgeColors.text }}
                            >
                              {status.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground truncate">
                              Shown when a job is <span className="font-medium">{status.label}</span>
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setMessageTemplates((prev) => {
                                if (!prev || !(status.id in prev)) return prev;
                                const next = { ...prev };
                                delete next[status.id];
                                return next;
                              })
                            }
                            disabled={!messageTemplates?.[status.id]?.trim()}
                            data-testid={`button-clear-message-template-${status.id}`}
                          >
                            Clear
                          </Button>
                        </div>

                        <div>
                          <Label htmlFor={`message-template-${status.id}`} className="sr-only">
                            {status.label} template
                          </Label>
                          <Textarea
                            id={`message-template-${status.id}`}
                            value={messageTemplates?.[status.id] || ""}
                            onChange={(e) =>
                              setMessageTemplates({
                                ...messageTemplates,
                                [status.id]: e.target.value,
                              })
                            }
                            placeholder={`Optional: message for "${status.label}"`}
                            rows={3}
                            data-testid={`textarea-message-template-${status.id}`}
                          />
                          <p className="mt-2 text-xs text-muted-foreground">
                            Leave blank to hide this message.
                          </p>
                        </div>
                      </div>
                    );
                  })}

                  {customStatuses.length === 0 && (
                    <div className="p-8 text-center bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">
                        No job statuses found. Create a status first to configure message templates.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 border-t border-border px-6 py-4">
            <Button
              onClick={handleSaveSettings}
              className="flex-1"
              disabled={updateOfficeMutation.isPending}
              data-testid="button-save-settings"
            >
              {updateOfficeMutation.isPending ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-primary" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-settings">
              Cancel
            </Button>
          </div>
        </Tabs>
      </DialogContent>

      {/* Sub-modals for adding items */}
      <AddItemModal
        open={!!addItemModal}
        onOpenChange={(open) => !open && setAddItemModal(null)}
        type={addItemModal?.type || 'statuses'}
        existingColors={
          addItemModal?.type === 'statuses'
            ? customStatuses.map(s => s.color)
            : addItemModal?.type === 'jobTypes'
              ? customJobTypes.map(t => t.color)
              : customOrderDestinations.map(d => d.color)
        }
        onAdd={(item) => {
          if (addItemModal?.type === 'statuses') {
            setCustomStatuses([...customStatuses, item]);
          } else if (addItemModal?.type === 'jobTypes') {
            setCustomJobTypes([...customJobTypes, item]);
          } else {
            setCustomOrderDestinations([...customOrderDestinations, item]);
          }
        }}
      />

      <AddColumnModal
        open={addColumnModalOpen}
        onOpenChange={setAddColumnModalOpen}
        onAdd={(col) => setCustomColumns([...customColumns, col])}
      />
    </Dialog>
  );
}
