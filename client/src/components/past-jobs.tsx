import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Undo, RotateCcw, CheckCircle, XCircle, Search, Calendar, Archive } from "lucide-react";
import { format, startOfMonth, startOfQuarter, startOfYear, subMonths } from "date-fns";
import { useState, useMemo } from "react";
import type { ArchivedJob, Office } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { getStatusBadgeStyle, getTypeBadgeStyle, getDestinationBadgeStyle } from "@/lib/default-colors";

interface DateRangePreset {
  id: string;
  label: string;
  startDate: Date;
  endDate: Date;
}

export default function PastJobs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [nameSearch, setNameSearch] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState("month");
  
  // Calculate date range presets
  const dateRangePresets = useMemo<DateRangePreset[]>(() => {
    const now = new Date();
    return [
      {
        id: "month",
        label: "This Month",
        startDate: startOfMonth(now),
        endDate: now
      },
      {
        id: "quarter",
        label: "This Quarter",
        startDate: startOfQuarter(now),
        endDate: now
      },
      {
        id: "trailing12",
        label: "Trailing 12 Months",
        startDate: subMonths(now, 12),
        endDate: now
      },
      {
        id: "ytd",
        label: "Year to Date",
        startDate: startOfYear(now),
        endDate: now
      },
      {
        id: "all",
        label: "All Time",
        startDate: new Date(2020, 0, 1), // Far back date
        endDate: now
      }
    ];
  }, []);
  
  const currentPreset = dateRangePresets.find(p => p.id === dateRangePreset) || dateRangePresets[0];
  
  // Fetch archived jobs with filters
  const { data: jobs = [], isLoading } = useQuery<ArchivedJob[]>({
    queryKey: [
      "/api/jobs/archived",
      dateRangePreset === 'all' ? 'all-time' : currentPreset.startDate.toISOString(),
      dateRangePreset === 'all' ? 'all-time' : currentPreset.endDate.toISOString(),
      nameSearch
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      
      // Only add date filters if not "All Time"
      if (dateRangePreset !== 'all') {
        params.append('startDate', currentPreset.startDate.toISOString().split('T')[0]);
        params.append('endDate', currentPreset.endDate.toISOString().split('T')[0]);
      }
      
      if (nameSearch.trim()) {
        params.append('name', nameSearch.trim());
      }
      
      const res = await fetch(`/api/jobs/archived?${params.toString()}`, {
        credentials: 'include'
      });
      
      if (!res.ok) throw new Error('Failed to fetch archived jobs');
      return res.json();
    }
  });

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const restoreJobMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/jobs/archived/${id}/restore`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/archived"] });
      toast({
        title: "Success",
        description: "Job restored successfully.",
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

  const redoJobMutation = useMutation({
    mutationFn: async (archivedJob: ArchivedJob) => {
      const res = await apiRequest("POST", "/api/jobs", {
        patientFirstName: archivedJob.patientFirstName,
        patientLastName: archivedJob.patientLastName,
        trayNumber: archivedJob.trayNumber,
        phone: archivedJob.phone,
        jobType: archivedJob.jobType,
        status: "job_created",
        orderDestination: archivedJob.orderDestination,
        isRedoJob: true,
        notes: `Redo of order ${archivedJob.orderId}`,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: "Success",
        description: "Redo job created successfully.",
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

  const filteredJobs = jobs.filter(job => {
    const matchesStatus = statusFilter === "all" || job.finalStatus === statusFilter;
    return matchesStatus;
  });
  
  // Calculate total completed jobs (completed status only) in date range
  const totalCompleted = jobs.filter(job => job.finalStatus === "completed").length;

  const handleRestoreJob = (job: ArchivedJob) => {
    restoreJobMutation.mutate(job.id);
  };

  const handleRedoJob = (job: ArchivedJob) => {
    redoJobMutation.mutate(job);
  };

  const customJobTypes = (office?.settings as any)?.customJobTypes || [];
  const customStatuses = (office?.settings as any)?.customStatuses || [];
  const customOrderDestinations = (office?.settings as any)?.customOrderDestinations || [];

  const getTypeBadgeColor = (type: string) =>
    getTypeBadgeStyle(type, customJobTypes);

  const getStatusBadgeColor = (status: string) =>
    getStatusBadgeStyle(status, customStatuses);

  const getDestinationBadgeColor = (destination: string) =>
    getDestinationBadgeStyle(destination, customOrderDestinations);

  const getDestinationLabel = (destination: string) => {
    const customOrderDestinations = (office?.settings as any)?.customOrderDestinations || [];
    const customDestination = customOrderDestinations.find((d: any) => d.id === destination);
    if (customDestination) {
      return customDestination.label;
    }
    // Format default destination IDs for display
    return destination.replace(/_/g, ' ').split(' ').map((word: string) => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <Card data-testid="card-past-jobs">
      {/* Header */}
      <div className="p-6 pb-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Past Jobs</h2>
            <p className="text-sm text-muted-foreground mt-1">
              View archived completed and cancelled jobs
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Total Completed: </span>
              <span className="font-semibold text-lg text-primary" data-testid="text-total-completed">
                {totalCompleted}
              </span>
            </div>
          </div>
        </div>
        
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by patient name..."
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              className="pl-9"
              data-testid="input-name-search"
            />
          </div>
          
          <Select value={dateRangePreset} onValueChange={setDateRangePreset}>
            <SelectTrigger className="w-[200px]" data-testid="select-date-range">
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dateRangePresets.map(preset => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-past-status-filter">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground">Loading past jobs...</p>
        </CardContent>
      )}

      {/* Empty State */}
      {!isLoading && filteredJobs.length === 0 && (
        <CardContent className="p-8">
          <div className="flex flex-col items-center justify-center text-center py-8">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Archive className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No Past Jobs</p>
            <p className="text-sm text-muted-foreground mt-1">
              No jobs found for the selected date range and filters.
            </p>
          </div>
        </CardContent>
      )}

      {/* Past Jobs Table */}
      {!isLoading && filteredJobs.length > 0 && (
        <div className="overflow-x-auto">
          <Table className="text-[13px] [&_th]:h-10 [&_th]:px-2.5 [&_th]:text-[12px] [&_th]:font-semibold [&_td]:px-2.5 [&_td]:py-2">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Job Type</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Final Status</TableHead>
              <TableHead>Completed Date</TableHead>
              <TableHead>Original Date</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredJobs.map((job, index) => (
              <TableRow
                key={job.id}
                className={index % 2 === 0 ? "bg-muted/30 hover:bg-muted/50" : "bg-card hover:bg-muted/30"}
                data-testid={`row-past-job-${job.id}`}
              >
                <TableCell>
                  <span className="font-medium">
                    {`${job.patientFirstName} ${job.patientLastName}`.trim()}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge 
                    className="status-badge border-0"
                    style={{
                      backgroundColor: getTypeBadgeColor(job.jobType).background,
                      color: getTypeBadgeColor(job.jobType).text
                    }}
                  >
                    {job.jobType.charAt(0).toUpperCase() + job.jobType.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge 
                    className="status-badge border-0"
                    style={{
                      backgroundColor: getDestinationBadgeColor(job.orderDestination).background,
                      color: getDestinationBadgeColor(job.orderDestination).text
                    }}
                  >
                    {getDestinationLabel(job.orderDestination)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge 
                    className="status-badge border-0"
                    style={{
                      backgroundColor: getStatusBadgeColor(job.finalStatus).background,
                      color: getStatusBadgeColor(job.finalStatus).text
                    }}
                  >
                    {job.finalStatus === "completed" ? (
                      <>
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Completed
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3 mr-1" />
                        Cancelled
                      </>
                    )}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <div>{format(new Date(job.archivedAt), 'MMM d, yyyy')}</div>
                  <div className="text-xs">{format(new Date(job.archivedAt), 'h:mm a')}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(job.originalCreatedAt), 'MMM d, yyyy')}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRestoreJob(job)}
                      disabled={restoreJobMutation.isPending}
                      data-testid={`button-restore-${job.id}`}
                    >
                      <Undo className="mr-1 h-3 w-3" />
                      Restore
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRedoJob(job)}
                      disabled={redoJobMutation.isPending}
                      data-testid={`button-redo-${job.id}`}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Redo
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      )}

      {/* Footer */}
      {!isLoading && filteredJobs.length > 0 && (
        <div className="flex items-center justify-between p-6 pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            Showing {filteredJobs.length} archived {filteredJobs.length === 1 ? 'job' : 'jobs'}
            {dateRangePreset !== 'all' && (
              <span className="ml-1">
                ({format(currentPreset.startDate, 'MMM d')} - {format(currentPreset.endDate, 'MMM d, yyyy')})
              </span>
            )}
          </p>
        </div>
      )}
    </Card>
  );
}
