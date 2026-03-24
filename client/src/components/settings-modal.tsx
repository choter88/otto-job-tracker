import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  Check
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
      className={`flex items-center gap-3 p-4 bg-card border border-border rounded-lg hover:shadow-soft transition-shadow ${
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

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Color:</span>
        <Input
          type="color"
          value={item.color}
          onChange={(e) => updateCustomItem(type, item.id, { color: e.target.value })}
          className="w-10 h-10 rounded cursor-pointer border border-border"
          data-testid={`input-color-${item.id}`}
        />
      </div>

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

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("general");

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
    const updatedSettings = {
      ...(office?.settings || {}),
      customStatuses,
      customJobTypes,
      customOrderDestinations,
      customColumns,
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
      <div className="space-y-4">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground mb-4">{description}</p>
          <Button
            onClick={() => addCustomItem(type)}
            data-testid={`button-add-${type}`}
          >
            <Plus className="mr-2 h-4 w-4" />
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
            <div className="space-y-3">
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
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
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
      <DialogContent className="w-[min(96vw,1100px)] max-w-none h-[min(90vh,820px)] p-0 overflow-hidden flex flex-col animate-fade-in">
        <DialogHeader className="border-b border-border px-6 py-5 pr-12">
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Settings className="h-6 w-6" />
            Office Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            <div className="border-b border-border bg-muted/20 md:border-b-0 md:border-r md:w-56 md:shrink-0">
              <TabsList className="h-auto w-full justify-start bg-transparent p-2 md:flex-col md:items-stretch md:gap-1 overflow-x-auto md:overflow-visible">
                <TabsTrigger
                  value="general"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start"
                  data-testid="tab-general"
                >
                  <Settings className="h-4 w-4" />
                  <span className="truncate">General</span>
                </TabsTrigger>
                <TabsTrigger
                  value="statuses"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start"
                  data-testid="tab-statuses"
                >
                  <ListTodo className="h-4 w-4" />
                  <span className="truncate">Job Statuses</span>
                </TabsTrigger>
                <TabsTrigger
                  value="types"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start"
                  data-testid="tab-types"
                >
                  <Tag className="h-4 w-4" />
                  <span className="truncate">Job Types</span>
                </TabsTrigger>
                <TabsTrigger
                  value="destinations"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start"
                  data-testid="tab-destinations"
                >
                  <Building className="h-4 w-4" />
                  <span className="truncate">Destinations</span>
                </TabsTrigger>
                <TabsTrigger
                  value="customColumns"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start"
                  data-testid="tab-custom-columns"
                >
                  <Columns className="h-4 w-4" />
                  <span className="truncate">Custom Columns</span>
                </TabsTrigger>
                <TabsTrigger
                  value="notifications"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start"
                  data-testid="tab-notifications"
                >
                  <Bell className="h-4 w-4" />
                  <span className="truncate">Notifications</span>
                </TabsTrigger>
                <TabsTrigger
                  value="messages"
                  className="shrink-0 justify-start gap-2 md:w-full md:justify-start"
                  data-testid="tab-messages"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="truncate">Messages</span>
                </TabsTrigger>
                {user?.role === "owner" && (
                  <TabsTrigger
                    value="inviteCode"
                    className="shrink-0 justify-start gap-2 md:w-full md:justify-start"
                    data-testid="tab-invite-code"
                  >
                    <KeyRound className="h-4 w-4" />
                    <span className="truncate">Invite Code</span>
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <div className="flex-1 min-w-0 min-h-0">
              <div className="h-full overflow-y-auto px-6 py-6">
                <TabsContent value="general" className="mt-0">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-2">General Settings</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    Configure how jobs are identified and displayed in your practice.
                  </p>
                </div>

                <div className="bg-card border border-border rounded-lg p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <Label className="text-base font-medium">Job Identifier Mode</Label>
                      <p className="text-sm text-muted-foreground">
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
                  <div className="mt-4 p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
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
                    onClick={addCustomColumn}
                    data-testid="button-add-custom-column"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Column
                  </Button>
                </div>

                <div className="space-y-3">
                  {customColumns.map((column) => (
                    <div
                      key={column.id}
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
                              <SelectItem value="checkbox">Checkbox</SelectItem>
                              <SelectItem value="date">Date</SelectItem>
                              <SelectItem value="number">Number</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`column-active-${column.id}`} className="text-sm text-muted-foreground">
                            Active
                          </Label>
                          <Switch
                            id={`column-active-${column.id}`}
                            checked={column.active}
                            onCheckedChange={(checked) => updateCustomColumn(column.id, { active: checked })}
                            data-testid={`switch-column-active-${column.id}`}
                          />
                        </div>
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

            {user?.role === "owner" && (
              <TabsContent value="inviteCode" className="mt-0">
                <InviteCodeSection />
              </TabsContent>
            )}

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
    </Dialog>
  );
}
