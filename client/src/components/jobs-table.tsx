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
import { Search, Plus, MessageSquare, ChevronUp, ChevronDown, Star, EllipsisVertical } from "lucide-react";
import JobDialog from "./job-dialog";
import JobMessageTemplatesModal from "./job-message-templates-modal";
import JobDetailsModal, { type JobDetailsTab } from "./job-details-modal";
import type { Job, Office } from "@shared/schema";
import { format } from "date-fns";
import { getDefaultStatusColor, getDefaultJobTypeColor, getDefaultDestinationColor, getColorForBadge } from "@/lib/default-colors";
import { cn } from "@/lib/utils";
import { formatPatientDisplayName } from "@shared/name-format";

interface JobsTableProps {
  jobs: Job[];
  loading?: boolean;
}

interface OpenJobEventDetail {
  jobId?: string;
  panel?: JobDetailsTab;
}

export default function JobsTable({ jobs, loading }: JobsTableProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [customColumnFilters, setCustomColumnFilters] = useState<Record<string, any>>({});
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
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

  const flagJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/flag`, {});
      return res.json();
    },
    onMutate: async (jobId) => {
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
      toast({
        title: "Success",
        description: "Job flagged as important.",
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
          requestedPanel === "comments" || requestedPanel === "history" || requestedPanel === "overview"
            ? requestedPanel
            : "overview";
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
      unflagJobMutation.mutate(jobId);
    } else {
      flagJobMutation.mutate(jobId);
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

      const windowChromeWidth = Math.max(0, window.outerWidth - element.clientWidth);
      const requestedWidth = Math.ceil(windowChromeWidth + element.scrollWidth + 8);

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
        <div className="flex items-center justify-between p-6 pb-4 border-b border-border">
          <h2 className="text-lg font-semibold">Worklist</h2>
          
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={useTrayNumber ? "Search trays" : "Search patients"}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-64"
                data-testid="input-search"
              />
            </div>
            
            {/* New Job Button */}
            <Button onClick={() => {
              setEditingJob(undefined);
              setJobDialogOpen(true);
            }} data-testid="button-new-job">
              <Plus className="mr-2 h-4 w-4" />
              New Job
            </Button>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap gap-3 p-6 pb-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-auto min-w-[150px]" data-testid="select-status-filter">
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
            <SelectTrigger className="w-auto min-w-[150px]" data-testid="select-type-filter">
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
            <SelectTrigger className="w-auto min-w-[150px]" data-testid="select-destination-filter">
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
            <span className="text-sm">Overdue Only</span>
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
                <span className="text-sm">{column.name} (unchecked only)</span>
              </label>
            ))}
        </div>

        {/* Jobs Table */}
        <div ref={tableViewportRef} className="overflow-x-auto">
          <Table className="text-[13px] [&_th]:h-10 [&_th]:px-2.5 [&_th]:text-[12px] [&_th]:font-semibold [&_td]:px-2.5 [&_td]:py-2">
            <TableHeader>
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
                            onSelect={() => handleOpenMessageTemplates(job)}
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

        {/* Pagination */}
        <div className="flex items-center justify-between p-6 pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            Showing {filteredJobs.length} of {jobs.length} jobs
          </p>
        </div>

        {/* Bulk Actions */}
        {selectedJobs.length > 0 && (
          <div className="p-4 bg-muted border-t border-border">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {selectedJobs.length} jobs selected
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" data-testid="button-bulk-update">
                  Update Status
                </Button>
                <Button variant="destructive" size="sm" data-testid="button-bulk-delete">
                  Delete Selected
                </Button>
              </div>
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
    </>
  );
}
