import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { FileText, Info, CheckCircle2, AlertOctagon, AlertTriangle, Clock, Minus } from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Office, NotificationRule } from "@shared/schema";

interface OverdueJobsProps {
  jobs: any[];
  searchQuery?: string;
}

const SEVERITY_ICONS = {
  critical: AlertOctagon,
  high: AlertTriangle,
  medium: Clock,
  low: Minus,
} as const;

const SEVERITY_CONFIG = {
  critical: { color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", dot: "text-red-500", label: "Critical", range: "7+ days" },
  high: { color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800", dot: "text-orange-500", label: "High", range: "3–7 days" },
  medium: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", dot: "text-blue-500", label: "Medium", range: "1–3 days" },
  low: { color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", dot: "text-green-500", label: "Low", range: "< 1 day" },
} as const;

type Severity = keyof typeof SEVERITY_CONFIG;

function getLabelFromSettings(list: any[], value: string): string {
  if (!value) return "";
  if (!Array.isArray(list) || list.length === 0) return value;
  const byId = list.find((item) => item?.id === value);
  if (byId?.label) return String(byId.label);
  const byLabel = list.find((item) => item?.label === value);
  if (byLabel?.label) return String(byLabel.label);
  return value;
}

export default function OverdueJobs({ jobs, searchQuery = "" }: OverdueJobsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const { data: notificationRules = [] } = useQuery<NotificationRule[]>({
    queryKey: ["/api/notification-rules"],
    enabled: !!user?.officeId,
  });

  const customStatuses = useMemo(() => (office?.settings as any)?.customStatuses || [], [office]);
  const customOrderDestinations = useMemo(() => (office?.settings as any)?.customOrderDestinations || [], [office]);

  const updateJobMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PUT", `/api/jobs/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/overdue"] });
      toast({ title: "Status updated", description: "Job status has been changed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");

  const addNoteMutation = useMutation({
    mutationFn: async ({ jobId, content }: { jobId: string; content: string }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/comments`, {
        content,
        isOverdueComment: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Note added", description: "Your note has been saved." });
      setNoteDialogOpen(false);
      setNoteContent("");
      setSelectedJobId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Filter
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesSearch =
        searchQuery === "" ||
        job.patientFirstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.patientLastName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.trayNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.phone?.includes(searchQuery.replace(/\D/g, ""));
      const matchesPriority = priorityFilter === "all" || job.severity === priorityFilter;
      return matchesSearch && matchesPriority;
    });
  }, [jobs, searchQuery, priorityFilter]);

  // Counts by severity (always from full jobs list, not filtered)
  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const job of jobs) {
      if (job.severity in c) c[job.severity as Severity]++;
    }
    return c;
  }, [jobs]);

  const handleStatusChange = (jobId: string, newStatus: string) => {
    updateJobMutation.mutate({ id: jobId, updates: { status: newStatus } });
  };

  const handleAddNote = (jobId: string) => {
    setSelectedJobId(jobId);
    setNoteDialogOpen(true);
  };

  const handleSubmitNote = () => {
    if (noteContent.trim() && selectedJobId) {
      addNoteMutation.mutate({ jobId: selectedJobId, content: noteContent.trim() });
    }
  };

  // Empty state
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="overdue-jobs-empty">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-7 w-7 text-green-600" />
        </div>
        <h3 className="text-lg font-semibold mb-1">All caught up!</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          No overdue jobs right now. All jobs are within their expected timeframes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="overdue-jobs">
      {/* Summary Stat Cards */}
      <div className="grid grid-cols-4 gap-3">
        {(["critical", "high", "medium", "low"] as Severity[]).map((severity) => {
          const config = SEVERITY_CONFIG[severity];
          const count = counts[severity];
          const isActive = priorityFilter === severity;

          return (
            <button
              key={severity}
              type="button"
              onClick={() => setPriorityFilter(priorityFilter === severity ? "all" : severity)}
              className={cn(
                "rounded-lg border-l-4 p-3 text-left transition-all",
                "border bg-card hover:shadow-sm",
                config.border,
                isActive && `${config.bg} ring-1 ring-inset`,
                isActive && severity === "critical" && "ring-red-300 dark:ring-red-700",
                isActive && severity === "high" && "ring-orange-300 dark:ring-orange-700",
                isActive && severity === "medium" && "ring-blue-300 dark:ring-blue-700",
                isActive && severity === "low" && "ring-green-300 dark:ring-green-700",
              )}
              data-testid={`stat-${severity}`}
            >
              <p className={cn("text-2xl font-bold tabular-nums", config.color)}>{count}</p>
              <p className="text-sm font-medium text-foreground">{config.label}</p>
              <p className="text-xs text-muted-foreground">{config.range}</p>
            </button>
          );
        })}
      </div>

      {/* Overdue Rules — inline summary */}
      {notificationRules.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 cursor-help">
                <Info className="h-3.5 w-3.5" />
                Thresholds:
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Jobs are flagged overdue when they stay in a status longer than the configured threshold.</p>
            </TooltipContent>
          </Tooltip>
          {notificationRules.slice(0, 4).map((rule: any) => (
            <span key={rule.id} className="inline-flex items-center gap-1">
              <span className="font-medium text-foreground">{getLabelFromSettings(customStatuses, rule.status)}</span>
              <span>({rule.maxDays}d)</span>
            </span>
          ))}
        </div>
      )}

      {/* Jobs Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10"></TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead className="text-right">Days Overdue</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No jobs match the selected filter.
                </TableCell>
              </TableRow>
            ) : (
              filteredJobs.map((job) => {
                const config = SEVERITY_CONFIG[job.severity as Severity] || SEVERITY_CONFIG.low;
                const patientName = `${job.patientFirstName || ""} ${job.patientLastName || ""}`.trim();
                const destinationLabel = getLabelFromSettings(customOrderDestinations, job.orderDestination);
                const statusLabel = getLabelFromSettings(customStatuses, job.status);

                return (
                  <TableRow key={job.id} data-testid={`overdue-job-${job.id}`}>
                    {/* Severity icon */}
                    <TableCell>
                      {(() => {
                        const Icon = SEVERITY_ICONS[job.severity as Severity] || SEVERITY_ICONS.low;
                        return <Icon className={cn("h-3.5 w-3.5", config.dot)} aria-label={config.label} />;
                      })()}
                    </TableCell>

                    {/* Patient */}
                    <TableCell>
                      <p className="font-medium text-sm">{patientName}</p>
                    </TableCell>

                    {/* Job Type */}
                    <TableCell>
                      <Badge variant="secondary" className="text-xs font-normal">
                        {job.jobType}
                      </Badge>
                    </TableCell>

                    {/* Status dropdown */}
                    <TableCell>
                      <Select
                        value={job.status}
                        onValueChange={(newStatus) => handleStatusChange(job.id, newStatus)}
                      >
                        <SelectTrigger className="h-8 w-40 text-xs" data-testid={`select-status-${job.id}`}>
                          <SelectValue>{statusLabel}</SelectValue>
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
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="quality_check">Quality Check</SelectItem>
                              <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Destination */}
                    <TableCell>
                      <span className="text-sm">{destinationLabel}</span>
                    </TableCell>

                    {/* Days Overdue */}
                    <TableCell className="text-right">
                      <span className={cn("text-sm font-bold tabular-nums", config.color)}>
                        {job.daysOverdue}d
                      </span>
                    </TableCell>

                    {/* Add Note */}
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleAddNote(job.id)}
                        title="Add note"
                        data-testid={`button-note-${job.id}`}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Add Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent data-testid="dialog-add-note">
          <DialogHeader>
            <DialogTitle>Add Overdue Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Enter your note about this overdue job..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              rows={4}
              data-testid="textarea-note-content"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNoteDialogOpen(false);
                setNoteContent("");
              }}
              data-testid="button-cancel-note"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitNote}
              disabled={!noteContent.trim() || addNoteMutation.isPending}
              data-testid="button-submit-note"
            >
              {addNoteMutation.isPending ? "Adding..." : "Add Note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
