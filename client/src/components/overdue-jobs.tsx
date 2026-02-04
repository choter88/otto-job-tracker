import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { AlertTriangle, FileText } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import type { Office, NotificationRule } from "@shared/schema";

interface OverdueJobsProps {
  jobs: any[];
  searchQuery?: string;
}

export default function OverdueJobs({ jobs, searchQuery = "" }: OverdueJobsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [priorityFilter, setPriorityFilter] = useState("all");

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const { data: notificationRules = [] } = useQuery<NotificationRule[]>({
    queryKey: ["/api/notification-rules"],
    enabled: !!user?.officeId,
  });

  const updateJobMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PUT", `/api/jobs/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/overdue"] });
      toast({
        title: "Success",
        description: "Job status updated successfully.",
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
      toast({
        title: "Note Added",
        description: "Your note has been added to this job.",
      });
      setNoteDialogOpen(false);
      setNoteContent("");
      setSelectedJobId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const filteredJobs = jobs.filter(job => {
    const matchesSearch = searchQuery === "" || 
      job.patientLastName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.orderId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.phone?.includes(searchQuery.replace(/\D/g, ''));
    
    const matchesPriority = priorityFilter === "all" || job.severity === priorityFilter;
    
    return matchesSearch && matchesPriority;
  });

  const handleStatusChange = (jobId: string, newStatus: string) => {
    updateJobMutation.mutate({ 
      id: jobId, 
      updates: { status: newStatus } 
    });
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

  const getSeverityBadge = (severity: string) => {
    const severityConfig = {
      critical: { class: "priority-critical", label: "CRITICAL", icon: "🔴" },
      high: { class: "priority-high", label: "HIGH", icon: "🟠" },
      medium: { class: "priority-medium", label: "MEDIUM", icon: "🔵" },
      low: { class: "priority-low", label: "LOW", icon: "🟢" },
    };

    const config = severityConfig[severity as keyof typeof severityConfig];
    if (!config) return null;

    return (
      <Badge className={`status-badge ${config.class}`}>
        <AlertTriangle className="h-3 w-3 mr-1" />
        {config.label} - {severity === 'critical' ? '7+' : severity === 'high' ? '3-7' : severity === 'medium' ? '1-3' : '0-1'} days overdue
      </Badge>
    );
  };

  const customStatuses = (office?.settings as any)?.customStatuses || [];

  if (filteredJobs.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-success/10 rounded-full">
              <span className="text-2xl">✓</span>
            </div>
            <h3 className="text-lg font-semibold">No Overdue Jobs!</h3>
            <p className="text-muted-foreground">
              Great work! All jobs are on track and within their expected timeframes.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="overdue-jobs">
      {/* Priority Filter */}
      <div className="flex gap-2">
        <Button
          variant={priorityFilter === "critical" ? "destructive" : "outline"}
          onClick={() => setPriorityFilter(priorityFilter === "critical" ? "all" : "critical")}
          className="font-medium"
        >
          Critical ({filteredJobs.filter(j => j.severity === "critical").length})
        </Button>
        <Button
          variant={priorityFilter === "high" ? "secondary" : "outline"}
          onClick={() => setPriorityFilter(priorityFilter === "high" ? "all" : "high")}
        >
          High ({filteredJobs.filter(j => j.severity === "high").length})
        </Button>
        <Button
          variant={priorityFilter === "medium" ? "secondary" : "outline"}
          onClick={() => setPriorityFilter(priorityFilter === "medium" ? "all" : "medium")}
        >
          Medium ({filteredJobs.filter(j => j.severity === "medium").length})
        </Button>
        <Button
          variant={priorityFilter === "low" ? "secondary" : "outline"}
          onClick={() => setPriorityFilter(priorityFilter === "low" ? "all" : "low")}
        >
          Low ({filteredJobs.filter(j => j.severity === "low").length})
        </Button>
      </div>

      {/* Overdue Jobs List */}
      <div className="space-y-4">
        {filteredJobs.map((job) => (
          <Card 
            key={job.id} 
            className={`border-2 ${
              job.severity === 'critical' ? 'border-red-200 bg-red-50/50' :
              job.severity === 'high' ? 'border-orange-200 bg-orange-50/50' :
              job.severity === 'medium' ? 'border-blue-200 bg-blue-50/50' :
              'border-green-200 bg-green-50/50'
            }`}
            data-testid={`overdue-job-${job.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-sm font-medium text-primary">
                      {job.orderId}
                    </span>
                    {getSeverityBadge(job.severity)}
                  </div>
                  <h3 className="text-lg font-semibold">
                    {job.patientFirstInitial}. {job.patientLastName} - {job.jobType}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Current Status: <span className="font-medium">
                      {customStatuses.find((s: any) => s.id === job.status)?.label || 
                       job.status?.replace('_', ' ').split(' ').map((word: string) => 
                         word.charAt(0).toUpperCase() + word.slice(1)
                       ).join(' ')}
                    </span> | 
                    Order Destination: <span className="font-medium">{job.orderDestination}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{format(new Date(job.createdAt), 'MMM d, yyyy')}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.daysOverdue} days overdue
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border">
                <Select
                  value={job.status}
                  onValueChange={(newStatus) => handleStatusChange(job.id, newStatus)}
                >
                  <SelectTrigger className="w-48" data-testid={`select-status-${job.id}`}>
                    <SelectValue placeholder="Update Status" />
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

                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddNote(job.id)}
                  data-testid={`button-note-${job.id}`}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Add Note
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Notification Rules Summary */}
      <Card>
        <CardContent className="p-4">
          <h4 className="font-semibold mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Notification Rules
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            Overdue thresholds are based on your notification rules.
          </p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {notificationRules.slice(0, 3).map((rule: any) => (
              <div key={rule.id} className="p-2 bg-card rounded border border-border">
                <p className="font-medium">
                  {customStatuses.find((s: any) => s.id === rule.status)?.label || rule.status}
                </p>
                <p className="text-muted-foreground">Max: {rule.maxDays} days</p>
              </div>
            ))}
          </div>
        </CardContent>
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
