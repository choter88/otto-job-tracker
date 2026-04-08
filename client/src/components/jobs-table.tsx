import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Search, Plus, Upload, MessageSquare, ChevronUp, ChevronDown, Star, EllipsisVertical, Briefcase, Columns3, CheckSquare, Link2, X, Type, Hash, CalendarDays, List } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import JobDialog from "./job-dialog";
import JobMessageTemplatesModal from "./job-message-templates-modal";
import JobDetailsModal, { type JobDetailsTab } from "./job-details-modal";
import ImportWizard from "./import-wizard";
import type { Job, Office } from "@shared/schema";
import { format } from "date-fns";
import { getStatusBadgeStyle, getTypeBadgeStyle, getDestinationBadgeStyle } from "@/lib/default-colors";
import { cn } from "@/lib/utils";
import { formatPatientDisplayName } from "@shared/name-format";
import { renderMessageTemplate } from "@/lib/message-templates";
import { ensureReadyForPickupTemplate } from "@shared/message-template-defaults";

interface JobsTableProps {
  jobs: Job[];
  loading?: boolean;
}

interface OpenJobEventDetail {
  jobId?: string;
  panel?: JobDetailsTab | "history";
}

function getLabelFromSettings(list: any[], value: string): string {
  if (!value) return "";
  if (!Array.isArray(list) || list.length === 0) return value;

  const byId = list.find((item) => item?.id === value);
  if (byId?.label) return String(byId.label);

  const byLabel = list.find((item) => String(item?.label || "").toLowerCase() === value.toLowerCase());
  if (byLabel?.label) return String(byLabel.label);

  return value;
}

const COLUMN_TYPE_ICON = {
  text: Type,
  number: Hash,
  date: CalendarDays,
  select: List,
} as const;

const COLUMN_TYPE_PLACEHOLDER: Record<string, string> = {
  text: "Add text...",
  number: "0",
  date: "Select date...",
  select: "Select...",
};

