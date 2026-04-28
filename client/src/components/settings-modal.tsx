import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Settings,
  ListTodo,
  Tag,
  Bell,
  Building,
  Save,
  Columns,
  RefreshCw,
  Copy,
  Check,
  Tablet,
} from "lucide-react";
import NotificationRules from "./notification-rules";
import { DEFAULT_STATUS_COLORS, DEFAULT_JOB_TYPE_COLORS, DEFAULT_DESTINATION_COLORS, hexToHSL, normalizeToHex } from "@/lib/default-colors";
import SortableListEditor, { type CustomListItem } from "./customization/sortable-list-editor";
import CustomColumnsEditor, { type CustomColumn, cleanColumnsForSave } from "./customization/custom-columns-editor";
import IdentifierModeEditor, { type JobIdentifierMode } from "./customization/identifier-mode-editor";
import SetupWizardCard from "./setup-wizard-card";
import type { Office } from "@shared/schema";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/tablet/api/qr-setup")
      .then((r) => r.json())
      .then((data) => { setTabletUrl(data.url); setQrSvg(data.svg); })
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
    <div className="space-y-5">
      <div>
        <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
          Tablet Lab Board
        </h3>
        <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-1">
          Set up a tablet in your lab for technicians to view and manage jobs.
          Scan the QR code with the tablet's camera to open the board instantly.
        </p>
      </div>

      <div className="bg-panel border border-line rounded-lg p-5 space-y-5">
        {/* QR Code */}
        <div className="flex flex-col items-center gap-3">
          {qrSvg ? (
            <div
              className="bg-white p-3 rounded-lg border border-line"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : (
            <div className="w-[200px] h-[200px] bg-paper-2 rounded-lg animate-pulse" />
          )}
          <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute text-center">
            Point the tablet's camera at this code
          </p>
        </div>

        {/* URL + Copy */}
        <div>
          <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
            Or open this URL manually
          </Label>
          <div className="flex items-center gap-2 mt-1.5">
            <code className="flex-1 bg-paper-2 px-3 py-2 rounded-md text-[calc(12.5px*var(--ui-scale))] font-mono text-ink-2 break-all">
              {tabletUrl || "Loading..."}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={!tabletUrl}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute mt-1.5">
            The tablet must be on the same Wi-Fi network as this computer.
          </p>
        </div>

        {/* Setup steps */}
        <div>
          <Label className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
            Setup Instructions
          </Label>
          <ol className="mt-1.5 text-[calc(13px*var(--ui-scale))] text-ink-2 space-y-1 list-decimal list-inside">
            <li>Scan the QR code above with the tablet's camera</li>
            <li>Tap the link that appears to open the board</li>
            <li>Tap the browser menu and select "Add to Home Screen"</li>
            <li>Select your name and enter your PIN to sign in</li>
          </ol>
        </div>
      </div>

      <div className="bg-panel border border-line rounded-lg p-4">
        <h4 className="text-[calc(11px*var(--ui-scale))] font-semibold uppercase tracking-wider text-ink-mute">
          Connected Tablets
        </h4>
        {sessions.length === 0 ? (
          <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-3">No tablets currently connected.</p>
        ) : (
          <div className="mt-2">
            {sessions.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-line-2 last:border-0">
                <span className="text-[calc(13px*var(--ui-scale))] font-medium text-ink">{s.firstName} {s.lastName}</span>
                <span className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute tabular-nums">
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

  const [customStatuses, setCustomStatuses] = useState<CustomListItem[]>([]);
  const [customJobTypes, setCustomJobTypes] = useState<CustomListItem[]>([]);
  const [customOrderDestinations, setCustomOrderDestinations] = useState<CustomListItem[]>([]);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  const [jobIdentifierMode, setJobIdentifierMode] = useState<JobIdentifierMode>("patientName");

  // Initialize state when office data loads
  useEffect(() => {
    if (office?.settings) {
      const settings = office.settings as any;
      // Initialize with defaults if no custom settings exist
      const existingStatuses = Array.isArray(settings.customStatuses) ? settings.customStatuses : [];
      const existingTypes = Array.isArray(settings.customJobTypes) ? settings.customJobTypes : [];
      const existingDestinations = Array.isArray(settings.customOrderDestinations) ? settings.customOrderDestinations : [];
      const existingColumns = Array.isArray(settings.customColumns) ? settings.customColumns : [];

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
      setJobIdentifierMode(settings.jobIdentifierMode === "trayNumber" ? "trayNumber" : "patientName");
    }
  }, [office]);

  const handleSaveSettings = () => {
    const { cleaned: cleanedColumns, invalidColumn } = cleanColumnsForSave(customColumns);
    if (invalidColumn) {
      toast({
        title: "Missing options",
        description: `Select column "${invalidColumn.name}" needs at least one option.`,
        variant: "destructive",
      });
      return;
    }

    const updatedSettings = {
      customStatuses,
      customJobTypes,
      customOrderDestinations,
      customColumns: cleanedColumns,
      jobIdentifierMode,
    };

    updateOfficeMutation.mutate(updatedSettings);
  };

  if (!open || isLoading) return null;

  // Shared trigger styling — every nav tab in the side rail uses the same
  // utility chain so the active-state treatment, padding, and density-scaled
  // font stay in lockstep with the rest of the modal chrome.
  const tabTriggerClass = "shrink-0 justify-start gap-2 md:w-full md:justify-start h-9 px-3 rounded-md text-[calc(13px*var(--ui-scale))] font-medium text-ink-mute hover:text-ink hover:bg-paper-2 border-l-[3px] border-l-transparent data-[state=active]:bg-otto-accent-soft data-[state=active]:text-otto-accent-ink data-[state=active]:border-l-otto-accent data-[state=active]:shadow-none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] p-0 overflow-hidden flex flex-col gap-0">
        <DialogHeader className="border-b border-line px-6 py-[18px]">
          <DialogTitle asChild>
            <div className="flex items-center gap-2.5 m-0">
              <Settings className="h-[18px] w-[18px] text-ink-mute" />
              <h3 className="font-display text-[calc(20px*var(--ui-scale))] font-medium tracking-[-0.025em] text-ink m-0">
                Office Settings
              </h3>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            <div className="border-b border-line bg-paper md:border-b-0 md:border-r md:w-56 md:shrink-0">
              <TabsList className="h-auto w-full justify-start bg-transparent p-2 md:flex-col md:items-stretch md:gap-0.5 overflow-x-auto md:overflow-visible">
                <TabsTrigger value="general" className={tabTriggerClass} data-testid="tab-general">
                  <Settings className="h-4 w-4" />
                  <span className="truncate">General</span>
                </TabsTrigger>
                <TabsTrigger value="statuses" className={tabTriggerClass} data-testid="tab-statuses">
                  <ListTodo className="h-4 w-4" />
                  <span className="truncate">Job Statuses</span>
                </TabsTrigger>
                <TabsTrigger value="types" className={tabTriggerClass} data-testid="tab-types">
                  <Tag className="h-4 w-4" />
                  <span className="truncate">Job Types</span>
                </TabsTrigger>
                <TabsTrigger value="destinations" className={tabTriggerClass} data-testid="tab-destinations">
                  <Building className="h-4 w-4" />
                  <span className="truncate">Labs</span>
                </TabsTrigger>
                <TabsTrigger value="customColumns" className={tabTriggerClass} data-testid="tab-custom-columns">
                  <Columns className="h-4 w-4" />
                  <span className="truncate">Custom Columns</span>
                </TabsTrigger>
                <TabsTrigger value="notifications" className={tabTriggerClass} data-testid="tab-notifications">
                  <Bell className="h-4 w-4" />
                  <span className="truncate">Overdue Rules</span>
                </TabsTrigger>
                <TabsTrigger value="tablet" className={tabTriggerClass} data-testid="tab-tablet">
                  <Tablet className="h-4 w-4" />
                  <span className="truncate">Tablet</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-w-0 min-h-0">
              <div className="h-full overflow-y-auto px-6 py-5">
                <TabsContent value="general" className="mt-0">
                  <div className="space-y-5">
                    <SetupWizardCard onNavigate={() => onOpenChange(false)} />
                    <div>
                      <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
                        General
                      </h3>
                      <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-1">
                        Configure how jobs are identified and displayed in your practice.
                      </p>
                    </div>
                    <IdentifierModeEditor value={jobIdentifierMode} onChange={setJobIdentifierMode} />
                  </div>
                </TabsContent>

                <TabsContent value="statuses" className="mt-0">
                  <SortableListEditor
                    items={customStatuses}
                    onChange={setCustomStatuses}
                    type="statuses"
                    title="Job Statuses"
                    description="Customize the workflow stages for your jobs. Drag to reorder."
                  />
                </TabsContent>

                <TabsContent value="types" className="mt-0">
                  <SortableListEditor
                    items={customJobTypes}
                    onChange={setCustomJobTypes}
                    type="jobTypes"
                    title="Job Types"
                    description="Define the types of jobs your practice handles."
                  />
                </TabsContent>

                <TabsContent value="destinations" className="mt-0">
                  <SortableListEditor
                    items={customOrderDestinations}
                    onChange={setCustomOrderDestinations}
                    type="destinations"
                    title="Labs"
                    description="Manage the labs and vendors you work with."
                  />
                </TabsContent>

                <TabsContent value="customColumns" className="mt-0">
                  <CustomColumnsEditor columns={customColumns} onChange={setCustomColumns} />
                </TabsContent>

                <TabsContent value="notifications" className="mt-0">
                  <NotificationRules />
                </TabsContent>

                <TabsContent value="tablet" className="mt-0">
                  <TabletSettingsContent />
                </TabsContent>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 border-t border-line bg-panel-2 px-6 py-3.5">
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

      {/* Add-item dialogs are embedded inside SortableListEditor and CustomColumnsEditor. */}
    </Dialog>
  );
}
