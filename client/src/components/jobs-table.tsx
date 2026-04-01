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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Search, Plus, Upload, MessageSquare, ChevronUp, ChevronDown, Star, EllipsisVertical, Briefcase, SlidersHorizontal, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import JobDialog from "./job-dialog";
import JobMessageTemplatesModal from "./job-message-templates-modal";
import JobDetailsModal, { type JobDetailsTab } from "./job-details-modal";
import ImportWizard from "./import-wizard";
import type { Job, Office } from "@shared/schema";
import { format } from "date-fns";
import { getDefaultStatusColor, getDefaultJobTypeColor, getDefaultDestinationColor, getColorForBadge } from "@/lib/default-colors";
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

export default function JobsTable({ jobs, loading }: JobsTableProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [customColumnFilters, setCustomColumnFilters] = useState<Record<string, any>>({});
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

  const flaggedJobIds = useMemo(() => flaggedJobs.map((job: any) => job.id), [flaggedJobs]);
  const overdueJobIds = useMemo(() => new Set(overdueJobs.map((job: any) => job.id)), [overdueJobs]);

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
      
      // Overdue filter
      const matchesOverdue = !overdueOnly || overdueJobIds.has(job.id);
      
      return matchesSearch && matchesStatus && matchesType && matchesDestination && matchesCustomColumns && matchesOverdue;
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
  }, [jobs, searchQuery, statusFilter, typeFilter, destinationFilter, customColumnFilters, sortBy, sortOrder, customColumns, overdueOnly, overdueJobIds]);

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

  const getStatusBadgeColor = (status: string) => {
    // Check if there's a custom color defined in settings
    const customStatus = customStatuses.find((s: any) => s.id === status);
    if (customStatus) {
      // Prefer HSL for accuracy, fall back to hex/color
      const colorValue = customStatus.hsl || customStatus.color || customStatus.hex;
      if (colorValue) {
        return getColorForBadge(colorValue);
      }
    }
    
    // Fall back to default colors
    const defaultColor = getDefaultStatusColor(status);
    if (defaultColor) {
      return getColorForBadge(defaultColor.hsl);
    }
    
    // Final fallback
    return { background: 'hsl(0 0% 90% / 0.15)', text: 'hsl(0 0% 40%)' };
  };

  const getTypeBadgeColor = (type: string) => {
    // Check if there's a custom color defined in settings
    const customType = customJobTypes.find((t: any) => t.id === type);
    if (customType) {
      // Prefer HSL for accuracy, fall back to hex/color
      const colorValue = customType.hsl || customType.color || customType.hex;
      if (colorValue) {
        return getColorForBadge(colorValue);
      }
    }
    
    // Fall back to default colors
    const defaultColor = getDefaultJobTypeColor(type);
    if (defaultColor) {
      return getColorForBadge(defaultColor.hsl);
    }
    
    // Final fallback
    return { background: 'hsl(0 0% 90% / 0.15)', text: 'hsl(0 0% 40%)' };
  };

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

  const getDestinationBadgeColor = (destination: string) => {
    // Check if there's a custom color defined in settings (by ID or label)
    const customDestination = customOrderDestinations.find((d: any) => 
      d.id === destination || d.label === destination
    );
    if (customDestination) {
      // Prefer HSL for accuracy, fall back to hex/color
      const colorValue = customDestination.hsl || customDestination.color || customDestination.hex;
      if (colorValue) {
        return getColorForBadge(colorValue);
      }
    }
    
    // Fall back to default colors
    const defaultColor = getDefaultDestinationColor(destination);
    if (defaultColor) {
      return getColorForBadge(defaultColor.hsl);
    }
    
    // Final fallback
    return { background: 'hsl(0 0% 90% / 0.15)', text: 'hsl(0 0% 40%)' };
  };

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
        <CardContent className="p-8">
          <div className="text-center">Loading jobs...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card data-testid="card-jobs-table">
        {/* Table Header with Actions */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
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

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setImportWizardOpen(true)} data-testid="button-import-ehr">
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Import from EHR
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={() => {
              setEditingJob(undefined);
              setJobDialogOpen(true);
            }} data-testid="button-new-job">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Job
            </Button>
          </div>
        </div>

        {/* Filter toggle + collapsible filters */}
        <div className="flex items-center gap-2 px-5 py-2">
          <Button
            variant={filtersOpen ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {(statusFilter !== "all" || typeFilter !== "all" || destinationFilter !== "all" || overdueOnly) && (
              <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground px-1">
                {[statusFilter !== "all", typeFilter !== "all", destinationFilter !== "all", overdueOnly].filter(Boolean).length}
              </span>
            )}
          </Button>
          {filtersOpen && (statusFilter !== "all" || typeFilter !== "all" || destinationFilter !== "all" || overdueOnly) && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => {
                setStatusFilter("all");
                setTypeFilter("all");
                setDestinationFilter("all");
                setOverdueOnly(false);
                setCustomColumnFilters({});
              }}
            >
              <X className="h-3 w-3" />
              Clear all
            </button>
          )}
        </div>
        {filtersOpen && <div className="flex flex-wrap items-center gap-2 px-5 pb-2.5">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs" data-testid="select-status-filter">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {customStatuses.length > 0 ? (
                customStatuses.map((status: any) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.label}
                  </SelectItem>
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
                  <SelectItem key={type.id} value={type.id}>
                    {type.label}
                  </SelectItem>
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
                  <SelectItem key={dest.id} value={dest.label}>
                    {dest.label}
                  </SelectItem>
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

          <label className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md cursor-pointer">
            <Checkbox
              checked={overdueOnly}
              onCheckedChange={(checked) => setOverdueOnly(!!checked)}
              data-testid="checkbox-overdue-only"
            />
            <span className="text-xs">Overdue Only</span>
          </label>

          {customColumns
            .filter((col: any) => col.type === 'checkbox')
            .map((column: any) => (
              <label 
                key={column.id} 
                className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md cursor-pointer"
              >
                <Checkbox
                  checked={customColumnFilters[column.id] === 'unchecked'}
                  onCheckedChange={(checked) => {
                    setCustomColumnFilters({
                      ...customColumnFilters,
                      [column.id]: checked ? 'unchecked' : null
                    });
                  }}
                  data-testid={`checkbox-filter-custom-${column.id}`}
                />
                <span className="text-xs">{column.name} (unchecked only)</span>
              </label>
            ))}
        </div>}

        {/* Jobs Table */}
        <div ref={tableViewportRef} className="overflow-x-auto">
          <Table className="text-[13px] [&_th]:h-10 [&_th]:px-2.5 [&_th]:text-[12px] [&_th]:font-semibold [&_td]:px-2.5 [&_td]:py-2">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    className="h-3.5 w-3.5 [&>span>svg]:h-3 [&>span>svg]:w-3"
                    checked={filteredJobs.length > 0 && selectedJobs.length === filteredJobs.length}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedJobs(filteredJobs.map(job => job.id));
                      } else {
                        setSelectedJobs([]);
                      }
                    }}
                    data-testid="checkbox-select-all"
                  />
                </TableHead>
                <TableHead className="w-10 text-center">
                  <Star className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:text-primary min-w-[160px]"
                  onClick={() => handleSort(useTrayNumber ? "trayNumber" : "patientLastName")}
                >
                  <div className="flex items-center gap-1">
                    {useTrayNumber ? "Tray #" : "Patient"}
                    {(sortBy === "patientLastName" || sortBy === "trayNumber") && (
                      sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:text-primary min-w-[120px]" onClick={() => handleSort("jobType")}>
                  <div className="flex items-center gap-1">
                    Job Type
                    {sortBy === "jobType" && (
                      sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:text-primary min-w-[120px]" onClick={() => handleSort("status")}>
                  <div className="flex items-center gap-1">
                    Status
                    {sortBy === "status" && (
                      sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:text-primary min-w-[120px]" onClick={() => handleSort("orderDestination")}>
                  <div className="flex items-center gap-1">
                    Destination
                    {sortBy === "orderDestination" && (
                      sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                {customColumns.map((column: any) => (
                  <TableHead 
                    key={column.id}
                    className="cursor-pointer hover:text-primary min-w-[96px]"
                    onClick={() => handleSort(`custom-${column.id}`)}
                    data-testid={`table-header-custom-${column.id}`}
                  >
                    <span className="truncate block">{column.name}</span>
                  </TableHead>
                ))}
                <TableHead className="cursor-pointer hover:text-primary min-w-[104px]" onClick={() => handleSort("createdAt")}>
                  <div className="flex items-center gap-1">
                    Created
                    {sortBy === "createdAt" && (
                      sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:text-primary min-w-[116px]" onClick={() => handleSort("statusChangedAt")}>
                  <div className="flex items-center gap-1">
                    Last Updated
                    {sortBy === "statusChangedAt" && (
                      sortOrder === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
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
                      <Briefcase className="h-10 w-10 text-muted-foreground/40 mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">No jobs found</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {searchQuery || statusFilter !== "all" || typeFilter !== "all" || destinationFilter !== "all"
                          ? "Try adjusting your filters"
                          : "Create your first job to get started"}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {filteredJobs.map((job, index) => (
                <TableRow 
                  key={job.id} 
                  className={cn(
                    "table-row-hover cursor-pointer transition-colors",
                    index % 2 === 0 ? "bg-muted/30" : "bg-background"
                  )}
                  onClick={() => handleOpenJobDetails(job, "overview")}
                  data-testid={`row-job-${job.id}`}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      className="h-3.5 w-3.5 [&>span>svg]:h-3 [&>span>svg]:w-3"
                      checked={selectedJobs.includes(job.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedJobs([...selectedJobs, job.id]);
                        } else {
                          setSelectedJobs(selectedJobs.filter(id => id !== job.id));
                        }
                      }}
                    />
                  </TableCell>
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
                  <TableCell>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium truncate">
                        {getPatientLabel(job)}
                      </span>
                      {(job as any)._pendingSync && (
                        <Badge
                          className="text-[10px] px-1.5 py-0 h-5 border-0"
                          style={{
                            backgroundColor: 'hsl(220 14% 50% / 0.15)',
                            color: 'hsl(220 14% 46%)'
                          }}
                          title="This job hasn't synced to the Host yet. The order ID will update once synced."
                          data-testid={`badge-pending-${job.id}`}
                        >
                          SYNCING
                        </Badge>
                      )}
                      {job.isRedoJob && (
                        <Badge
                          className="text-[10px] px-1.5 py-0 h-5 border-0"
                          style={{
                            backgroundColor: 'hsl(38 92% 50% / 0.15)',
                            color: 'hsl(38 92% 40%)'
                          }}
                          data-testid={`badge-redo-${job.id}`}
                        >
                          REDO
                        </Badge>
                      )}
                      {isJobOverdue(job) && (
                        <Badge 
                          className="text-[10px] px-1.5 py-0 h-5 border-0"
                          style={{
                            backgroundColor: 'hsl(0 84% 60% / 0.15)',
                            color: 'hsl(0 84% 50%)'
                          }}
                          data-testid={`badge-overdue-${job.id}`}
                        >
                          OVERDUE
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge 
                      className="status-badge border-0 max-w-[130px] truncate"
                      style={{
                        backgroundColor: getTypeBadgeColor(job.jobType).background,
                        color: getTypeBadgeColor(job.jobType).text
                      }}
                    >
                      {customJobTypes.find((t: any) => t.id === job.jobType)?.label || 
                       job.jobType.charAt(0).toUpperCase() + job.jobType.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={job.status}
                      onValueChange={(newStatus) => handleStatusChange(job.id, newStatus)}
                    >
                      <SelectTrigger className="w-auto border-none p-0 h-auto min-h-0">
                        <Badge 
                          className="status-badge border-0 max-w-[136px] truncate"
                          style={{
                            backgroundColor: 'transparent',
                            color: getStatusBadgeColor(job.status).text
                          }}
                        >
                          {customStatuses.find((s: any) => s.id === job.status)?.label || 
                           job.status.replace('_', ' ').split(' ').map(word => 
                             word.charAt(0).toUpperCase() + word.slice(1)
                           ).join(' ')}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {customStatuses.length > 0 ? (
                          customStatuses.map((status: any) => (
                            <SelectItem key={status.id} value={status.id}>
                              {status.label}
                            </SelectItem>
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
                  <TableCell>
                    <Badge 
                      className="status-badge border-0 max-w-[140px] truncate"
                      style={{
                        backgroundColor: getDestinationBadgeColor(job.orderDestination).background,
                        color: getDestinationBadgeColor(job.orderDestination).text
                      }}
                    >
                      {customOrderDestinations.find((d: any) => d.id === job.orderDestination)?.label || 
                       job.orderDestination}
                    </Badge>
                  </TableCell>
                  {customColumns.map((column: any) => (
                    <TableCell 
                      key={column.id}
                      className="max-w-[140px]"
                      data-testid={`table-cell-custom-${column.id}-${job.id}`}
                      onClick={column.type === 'checkbox' ? (e) => e.stopPropagation() : undefined}
                    >
                      {column.type === 'checkbox' ? (
                        <Checkbox
                          className="h-3.5 w-3.5 [&>span>svg]:h-3 [&>span>svg]:w-3"
                          checked={!!(job.customColumnValues as Record<string, any>)?.[column.id]}
                          onCheckedChange={(checked) => {
                            const currentValues = (job.customColumnValues as Record<string, any>) || {};
                            const newCustomColumnValues = {
                              ...currentValues,
                              [column.id]: checked
                            };
                            updateJobMutation.mutate({
                              id: job.id,
                              updates: { customColumnValues: newCustomColumnValues as any }
                            });
                          }}
                          data-testid={`checkbox-custom-${column.id}-${job.id}`}
                        />
                      ) : (
                        <span className="truncate block">
                          {(job.customColumnValues as Record<string, any>)?.[column.id] || '-'}
                        </span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-muted-foreground leading-tight">
                    <div>{format(new Date(job.createdAt), 'MMM d, yyyy')}</div>
                    <div className="text-[11px]">{format(new Date(job.createdAt), 'h:mm a')}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground leading-tight">
                    <div>{format(new Date(job.statusChangedAt || job.createdAt), 'MMM d, yyyy')}</div>
                    <div className="text-[11px]">{format(new Date(job.statusChangedAt || job.createdAt), 'h:mm a')}</div>
                  </TableCell>
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
                              "absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center rounded-full text-[9px] font-semibold px-1",
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

        {/* Bulk Actions Bar */}
        {selectedJobs.length > 0 && (
          <div className="px-4 py-3 bg-primary/5 border-t border-primary/20 flex items-center gap-3">
            <p className="text-sm font-medium">
              {selectedJobs.length} job{selectedJobs.length !== 1 ? "s" : ""} selected
            </p>
            <div className="flex items-center gap-2 ml-auto">
              <Select
                value=""
                onValueChange={(newStatus) => {
                  if (!newStatus) return;
                  bulkUpdateMutation.mutate({ jobIds: selectedJobs, updates: { status: newStatus } });
                }}
              >
                <SelectTrigger className="h-8 w-40 text-xs">
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
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  if (confirm(`Delete ${selectedJobs.length} job${selectedJobs.length !== 1 ? "s" : ""}? This cannot be undone.`)) {
                    bulkDeleteMutation.mutate(selectedJobs);
                  }
                }}
              >
                Delete Selected
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setSelectedJobs([])}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </Card>

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
    </>
  );
}
