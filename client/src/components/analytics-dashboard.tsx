import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarChart, Bar, PieChart, Pie, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { CalendarIcon, TrendingUp, Clock, Package, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job, ArchivedJob } from "@shared/schema";

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export default function AnalyticsDashboard() {
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [selectedJobType, setSelectedJobType] = useState<string>("all");

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    enabled: !!user?.officeId,
  });

  const { data: archivedJobs = [] } = useQuery<ArchivedJob[]>({
    queryKey: ["/api/jobs/archived"],
    enabled: !!user?.officeId,
  });

  const { data: office } = useQuery({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  // Filter ALL jobs (active + archived) by date range and job type
  const filteredActiveForCharts = jobs.filter(job => {
    const jobDate = new Date(job.statusChangedAt || job.createdAt);
    const inDateRange = jobDate >= dateRange.from && jobDate <= dateRange.to;
    const matchesType = selectedJobType === "all" || job.jobType === selectedJobType;
    return inDateRange && matchesType;
  });

  const filteredArchivedJobs = archivedJobs.filter((job: ArchivedJob) => {
    const jobDate = new Date(job.archivedAt);
    const inDateRange = jobDate >= dateRange.from && jobDate <= dateRange.to;
    const matchesType = selectedJobType === "all" || job.jobType === selectedJobType;
    return inDateRange && matchesType;
  });

  // Also check active jobs for completed/cancelled status (edge case: jobs created as completed)
  const completedActiveJobs = jobs.filter((job: Job) => {
    if (job.status !== "completed") return false;
    const jobDate = new Date(job.statusChangedAt || job.createdAt);
    const inDateRange = jobDate >= dateRange.from && jobDate <= dateRange.to;
    const matchesType = selectedJobType === "all" || job.jobType === selectedJobType;
    return inDateRange && matchesType;
  });

  const cancelledActiveJobs = jobs.filter((job: Job) => {
    if (job.status !== "cancelled") return false;
    const jobDate = new Date(job.statusChangedAt || job.createdAt);
    const inDateRange = jobDate >= dateRange.from && jobDate <= dateRange.to;
    const matchesType = selectedJobType === "all" || job.jobType === selectedJobType;
    return inDateRange && matchesType;
  });

  // Calculate metrics - ALL metrics use filtered data
  const totalActiveJobs = filteredActiveForCharts.filter(j => j.status !== "completed" && j.status !== "cancelled").length;
  const totalCompletedJobs = filteredArchivedJobs.filter(j => j.finalStatus === "completed").length + completedActiveJobs.length;
  const totalCancelledJobs = filteredArchivedJobs.filter(j => j.finalStatus === "cancelled").length + cancelledActiveJobs.length;

  // Calculate average completion time (in days)
  const completedJobsWithTime = filteredArchivedJobs
    .filter(j => j.finalStatus === "completed" && j.originalCreatedAt && j.archivedAt)
    .map(j => {
      const created = new Date(j.originalCreatedAt);
      const archived = new Date(j.archivedAt);
      return (archived.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    });
  
  const avgCompletionTime = completedJobsWithTime.length > 0
    ? (completedJobsWithTime.reduce((a, b) => a + b, 0) / completedJobsWithTime.length).toFixed(1)
    : "N/A";

  // Status distribution data - use ALL filtered jobs (active + archived)
  const allFilteredJobsForStatus = [
    ...filteredActiveForCharts.map(j => ({ status: j.status, jobType: j.jobType })),
    ...filteredArchivedJobs.map(j => ({ status: j.finalStatus, jobType: j.jobType }))
  ];
  
  const statusDistribution = allFilteredJobsForStatus.reduce((acc: Record<string, number>, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  const statusChartData = Object.entries(statusDistribution).map(([name, value]) => ({
    name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    value,
  }));

  // Job type breakdown - use ALL filtered jobs (active + archived)
  const filteredJobsForType = [...filteredActiveForCharts, ...filteredArchivedJobs];
  
  const jobTypeDistribution = filteredJobsForType.reduce((acc: Record<string, number>, job) => {
    const type = 'jobType' in job ? job.jobType : (job as any).jobType;
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const jobTypeChartData = Object.entries(jobTypeDistribution).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    count: value,
  }));

  // Trend data - daily job creation and completion (filtered by date range AND job type)
  const trendData = (() => {
    const days: Record<string, { date: string; created: number; completed: number }> = {};
    
    // Count job creations in date range (with job type filter)
    const allJobs = [...jobs, ...archivedJobs].filter(job => 
      selectedJobType === "all" || job.jobType === selectedJobType
    );
    
    allJobs.forEach(job => {
      const createdDate = 'originalCreatedAt' in job ? new Date(job.originalCreatedAt) : new Date(job.createdAt);
      if (createdDate >= dateRange.from && createdDate <= dateRange.to) {
        const date = format(createdDate, 'MMM dd');
        if (!days[date]) days[date] = { date, created: 0, completed: 0 };
        days[date].created++;
      }
    });

    // Count completions in date range (already filtered by job type in filteredArchivedJobs and completedActiveJobs)
    [...filteredArchivedJobs, ...completedActiveJobs].forEach(job => {
      const completedDate = 'archivedAt' in job ? new Date(job.archivedAt) : new Date(job.statusChangedAt || job.createdAt);
      if (completedDate >= dateRange.from && completedDate <= dateRange.to) {
        const date = format(completedDate, 'MMM dd');
        if (!days[date]) days[date] = { date, created: 0, completed: 0 };
        days[date].completed++;
      }
    });

    return Object.values(days).sort((a, b) => {
      const aDate = new Date(a.date + ', ' + new Date().getFullYear());
      const bDate = new Date(b.date + ', ' + new Date().getFullYear());
      return aDate.getTime() - bDate.getTime();
    }).slice(-14);
  })();

  // Get default job types from enum + custom types from office settings
  const defaultJobTypes = ["contacts", "glasses", "sunglasses", "prescription"];
  const customJobTypes = (office as any)?.settings?.customJobTypes || [];
  const customJobTypeValues = customJobTypes
    .map((t: any) => t?.value)
    .filter((value: any) => value && typeof value === 'string' && !defaultJobTypes.includes(value));
  const allJobTypes = ["all", ...defaultJobTypes, ...customJobTypeValues];

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Analytics Overview</h2>
          <p className="text-sm text-muted-foreground">Track performance and insights for your practice</p>
        </div>
        
        <div className="flex gap-3">
          {/* Job Type Filter */}
          <Select value={selectedJobType} onValueChange={setSelectedJobType}>
            <SelectTrigger className="w-[180px]" data-testid="select-job-type-filter">
              <SelectValue placeholder="All Job Types" />
            </SelectTrigger>
            <SelectContent>
              {allJobTypes.map(type => (
                <SelectItem key={type} value={type}>
                  {type === "all" ? "All Job Types" : type.charAt(0).toUpperCase() + type.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date Range Picker */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start text-left font-normal")} data-testid="button-date-range">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.from && dateRange.to ? (
                  <>
                    {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd, yyyy")}
                  </>
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="p-3 space-y-2">
                <Button variant="outline" size="sm" className="w-full" onClick={() => setDateRange({ from: subDays(new Date(), 7), to: new Date() })}>
                  Last 7 days
                </Button>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setDateRange({ from: subDays(new Date(), 30), to: new Date() })}>
                  Last 30 days
                </Button>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setDateRange({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) })}>
                  This month
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-metric-active">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Active Jobs</p>
              <Package className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold text-foreground" data-testid="text-metric-active">{totalActiveJobs}</p>
            <p className="text-xs text-muted-foreground mt-1">Currently in progress</p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-completed">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Completed</p>
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <p className="text-3xl font-bold text-foreground" data-testid="text-metric-completed">{totalCompletedJobs}</p>
            <p className="text-xs text-muted-foreground mt-1">In selected period</p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-cancelled">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Cancelled</p>
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <p className="text-3xl font-bold text-foreground" data-testid="text-metric-cancelled">{totalCancelledJobs}</p>
            <p className="text-xs text-muted-foreground mt-1">In selected period</p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-avg-time">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Avg. Completion</p>
              <Clock className="h-5 w-5 text-info" />
            </div>
            <p className="text-3xl font-bold text-foreground" data-testid="text-metric-avg-time">{avgCompletionTime}{avgCompletionTime !== "N/A" && "d"}</p>
            <p className="text-xs text-muted-foreground mt-1">Days to complete</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <Card data-testid="card-chart-status">
          <CardHeader>
            <CardTitle>Current Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {statusChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No active jobs to display
              </div>
            )}
          </CardContent>
        </Card>

        {/* Job Type Breakdown */}
        <Card data-testid="card-chart-job-types">
          <CardHeader>
            <CardTitle>Job Type Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {jobTypeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={jobTypeChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No jobs to display
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card data-testid="card-chart-trends">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Job Creation & Completion Trends
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="created" stroke="hsl(var(--primary))" strokeWidth={2} name="Created" />
                <Line type="monotone" dataKey="completed" stroke="hsl(var(--success))" strokeWidth={2} name="Completed" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              No trend data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