/** Popover-based editable cell for text, number, date, and select custom columns */
function EditableCell({
  jobId, columnId, columnType, value, onSave, options,
}: {
  jobId: string;
  columnId: string;
  columnType: string;
  value: any;
  onSave: (jobId: string, columnId: string, newValue: any) => void;
  options?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  const inputType = columnType === "number" ? "number" : columnType === "date" ? "date" : "text";
  const Icon = COLUMN_TYPE_ICON[columnType as keyof typeof COLUMN_TYPE_ICON] || Type;
  const placeholder = COLUMN_TYPE_PLACEHOLDER[columnType] || "Add text...";

  const save = () => {
    const trimmed = draft.trim();
    const newValue = columnType === "number" && trimmed ? Number(trimmed) : trimmed || null;
    if (newValue !== (value ?? null)) {
      onSave(jobId, columnId, newValue);
    }
    setOpen(false);
  };

  const hasValue = value !== null && value !== undefined && value !== "";
  const display = columnType === "date" && hasValue
    ? (() => { try { return format(new Date(value), "MMM d, yyyy"); } catch { return String(value); } })()
    : hasValue ? String(value) : "";

  // Select type: use a native Select dropdown instead of popover
  if (columnType === "select" && options && options.length > 0) {
    return (
      <Select
        value={String(value ?? "")}
        onValueChange={(newValue) => {
          if (newValue !== (value ?? "")) {
            onSave(jobId, columnId, newValue || null);
          }
        }}
      >
        <SelectTrigger
          className="w-auto border-none p-0 h-auto min-h-0 focus:ring-0 focus:ring-offset-0 shadow-none"
          onClick={(e) => e.stopPropagation()}
        >
          <span className={cn("text-sm truncate", hasValue ? "text-foreground" : "text-muted-foreground/60")}>
            {display || placeholder}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">
            <span className="text-muted-foreground">(none)</span>
          </SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => {
      if (next) setDraft(String(value ?? ""));
      if (!next && open) save();
      setOpen(next);
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 w-full rounded px-1.5 py-0.5 text-left text-sm transition-colors",
            "border border-transparent hover:border-border hover:bg-muted/50",
            hasValue ? "text-foreground" : "text-muted-foreground/60",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon className="h-3 w-3 shrink-0 text-muted-foreground/40" />
          <span className="truncate">{display || placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-48 p-2"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          ref={inputRef}
          type={inputType}
          defaultValue={value ?? ""}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") { e.preventDefault(); setDraft(String(value ?? "")); setOpen(false); }
          }}
          className="h-8 text-sm"
        />
      </PopoverContent>
    </Popover>
  );
}

export default function JobsTable({ jobs, loading }: JobsTableProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [customColumnFilters, setCustomColumnFilters] = useState<Record<string, any>>({});
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => {
    try {
      const stored = window.localStorage.getItem("otto.worklist.columnVisibility");
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | undefined>();
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false);
  const [jobDetailsTab, setJobDetailsTab] = useState<JobDetailsTab>("overview");
  const [selectedDetailsJobId, setSelectedDetailsJobId] = useState<string | null>(null);
  const [messageTemplatesOpen, setMessageTemplatesOpen] = useState(false);
  const [selectedMessagesJobId, setSelectedMessagesJobId] = useState<string | null>(null);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);

  // Column visibility persistence
  useEffect(() => {
    try {
      window.localStorage.setItem("otto.worklist.columnVisibility", JSON.stringify(columnVisibility));
    } catch {}
  }, [columnVisibility]);

  const isColumnVisible = useCallback((key: string) => columnVisibility[key] !== false, [columnVisibility]);

  const toggleColumnVisibility = useCallback((key: string) => {
    setColumnVisibility((prev) => ({ ...prev, [key]: prev[key] === false }));
  }, []);

  const selectedJobForDetails = useMemo(
    () => jobs.find((job) => job.id === selectedDetailsJobId),
    [jobs, selectedDetailsJobId],
  );
  const selectedJobForMessages = useMemo(
    () => jobs.find((job) => job.id === selectedMessagesJobId),
    [jobs, selectedMessagesJobId],
  );

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const { data: unreadCommentJobIds = [] } = useQuery<string[]>({
    queryKey: ["/api/jobs/unread-comments"],
    enabled: !!user?.id,
  });

  const { data: commentCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/jobs/comment-counts"],
    enabled: !!user?.officeId,
  });

  const { data: notificationRules = [] } = useQuery<any[]>({
    queryKey: ["/api/notification-rules"],
    enabled: !!user?.officeId,
  });

  const { data: flaggedJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs/flagged"],
    enabled: !!user?.id,
  });

  const { data: overdueJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs/overdue"],
    enabled: !!user?.officeId,
  });

  const { data: linkedGroups = {} } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/jobs/linked-ids"],
    enabled: !!user?.officeId,
  });

  const flaggedJobIds = useMemo(() => flaggedJobs.map((job: any) => job.id), [flaggedJobs]);
  const overdueJobIds = useMemo(() => new Set(overdueJobs.map((job: any) => job.id)), [overdueJobs]);

  // Build a set of manually-linked job IDs for quick lookup
  const linkedJobIds = useMemo(() => {
    const set = new Set<string>();
    for (const group of Object.values(linkedGroups)) {
      if (group.length >= 2) {
        for (const id of group) set.add(id);
      }
    }
    return set;
  }, [linkedGroups]);

  const updateJobMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Job> }) => {
      const res = await apiRequest("PUT", `/api/jobs/${id}`, updates);
      return res.json();
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/jobs"] });
      
      const previousJobs = queryClient.getQueryData(["/api/jobs"]);
      
      queryClient.setQueryData(["/api/jobs"], (old: Job[] | undefined) => 
        old ? old.map(job => job.id === id ? { ...job, ...updates } : job) : []
      );
      
      return { previousJobs };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/jobs"], context?.previousJobs);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Job updated successfully.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/archived"] });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/jobs/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["/api/jobs"] });
      
      const previousJobs = queryClient.getQueryData(["/api/jobs"]);
      
      queryClient.setQueryData(["/api/jobs"], (old: Job[] | undefined) => 
        old ? old.filter(job => job.id !== id) : []
      );
      
      return { previousJobs };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/jobs"], context?.previousJobs);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Job deleted successfully.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ jobIds, updates }: { jobIds: string[]; updates: Partial<Job> }) => {
      const res = await apiRequest("POST", "/api/jobs/bulk-update", { jobIds, updates });
      return res.json();
    },
    onSuccess: (result) => {
      setSelectedJobs([]);
      setSelectionMode(false);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/overdue"] });
      toast({
        title: "Bulk Update",
        description: `Updated ${result.updated} job${result.updated !== 1 ? "s" : ""}${result.archived > 0 ? ` (${result.archived} archived)` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (jobIds: string[]) => {
      const res = await apiRequest("POST", "/api/jobs/bulk-delete", { jobIds });
      return res.json();
    },
    onSuccess: (result) => {
      setSelectedJobs([]);
      setSelectionMode(false);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: "Bulk Delete",
        description: `Deleted ${result.deleted} job${result.deleted !== 1 ? "s" : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const linkJobsMutation = useMutation({
    mutationFn: async (jobIds: string[]) => {
      const res = await apiRequest("POST", "/api/jobs/link", { jobIds });
      return res.json();
    },
    onSuccess: () => {
      setSelectedJobs([]);
      setSelectionMode(false);
      setLinkMode(false);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/linked-ids"] });
      toast({ title: "Jobs linked", description: "Selected jobs are now linked together." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const [flagDialogJobId, setFlagDialogJobId] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState("");

  const flagJobMutation = useMutation({
    mutationFn: async ({ jobId, note }: { jobId: string; note: string }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/flag`, { importantNote: note });
      return res.json();
    },
    onMutate: async ({ jobId }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/jobs/flagged"] });

      const previousFlagged = queryClient.getQueryData(["/api/jobs/flagged"]);

      const jobToAdd = jobs.find(j => j.id === jobId);
      if (jobToAdd) {
        queryClient.setQueryData(["/api/jobs/flagged"], (old: any[] | undefined) => 
          old ? [...old, jobToAdd] : [jobToAdd]
        );
      }
      
      return { previousFlagged };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/jobs/flagged"], context?.previousFlagged);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      setFlagDialogJobId(null);
      setFlagNote("");
      toast({
        title: "Marked as important",
        description: "Job flagged with your note.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flagged"] });
    },
  });

  const unflagJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/jobs/${jobId}/flag`);
    },
    onMutate: async (jobId) => {
      await queryClient.cancelQueries({ queryKey: ["/api/jobs/flagged"] });
      
      const previousFlagged = queryClient.getQueryData(["/api/jobs/flagged"]);
      
      queryClient.setQueryData(["/api/jobs/flagged"], (old: any[] | undefined) => 
        old ? old.filter((job: any) => job.id !== jobId) : []
      );
      
      return { previousFlagged };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/jobs/flagged"], context?.previousFlagged);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Job unflagged.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/flagged"] });
    },
  });

  // Memoize custom arrays from office settings
  const customStatuses = useMemo(() => office?.settings?.customStatuses || [], [office?.settings?.customStatuses]);
  const customJobTypes = useMemo(() => office?.settings?.customJobTypes || [], [office?.settings?.customJobTypes]);
  const customOrderDestinations = useMemo(() => office?.settings?.customOrderDestinations || [], [office?.settings?.customOrderDestinations]);
  const customColumns = useMemo(() => (office?.settings?.customColumns || []).filter((col: any) => col.active), [office?.settings?.customColumns]);
  
  // Get identifier mode from office settings
  const jobIdentifierMode = useMemo(() => office?.settings?.jobIdentifierMode || "patientName", [office?.settings?.jobIdentifierMode]);
  const useTrayNumber = jobIdentifierMode === "trayNumber";

  // Memoize filtered and sorted jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      // Search by tray number or patient name based on identifier mode
      const matchesSearch = searchQuery === "" || 
        (useTrayNumber 
          ? (job.trayNumber || "").toLowerCase().includes(searchQuery.toLowerCase())
          : `${job.patientFirstName} ${job.patientLastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
            job.patientLastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            job.patientFirstName.toLowerCase().includes(searchQuery.toLowerCase())
        );
      
      const matchesStatus = statusFilter === "all" || job.status === statusFilter;
      const matchesType = typeFilter === "all" || job.jobType === typeFilter;
      const matchesDestination = destinationFilter === "all" || job.orderDestination === destinationFilter;
      
      // Custom column filters
      const matchesCustomColumns = Object.entries(customColumnFilters).every(([columnId, filterValue]) => {
        if (filterValue === null || filterValue === undefined) return true;
        const jobValue = (job.customColumnValues as Record<string, any>)?.[columnId];
        
        // For checkbox filters with "show unchecked only" option
        if (filterValue === "unchecked") {
          return !jobValue;
        }
        
        return true;
      });
      
      return matchesSearch && matchesStatus && matchesType && matchesDestination && matchesCustomColumns;
    }).sort((a, b) => {
      // Check if sorting by custom column
      if (sortBy.startsWith('custom-')) {
        const columnId = sortBy.replace('custom-', '');
        const column = customColumns.find((col: any) => col.id === columnId);
        let aValue = (a.customColumnValues as Record<string, any>)?.[columnId];
        let bValue = (b.customColumnValues as Record<string, any>)?.[columnId];
        
        // Normalize values based on column type
        if (column?.type === 'number') {
          aValue = aValue != null ? Number(aValue) : -Infinity;
          bValue = bValue != null ? Number(bValue) : -Infinity;
        } else if (column?.type === 'date') {
          aValue = aValue ? new Date(aValue).getTime() : -Infinity;
          bValue = bValue ? new Date(bValue).getTime() : -Infinity;
        } else if (column?.type === 'checkbox') {
          aValue = aValue ? 1 : 0;
          bValue = bValue ? 1 : 0;
        } else {
          // Text type - keep as string, handle null/undefined
          aValue = aValue || '';
          bValue = bValue || '';
        }
        
        if (sortOrder === "asc") {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      }
      
      // Check if sorting by statusChangedAt (Last Updated)
      if (sortBy === 'statusChangedAt') {
        const aDate = new Date(a.statusChangedAt || a.createdAt).getTime();
        const bDate = new Date(b.statusChangedAt || b.createdAt).getTime();
        return sortOrder === 'asc' ? aDate - bDate : bDate - aDate;
      }
      
      // Handle string sorting with case-insensitive comparison
      if (sortBy === 'patientLastName' || sortBy === 'trayNumber' || sortBy === 'jobType' || sortBy === 'status' || sortBy === 'orderDestination') {
        const aValue = ((a[sortBy as keyof Job] as string) || "").toLowerCase();
        const bValue = ((b[sortBy as keyof Job] as string) || "").toLowerCase();
        return sortOrder === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }
      
      const aValue = a[sortBy as keyof Job] as any;
      const bValue = b[sortBy as keyof Job] as any;
      
      if (sortOrder === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  }, [jobs, searchQuery, statusFilter, typeFilter, destinationFilter, customColumnFilters, sortBy, sortOrder, customColumns]);

  // Count jobs per patient for the "related" indicator
  const patientJobCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) {
      const key = `${(job.patientFirstName || "").trim()} ${(job.patientLastName || "").trim()}`.toLowerCase();
      if (key.trim()) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [jobs]);

  // Memoize event handlers
  const handleStatusChange = useCallback((jobId: string, newStatus: string) => {
    updateJobMutation.mutate({ 
      id: jobId, 
      updates: { status: newStatus as any } 
    });
  }, [updateJobMutation]);

  const handleDeleteJob = useCallback((jobId: string) => {
    if (confirm("Are you sure you want to delete this job?")) {
      deleteJobMutation.mutate(jobId);
    }
  }, [deleteJobMutation]);

  const handleStartEditingJob = useCallback((job: Job) => {
    setEditingJob(job);
    setJobDialogOpen(true);
  }, []);

  const handleOpenJobDetails = useCallback((job: Job, panel: JobDetailsTab = "overview") => {
    setSelectedDetailsJobId(job.id);
    setJobDetailsTab(panel);
    setJobDetailsOpen(true);
  }, []);

  useEffect(() => {
    const handler = (event: CustomEvent<OpenJobEventDetail>) => {
      const jobId = event?.detail?.jobId;
      if (typeof jobId !== "string" || !jobId) return;
      const match = jobs.find((j) => j.id === jobId);
      if (match) {
        const requestedPanel = event?.detail?.panel;
        const panel: JobDetailsTab =
          requestedPanel === "comments" || requestedPanel === "overview" ? requestedPanel : "overview";
        handleOpenJobDetails(match, panel);
        return;
      }
      toast({
        title: "Job not found",
        description: "That job may have been completed or removed.",
      });
    };

    window.addEventListener("otto:openJob", handler as any);
    return () => window.removeEventListener("otto:openJob", handler as any);
  }, [jobs, handleOpenJobDetails, toast]);

  const handleOpenComments = useCallback((job: Job) => {
    handleOpenJobDetails(job, "comments");
  }, [handleOpenJobDetails]);

  const handleOpenMessageTemplates = useCallback((job: Job) => {
    setSelectedMessagesJobId(job.id);
    setMessageTemplatesOpen(true);
  }, []);

  const composeMessageForJob = useCallback(
    (job: Job) => {
      const settings = (office?.settings || {}) as any;
      const templates = ensureReadyForPickupTemplate(
        settings.smsTemplates && typeof settings.smsTemplates === "object" ? settings.smsTemplates : {},
        customStatuses,
      );
      const template = (templates?.[job.status] || "").trim();
      if (!template) return "";

      const statusLabel = getLabelFromSettings(customStatuses, job.status);
      const jobTypeLabel = getLabelFromSettings(customJobTypes, job.jobType);
      const destinationLabel = getLabelFromSettings(customOrderDestinations, job.orderDestination);
      const firstName = (job.patientFirstName || "").trim();
      const lastName = (job.patientLastName || "").trim();

      return renderMessageTemplate(template, {
        patient_first_name: firstName,
        patient_last_name: lastName,
        patient_name: `${firstName} ${lastName}`.trim(),
        order_id: job.orderId || "",
        tray_number: job.trayNumber || "",
        job_type: jobTypeLabel,
        status: statusLabel,
        destination: destinationLabel,
        office_name: office?.name || "",
        office_phone: office?.phone || "",
      }).trim();
    },
    [office?.settings, office?.name, office?.phone, customStatuses, customJobTypes, customOrderDestinations],
  );

  const handleMessagesAction = useCallback(
    async (job: Job) => {
      const message = composeMessageForJob(job);
      const phone = String(job.phone || "").trim();
      const bridge = (window as any)?.otto;

      if (message && phone && bridge?.openSmsDraft) {
        try {
          const result = await bridge.openSmsDraft({ phone, message });
          if (result?.ok) {
            toast({
              title: "Draft opened",
              description: "Opened your default messaging app with an SMS draft.",
            });
            return;
          }
        } catch {
          // Fall through to modal for manual copy/draft.
        }
      }

      handleOpenMessageTemplates(job);
    },
    [composeMessageForJob, handleOpenMessageTemplates, toast],
  );

  useEffect(() => {
    if (jobDetailsOpen && !selectedJobForDetails) {
      setJobDetailsOpen(false);
    }
  }, [jobDetailsOpen, selectedJobForDetails]);

  useEffect(() => {
    if (messageTemplatesOpen && !selectedJobForMessages) {
      setMessageTemplatesOpen(false);
    }
  }, [messageTemplatesOpen, selectedJobForMessages]);

  const handleToggleFlag = useCallback((jobId: string) => {
    if (flaggedJobIds.includes(jobId)) {
      // Unflag immediately — no modal needed
      unflagJobMutation.mutate(jobId);
    } else {
      // Open the "Why is this important?" modal
      setFlagDialogJobId(jobId);
      setFlagNote("");
    }
  }, [flaggedJobIds, flagJobMutation, unflagJobMutation]);

  const handleSort = useCallback((column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  }, [sortBy, sortOrder]);

  const getStatusBadgeColor = (status: string) =>
    getStatusBadgeStyle(status, customStatuses);

  const getTypeBadgeColor = (type: string) =>
    getTypeBadgeStyle(type, customJobTypes);

  // Memoize notification rules as a dictionary for O(1) lookup
  const notificationRulesMap = useMemo(() => {
    const map: Record<string, any> = {};
    notificationRules.forEach((rule: any) => {
      if (rule.enabled && rule.maxDays != null) {
        map[rule.status] = rule;
      }
    });
    return map;
  }, [notificationRules]);

  const isJobOverdue = useCallback((job: Job) => {
    const rule = notificationRulesMap[job.status];
    if (!rule || rule.maxDays == null) return false;

    // Only use statusChangedAt - this tracks when the job entered its current status
    if (!job.statusChangedAt) return false;

    const statusDate = new Date(job.statusChangedAt);
    if (isNaN(statusDate.getTime())) return false; // Invalid date

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - rule.maxDays);
    
    return statusDate <= cutoffDate;
  }, [notificationRulesMap]);

  const getDestinationBadgeColor = (destination: string) =>
    getDestinationBadgeStyle(destination, customOrderDestinations);

  const handleCustomColumnSave = useCallback((jobId: string, columnId: string, newValue: any) => {
    const job = jobs.find(j => j.id === jobId);
    const currentValues = (job?.customColumnValues as Record<string, any>) || {};
    updateJobMutation.mutate({
      id: jobId,
      updates: { customColumnValues: { ...currentValues, [columnId]: newValue } as any }
    });
  }, [jobs, updateJobMutation]);

  const getPatientLabel = useCallback(
    (job: Job) =>
      useTrayNumber
        ? job.trayNumber || "—"
        : formatPatientDisplayName(job.patientFirstName, job.patientLastName) || "—",
    [useTrayNumber],
  );

  useEffect(() => {
    const bridge = (window as any)?.otto;
    if (!bridge || typeof bridge.setWindowMinWidth !== "function") return;
    const viewport = tableViewportRef.current;
    if (!viewport) return;

    let disposed = false;
    let rafId: number | null = null;
    let lastRequestedWidth = 0;

    const pushWindowMinWidth = () => {
      rafId = null;
      if (disposed) return;
      const element = tableViewportRef.current;
      if (!element) return;
      if (element.clientWidth <= 0 || element.scrollWidth <= 0) return;

      // Only request additional width for actual horizontal clipping.
      // Using full scrollWidth directly can cause a feedback loop where min width keeps growing.
      const overflowPx = Math.ceil(element.scrollWidth - element.clientWidth);
      if (!Number.isFinite(overflowPx) || overflowPx <= 0) return;

      const requestedWidth = Math.ceil(window.outerWidth + overflowPx + 8);

      if (!Number.isFinite(requestedWidth) || requestedWidth <= 0) return;
      if (Math.abs(requestedWidth - lastRequestedWidth) < 8) return;
      lastRequestedWidth = requestedWidth;

      Promise.resolve(bridge.setWindowMinWidth(requestedWidth)).catch(() => {
        // Ignore bridge failures (web mode or unsupported desktop build).
      });
    };

    const scheduleMeasure = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(pushWindowMinWidth);
    };

    scheduleMeasure();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            scheduleMeasure();
          })
        : null;
    resizeObserver?.observe(viewport);
    const tableNode = viewport.querySelector("table");
    if (tableNode) {
      resizeObserver?.observe(tableNode);
    }

    const mutationObserver = new MutationObserver(() => {
      scheduleMeasure();
    });
    mutationObserver.observe(viewport, { childList: true, subtree: true, characterData: true });

    window.addEventListener("resize", scheduleMeasure);

    return () => {
      disposed = true;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("resize", scheduleMeasure);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, []);

  if (loading) {
    return (
      <Card>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <Skeleton className="h-8 w-56" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table className="text-sm [&_th]:h-10 [&_th]:px-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-center [&_td]:px-3 [&_td]:py-3 [&_td]:text-center">
            <TableHeader className="[&_th]:bg-primary/[0.06] dark:[&_th]:bg-primary/[0.10]">
              <TableRow>
                <TableHead className="w-10" />
                <TableHead className="min-w-[160px]">Patient</TableHead>
                <TableHead className="min-w-[120px]">Job Type</TableHead>
                <TableHead className="min-w-[120px]">Status</TableHead>
                <TableHead className="min-w-[120px]">Destination</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-4 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div data-testid="card-jobs-table" className="bg-background min-h-full">
        {/* Sticky toolbar: search, filters stay fixed while scrolling */}
        <div className="sticky top-0 z-20 bg-primary/[0.04] dark:bg-primary/[0.08] backdrop-blur-md border-b border-border/60">
        {/* Row 1: Search + Select/Link + Actions */}
        <div className="flex items-center gap-2 px-5 py-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={useTrayNumber ? "Search trays" : "Search patients"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 w-56 text-sm"
              data-testid="input-search"
            />
          </div>

          <div className="w-px h-4 bg-border" />

          <Button
            variant={selectionMode ? "secondary" : "ghost"}
            size="xs"
            className="gap-1.5"
            onClick={() => {
              if (selectionMode) { setSelectionMode(false); setSelectedJobs([]); }
              else { setSelectionMode(true); setLinkMode(false); setSelectedJobs([]); }
            }}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            {selectionMode ? "Cancel" : "Select"}
            {selectionMode && selectedJobs.length > 0 && (
              <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground px-1">
                {selectedJobs.length}
              </span>
            )}
          </Button>

          <Button
            variant={linkMode ? "secondary" : "ghost"}
            size="xs"
            className="gap-1.5"
            onClick={() => {
              if (linkMode) { setLinkMode(false); setSelectedJobs([]); }
              else { setLinkMode(true); setSelectionMode(false); setSelectedJobs([]); }
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
            {linkMode ? "Cancel" : "Link Jobs"}
            {linkMode && selectedJobs.length > 0 && (
              <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground px-1">
                {selectedJobs.length}
              </span>
            )}
          </Button>

          {/* Link mode actions */}
          {linkMode && (
            <>
              <div className="w-px h-4 bg-border" />
              <span className="text-xs text-muted-foreground">Select 2+ to link</span>
              <Button variant="outline" size="xs" disabled={selectedJobs.length < 2} onClick={() => linkJobsMutation.mutate(selectedJobs)}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                Link {selectedJobs.length > 0 ? `(${selectedJobs.length})` : ""}
              </Button>
            </>
          )}

          {/* Select mode bulk actions */}
          {selectionMode && (
            <>
              <div className="w-px h-4 bg-border" />
              {selectedJobs.length > 0 && (
                <span className="text-xs font-medium">{selectedJobs.length} selected</span>
              )}
              <Select
                value=""
                onValueChange={(newStatus) => {
                  if (!newStatus) return;
                  bulkUpdateMutation.mutate({ jobIds: selectedJobs, updates: { status: newStatus } });
                }}
                disabled={selectedJobs.length === 0}
              >
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue placeholder="Update Status" />
                </SelectTrigger>
                <SelectContent>
                  {(customStatuses.length > 0 ? customStatuses : [
                    { id: "job_created", label: "Job Created" },
                    { id: "ordered", label: "Ordered" },
                    { id: "in_progress", label: "In Progress" },
                    { id: "quality_check", label: "Quality Check" },
                    { id: "ready_for_pickup", label: "Ready for Pickup" },
                    { id: "completed", label: "Completed" },
                    { id: "cancelled", label: "Cancelled" },
                  ]).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="destructive" size="xs" disabled={selectedJobs.length === 0} onClick={() => setBulkDeleteConfirmOpen(true)}>
                Delete
              </Button>
            </>
          )}

          <div className="flex-1" />

          <Button variant="outline" size="xs" onClick={() => setImportWizardOpen(true)} data-testid="button-import-ehr">
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Import from EHR
          </Button>
          <Button size="xs" onClick={() => { setEditingJob(undefined); setJobDialogOpen(true); }} data-testid="button-new-job">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Job
          </Button>
        </div>

        {/* Row 2: Persistent Filters + Column Toggle */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs" data-testid="select-status-filter">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {customStatuses.length > 0 ? (
                customStatuses.map((status: any) => (
                  <SelectItem key={status.id} value={status.id}>{status.label}</SelectItem>
                ))
              ) : (
                <>
                  <SelectItem value="job_created">Job Created</SelectItem>
                  <SelectItem value="ordered">Ordered</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs" data-testid="select-type-filter">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {customJobTypes.length > 0 ? (
                customJobTypes.map((type: any) => (
                  <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
                ))
              ) : (
                <>
                  <SelectItem value="contacts">Contacts</SelectItem>
                  <SelectItem value="glasses">Glasses</SelectItem>
                  <SelectItem value="sunglasses">Sunglasses</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>

          <Select value={destinationFilter} onValueChange={setDestinationFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs" data-testid="select-destination-filter">
              <SelectValue placeholder="All Destinations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Destinations</SelectItem>
              {customOrderDestinations.length > 0 ? (
                customOrderDestinations.map((dest: any) => (
                  <SelectItem key={dest.id} value={dest.label}>{dest.label}</SelectItem>
                ))
              ) : (
                <>
                  <SelectItem value="Vision Lab">Vision Lab</SelectItem>
                  <SelectItem value="EyeTech Labs">EyeTech Labs</SelectItem>
                  <SelectItem value="Premium Optics">Premium Optics</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>

          {customColumns
            .filter((col: any) => col.type === 'checkbox')
            .map((column: any) => (
              <label key={column.id} className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md cursor-pointer">
                <Checkbox
                  checked={customColumnFilters[column.id] === 'unchecked'}
                  onCheckedChange={(checked) => setCustomColumnFilters({ ...customColumnFilters, [column.id]: checked ? 'unchecked' : null })}
                  data-testid={`checkbox-filter-custom-${column.id}`}
                />
                <span className="text-xs">{column.name} (unchecked only)</span>
              </label>
            ))}

          {(statusFilter !== "all" || typeFilter !== "all" || destinationFilter !== "all" || Object.keys(customColumnFilters).some(k => customColumnFilters[k])) && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => {
                setStatusFilter("all");
                setTypeFilter("all");
                setDestinationFilter("all");
                setCustomColumnFilters({});
              }}
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}

          <div className="flex-1" />

          {/* Column Visibility Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" className="gap-1.5">
                <Columns3 className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuCheckboxItem checked={isColumnVisible('jobType')} onCheckedChange={() => toggleColumnVisibility('jobType')} onSelect={(e) => e.preventDefault()}>
                Job Type
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible('status')} onCheckedChange={() => toggleColumnVisibility('status')} onSelect={(e) => e.preventDefault()}>
                Status
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible('destination')} onCheckedChange={() => toggleColumnVisibility('destination')} onSelect={(e) => e.preventDefault()}>
                Destination
              </DropdownMenuCheckboxItem>
              {customColumns.map((col: any) => (
                <DropdownMenuCheckboxItem key={col.id} checked={isColumnVisible(col.id)} onCheckedChange={() => toggleColumnVisibility(col.id)} onSelect={(e) => e.preventDefault()}>
                  {col.name}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuCheckboxItem checked={isColumnVisible('createdAt')} onCheckedChange={() => toggleColumnVisibility('createdAt')} onSelect={(e) => e.preventDefault()}>
                Created
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={isColumnVisible('statusChangedAt')} onCheckedChange={() => toggleColumnVisibility('statusChangedAt')} onSelect={(e) => e.preventDefault()}>
                Last Updated
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </div>{/* end sticky toolbar */}

        {/* Jobs Table */}
        <div ref={tableViewportRef}>
          <Table className="text-[13px] [&_th]:h-9 [&_th]:px-3 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground [&_td]:px-3 [&_td]:py-2.5">
            <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60 [&_th]:bg-primary/[0.06] dark:[&_th]:bg-primary/[0.10]">
              <TableRow>
                <TableHead className="w-10 text-center">
                  <Star className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:text-primary min-w-[160px] text-left"
                  onClick={() => handleSort(useTrayNumber ? "trayNumber" : "patientLastName")}
                >
                  <div className="flex items-center gap-1">
                    {useTrayNumber ? "Tray #" : "Patient"}
                    {(sortBy === "patientLastName" || sortBy === "trayNumber") && (
                      sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                {isColumnVisible('jobType') && (
                  <TableHead className="cursor-pointer hover:text-primary min-w-[120px]" onClick={() => handleSort("jobType")}>
                    <div className="flex items-center gap-1">
                      Job Type
                      {sortBy === "jobType" && (sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                    </div>
                  </TableHead>
                )}
                {isColumnVisible('status') && (
                  <TableHead className="cursor-pointer hover:text-primary min-w-[120px]" onClick={() => handleSort("status")}>
                    <div className="flex items-center gap-1">
                      Status
                      {sortBy === "status" && (sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                    </div>
                  </TableHead>
                )}
                {isColumnVisible('destination') && (
                  <TableHead className="cursor-pointer hover:text-primary min-w-[120px]" onClick={() => handleSort("orderDestination")}>
                    <div className="flex items-center gap-1">
                      Destination
                      {sortBy === "orderDestination" && (sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                    </div>
                  </TableHead>
                )}
                {customColumns.filter((col: any) => isColumnVisible(col.id)).map((column: any) => (
                  <TableHead
                    key={column.id}
                    className="cursor-pointer hover:text-primary min-w-[96px]"
                    onClick={() => handleSort(`custom-${column.id}`)}
                    data-testid={`table-header-custom-${column.id}`}
                  >
                    <span className="truncate block">{column.name}</span>
                  </TableHead>
                ))}
                {isColumnVisible('createdAt') && (
                  <TableHead className="cursor-pointer hover:text-primary min-w-[104px]" onClick={() => handleSort("createdAt")}>
                    <div className="flex items-center gap-1">
                      Created
                      {sortBy === "createdAt" && (sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                    </div>
                  </TableHead>
                )}
                {isColumnVisible('statusChangedAt') && (
                  <TableHead className="cursor-pointer hover:text-primary min-w-[116px]" onClick={() => handleSort("statusChangedAt")}>
                    <div className="flex items-center gap-1">
                      Last Updated
                      {sortBy === "statusChangedAt" && (sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                    </div>
                  </TableHead>
                )}
                <TableHead className="w-12 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && filteredJobs.length === 0 && (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell className="hidden"><Skeleton className="h-4 w-4" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-4 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-6 mx-auto" /></TableCell>
                  </TableRow>
                ))
              )}
              {!loading && filteredJobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={99} className="h-48">
                    <div className="flex flex-col items-center justify-center text-center py-8">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                        <Briefcase className="h-6 w-6 text-primary" />
                      </div>
                      {searchQuery || statusFilter !== "all" || typeFilter !== "all" || destinationFilter !== "all" || Object.values(customColumnFilters).some((v) => v != null) ? (
                        <>
                          <p className="text-sm font-medium text-foreground">No jobs match your filters</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            Try adjusting or clearing your filters to see more results.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-foreground">No jobs yet</p>
                          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                            Create your first job or import jobs from your EHR system to get started.
                          </p>
                          <div className="flex items-center gap-2 mt-4">
                            <Button variant="outline" size="sm" onClick={() => setImportWizardOpen(true)}>
                              <Upload className="mr-1.5 h-4 w-4" />
                              Import from EHR
                            </Button>
                            <Button size="sm" onClick={() => { setEditingJob(undefined); setJobDialogOpen(true); }}>
                              <Plus className="mr-1.5 h-4 w-4" />
                              New Job
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {filteredJobs.map((job, index) => (
                <TableRow
                  key={job.id}
                  className={cn(
                    "cursor-pointer transition-colors border-b border-border/30",
                    (selectionMode || linkMode) && selectedJobs.includes(job.id)
                      ? "bg-primary/10 dark:bg-primary/15 border-l-[3px] border-l-primary"
                      : index % 2 === 0
                        ? "bg-card dark:bg-card hover:bg-primary/[0.03] dark:hover:bg-primary/[0.06]"
                        : "bg-primary/[0.02] dark:bg-primary/[0.04] hover:bg-primary/[0.05] dark:hover:bg-primary/[0.08]",
                  )}
                  onClick={() => {
                    if (selectionMode || linkMode) {
                      setSelectedJobs((prev) =>
                        prev.includes(job.id) ? prev.filter((id) => id !== job.id) : [...prev, job.id]
                      );
                    } else {
                      handleOpenJobDetails(job, "overview");
                    }
                  }}
                  data-testid={`row-job-${job.id}`}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleToggleFlag(job.id)}
                      data-testid={`button-flag-${job.id}`}
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          flaggedJobIds.includes(job.id) ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"
                        )}
                      />
                    </Button>
                  </TableCell>
                  <TableCell className="text-left">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium truncate">
                        {getPatientLabel(job)}
                      </span>
                      {linkedJobIds.has(job.id) && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] cursor-pointer"
                          style={{ color: 'hsl(var(--primary))' }}
                          title="Manually linked to other jobs"
                          onClick={(e) => { e.stopPropagation(); handleOpenJobDetails(job, "related"); }}
                        >
                          <Link2 className="h-3 w-3" />
                        </span>
                      )}
                      {(() => {
                        const key = `${(job.patientFirstName || "").trim()} ${(job.patientLastName || "").trim()}`.toLowerCase();
                        const count = patientJobCounts.get(key) || 0;
                        return count > 1 && !linkedJobIds.has(job.id) ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary cursor-pointer"
                            title={`${count - 1} other job${count > 2 ? "s" : ""} for this patient`}
                            onClick={(e) => { e.stopPropagation(); handleOpenJobDetails(job, "related"); }}
                          >
                            <Link2 className="h-3 w-3" />
                            {count - 1}
                          </span>
                        ) : null;
                      })()}
                      {job.isRedoJob && (
                        <Badge
                          className="text-[11px] px-1.5 py-0 h-5 border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          data-testid={`badge-redo-${job.id}`}
                        >
                          REDO
                        </Badge>
                      )}
                      {isJobOverdue(job) && (
                        <Badge
                          className="text-[11px] px-1.5 py-0 h-5 border-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                          data-testid={`badge-overdue-${job.id}`}
                        >
                          OVERDUE
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  {isColumnVisible('jobType') && (
                    <TableCell>
                      <Badge
                        className="status-badge border-0 max-w-[130px] truncate"
                        style={{ backgroundColor: getTypeBadgeColor(job.jobType).background, color: getTypeBadgeColor(job.jobType).text }}
                      >
                        {customJobTypes.find((t: any) => t.id === job.jobType)?.label || (job.jobType ? job.jobType.charAt(0).toUpperCase() + job.jobType.slice(1) : "Unknown")}
                      </Badge>
                    </TableCell>
                  )}
                  {isColumnVisible('status') && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select value={job.status} onValueChange={(newStatus) => handleStatusChange(job.id, newStatus)}>
                        <SelectTrigger className="w-auto border-none p-0 h-auto min-h-0 focus:ring-0 focus:ring-offset-0 shadow-none">
                          <Badge
                            className="status-badge border-0 max-w-[136px] truncate"
                            style={{ backgroundColor: getStatusBadgeColor(job.status).background, color: getStatusBadgeColor(job.status).text }}
                          >
                            {customStatuses.find((s: any) => s.id === job.status)?.label ||
                             (job.status ? job.status.replace('_', ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : "Unknown")}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {customStatuses.length > 0 ? (
                            customStatuses.map((status: any) => (
                              <SelectItem key={status.id} value={status.id}>{status.label}</SelectItem>
                            ))
                          ) : (
                            <>
                              <SelectItem value="job_created">Job Created</SelectItem>
                              <SelectItem value="ordered">Ordered</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="quality_check">Quality Check</SelectItem>
                              <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  {isColumnVisible('destination') && (
                    <TableCell>
                      <Badge
                        className="status-badge border-0 max-w-[140px] truncate"
                        style={{ backgroundColor: getDestinationBadgeColor(job.orderDestination).background, color: getDestinationBadgeColor(job.orderDestination).text }}
                      >
                        {customOrderDestinations.find((d: any) => d.id === job.orderDestination)?.label || job.orderDestination || "Unknown"}
                      </Badge>
                    </TableCell>
                  )}
                  {customColumns.filter((col: any) => isColumnVisible(col.id)).map((column: any) => (
                    <TableCell
                      key={column.id}
                      className="max-w-[140px]"
                      data-testid={`table-cell-custom-${column.id}-${job.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {column.editableInWorklist === false ? (
                        <span className="text-sm text-muted-foreground truncate">
                          {(() => {
                            const v = (job.customColumnValues as Record<string, any>)?.[column.id];
                            if (v == null || v === "") return "—";
                            if (column.type === "checkbox") return v ? "Yes" : "No";
                            if (column.type === "date") { try { return format(new Date(v), "MMM d, yyyy"); } catch { return String(v); } }
                            return String(v);
                          })()}
                        </span>
                      ) : column.type === 'checkbox' ? (
                        <Checkbox
                          className="h-3.5 w-3.5 [&>span>svg]:h-3 [&>span>svg]:w-3"
                          checked={!!(job.customColumnValues as Record<string, any>)?.[column.id]}
                          onCheckedChange={(checked) => {
                            const currentValues = (job.customColumnValues as Record<string, any>) || {};
                            updateJobMutation.mutate({
                              id: job.id,
                              updates: { customColumnValues: { ...currentValues, [column.id]: checked } as any }
                            });
                          }}
                          data-testid={`checkbox-custom-${column.id}-${job.id}`}
                        />
                      ) : (
                        <EditableCell
                          jobId={job.id}
                          columnId={column.id}
                          columnType={column.type}
                          value={(job.customColumnValues as Record<string, any>)?.[column.id]}
                          onSave={handleCustomColumnSave}
                          options={column.options}
                        />
                      )}
                    </TableCell>
                  ))}
                  {isColumnVisible('createdAt') && (
                    <TableCell className="text-muted-foreground leading-tight">
                      <div>{format(new Date(job.createdAt), 'MMM d, yyyy')}</div>
                      <div className="text-xs">{format(new Date(job.createdAt), 'h:mm a')}</div>
                    </TableCell>
                  )}
                  {isColumnVisible('statusChangedAt') && (
                    <TableCell className="text-muted-foreground leading-tight">
                      <div>{format(new Date(job.statusChangedAt || job.createdAt), 'MMM d, yyyy')}</div>
                      <div className="text-xs">{format(new Date(job.statusChangedAt || job.createdAt), 'h:mm a')}</div>
                    </TableCell>
                  )}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 relative"
                        onClick={() => handleOpenComments(job)}
                        data-testid={`button-comments-${job.id}`}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        {commentCounts[job.id] > 0 && (
                          <span 
                            className={cn(
                              "absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center rounded-full text-[10px] font-semibold px-1",
                              unreadCommentJobIds.includes(job.id) 
                                ? "bg-red-500 text-white" 
                                : "bg-gray-400 dark:bg-gray-600 text-white"
                            )}
                            data-testid={`badge-comment-count-${job.id}`}
                          >
                            {commentCounts[job.id]}
                          </span>
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            data-testid={`button-actions-${job.id}`}
                          >
                            <EllipsisVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => void handleMessagesAction(job)}
                            data-testid={`menu-messages-${job.id}`}
                          >
                            Messages
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => handleOpenJobDetails(job, "overview")}
                            data-testid={`menu-edit-${job.id}`}
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => handleDeleteJob(job.id)}
                            data-testid={`menu-delete-${job.id}`}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Showing {filteredJobs.length} of {jobs.length} jobs
          </p>
        </div>

        {/* Bulk actions are now inline in the toolbar above */}
      </div>

      {/* Job Dialog */}
      <JobDialog
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        job={editingJob}
      />

      {/* Import Wizard */}
      <ImportWizard open={importWizardOpen} onOpenChange={setImportWizardOpen} />

      {/* Job Details Modal */}
      {selectedJobForDetails && (
        <JobDetailsModal
          open={jobDetailsOpen}
          onOpenChange={setJobDetailsOpen}
          job={selectedJobForDetails}
          activeTab={jobDetailsTab}
          onActiveTabChange={setJobDetailsTab}
          onEditJob={handleStartEditingJob}
          onSwitchJob={(jobId) => {
            setSelectedDetailsJobId(jobId);
            setJobDetailsTab("overview");
          }}
          flaggedJobIds={flaggedJobIds}
          overdueJobIds={overdueJobIds}
        />
      )}

      {/* Job Message Templates */}
      {selectedJobForMessages && (
        <JobMessageTemplatesModal
          open={messageTemplatesOpen}
          onOpenChange={setMessageTemplatesOpen}
          job={selectedJobForMessages}
          office={office}
        />
      )}

      {/* Flag as Important — requires a reason */}
      <Dialog open={!!flagDialogJobId} onOpenChange={(open) => { if (!open) { setFlagDialogJobId(null); setFlagNote(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Important</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Why is this job important? This note will be visible on the Important Jobs page.
            </p>
            <Textarea
              placeholder="e.g., Patient called twice asking about status, needs follow-up by Friday..."
              value={flagNote}
              onChange={(e) => setFlagNote(e.target.value)}
              rows={3}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFlagDialogJobId(null); setFlagNote(""); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (flagDialogJobId && flagNote.trim()) {
                  flagJobMutation.mutate({ jobId: flagDialogJobId, note: flagNote.trim() });
                }
              }}
              disabled={!flagNote.trim() || flagJobMutation.isPending}
            >
              {flagJobMutation.isPending ? "Saving..." : "Mark as Important"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedJobs.length} job{selectedJobs.length !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected job{selectedJobs.length !== 1 ? "s" : ""} will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate(selectedJobs)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
