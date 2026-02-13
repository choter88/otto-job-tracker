import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarChart, Bar, PieChart, Pie, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { endOfDay, endOfWeek, format, startOfDay, startOfMonth, startOfWeek, subDays, endOfMonth } from "date-fns";
import { AlertTriangle, CalendarIcon, CheckCircle2, Clock, Package, Star, TrendingUp, XCircle } from "lucide-react";
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
  const [selectedDestination, setSelectedDestination] = useState<string>("all");

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

  const { data: overdueJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs/overdue"],
    enabled: !!user?.officeId,
  });

  const { data: flaggedJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs/flagged"],
    enabled: !!user?.officeId,
  });

  const customStatuses = Array.isArray((office as any)?.settings?.customStatuses)
    ? ((office as any).settings.customStatuses as any[])
    : [];
  const customJobTypes = Array.isArray((office as any)?.settings?.customJobTypes)
    ? ((office as any).settings.customJobTypes as any[])
    : [];
  const customOrderDestinations = Array.isArray((office as any)?.settings?.customOrderDestinations)
    ? ((office as any).settings.customOrderDestinations as any[])
    : [];

  const toTitleCase = (value: string) =>
    value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const statusLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of customStatuses) {
      if (s?.id && s?.label) map.set(String(s.id), String(s.label));
    }
    return map;
  }, [customStatuses]);

  const jobTypeLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of customJobTypes) {
      if (t?.id && t?.label) map.set(String(t.id), String(t.label));
    }
    return map;
  }, [customJobTypes]);

  const destinationLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of customOrderDestinations) {
      if (d?.id && d?.label) map.set(String(d.id), String(d.label));
    }
    return map;
  }, [customOrderDestinations]);

  const getStatusLabel = (statusId: string) => statusLabelById.get(statusId) || toTitleCase(statusId);
  const getJobTypeLabel = (jobTypeId: string) => jobTypeLabelById.get(jobTypeId) || toTitleCase(jobTypeId);
  const getDestinationLabel = (destIdOrLabel: string) =>
    customOrderDestinations.find((d) => d?.id === destIdOrLabel || d?.label === destIdOrLabel)?.label ||
    destinationLabelById.get(destIdOrLabel) ||
    toTitleCase(destIdOrLabel);

  const jobTypeOptions = useMemo(() => {
    const defaults = ["contacts", "glasses", "sunglasses", "prescription"].map((id) => ({
      value: id,
      label: toTitleCase(id),
    }));

    const fromSettings = customJobTypes
      .slice()
      .sort((a, b) => (Number(a?.order ?? 0) || 0) - (Number(b?.order ?? 0) || 0))
      .map((t) => ({ value: String(t.id), label: String(t.label || toTitleCase(String(t.id))) }));

    const list = fromSettings.length > 0 ? fromSettings : defaults;
    return [{ value: "all", label: "All Job Types" }, ...list];
  }, [customJobTypes]);

  const destinationOptions = useMemo(() => {
    const defaults = [
      { id: "vision_lab", label: "Vision Lab", order: 1 },
      { id: "eyetech_labs", label: "EyeTech Labs", order: 2 },
      { id: "premium_optics", label: "Premium Optics", order: 3 },
    ].map((d) => ({ value: d.id, label: d.label }));

    const fromSettings = customOrderDestinations
      .slice()
      .sort((a, b) => (Number(a?.order ?? 0) || 0) - (Number(b?.order ?? 0) || 0))
      .map((d) => ({ value: String(d.id), label: String(d.label || toTitleCase(String(d.id))) }));

    const list = fromSettings.length > 0 ? fromSettings : defaults;
    return [{ value: "all", label: "All Destinations" }, ...list];
  }, [customOrderDestinations]);

  const rangeStart = startOfDay(dateRange.from);
  const rangeEnd = endOfDay(dateRange.to);

  const isInDateRange = (date: Date) => date >= rangeStart && date <= rangeEnd;
  const matchesJobType = (jobTypeId: string) => selectedJobType === "all" || jobTypeId === selectedJobType;

  const selectedDestinationLabel = useMemo(
    () => destinationOptions.find((d) => d.value === selectedDestination)?.label,
    [destinationOptions, selectedDestination],
  );

  const matchesDestination = (orderDestination: string) => {
    if (selectedDestination === "all") return true;
    if (orderDestination === selectedDestination) return true;
    if (selectedDestinationLabel && orderDestination === selectedDestinationLabel) return true;
    return false;
  };

  // Current backlog (active jobs), filtered by Job Type + Destination (not by date range)
  const activeBacklogJobs = jobs
    .filter((job) => job.status !== "completed" && job.status !== "cancelled")
    .filter((job) => matchesJobType(job.jobType) && matchesDestination(job.orderDestination));

  const filteredArchivedJobs = archivedJobs.filter((job: ArchivedJob) => {
    const jobDate = new Date(job.archivedAt);
    return isInDateRange(jobDate) && matchesJobType(job.jobType) && matchesDestination(job.orderDestination);
  });

  // Also check active jobs for completed/cancelled status (edge case: jobs created as completed)
  const completedActiveJobs = jobs.filter((job: Job) => {
    if (job.status !== "completed") return false;
    const jobDate = new Date(job.statusChangedAt || job.createdAt);
    return isInDateRange(jobDate) && matchesJobType(job.jobType) && matchesDestination(job.orderDestination);
  });

  const cancelledActiveJobs = jobs.filter((job: Job) => {
    if (job.status !== "cancelled") return false;
    const jobDate = new Date(job.statusChangedAt || job.createdAt);
    return isInDateRange(jobDate) && matchesJobType(job.jobType) && matchesDestination(job.orderDestination);
  });

  // Calculate metrics - ALL metrics use filtered data
  const totalActiveJobs = activeBacklogJobs.length;
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

  const completionTimesSorted = [...completedJobsWithTime].sort((a, b) => a - b);
  const percentileCompletionDays = (p: number) => {
    if (completionTimesSorted.length === 0) return null;
    const idx = Math.floor(p * (completionTimesSorted.length - 1));
    return completionTimesSorted[Math.max(0, Math.min(completionTimesSorted.length - 1, idx))];
  };
  const medianCompletionDays = percentileCompletionDays(0.5);
  const p90CompletionDays = percentileCompletionDays(0.9);

  const oldestBacklogDays =
    activeBacklogJobs.length > 0
      ? Math.max(
          ...activeBacklogJobs.map((j) => {
            const base = new Date(j.statusChangedAt || j.createdAt).getTime();
            return (Date.now() - base) / (1000 * 60 * 60 * 24);
          }),
        )
      : null;

  const daysSince = (date: Date) => (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

  const backlogWatchlist = activeBacklogJobs
    .map((job) => {
      const baseDate = new Date(job.statusChangedAt || job.createdAt);
      const ageDays = Number.isFinite(baseDate.getTime()) ? daysSince(baseDate) : null;
      return {
        id: job.id,
        orderId: job.orderId,
        status: job.status,
        statusLabel: getStatusLabel(job.status),
        ageDays,
      };
    })
    .filter((item): item is { id: string; orderId: string; status: string; statusLabel: string; ageDays: number } => typeof item.ageDays === "number")
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 5);

  const severityRank: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

  const overdueUniqueByJobId = new Map<string, any>();
  for (const overdue of overdueJobs) {
    if (!overdue?.id) continue;
    if (!matchesJobType(String(overdue.jobType || ""))) continue;
    if (!matchesDestination(String(overdue.orderDestination || ""))) continue;

    const existing = overdueUniqueByJobId.get(String(overdue.id));
    if (!existing) {
      overdueUniqueByJobId.set(String(overdue.id), overdue);
      continue;
    }

    const currentRank = severityRank[String(existing.severity || "low")] ?? 0;
    const nextRank = severityRank[String(overdue.severity || "low")] ?? 0;
    if (nextRank > currentRank) {
      overdueUniqueByJobId.set(String(overdue.id), overdue);
    }
  }
  const overdueUniqueJobs = Array.from(overdueUniqueByJobId.values());
  const overdueHighCount = overdueUniqueJobs.filter((j) => j.severity === "critical" || j.severity === "high").length;
  const worstOverdueJobs = overdueUniqueJobs
    .slice()
    .sort((a, b) => {
      const aRank = severityRank[String(a?.severity || "low")] ?? 0;
      const bRank = severityRank[String(b?.severity || "low")] ?? 0;
      if (bRank !== aRank) return bRank - aRank;
      return Number(b?.daysOverdue || 0) - Number(a?.daysOverdue || 0);
    })
    .slice(0, 5);

  const overdueHotspots = Object.entries(
    overdueUniqueJobs.reduce((acc: Record<string, number>, job) => {
      const statusId = String(job.status || "");
      if (!statusId) return acc;
      acc[statusId] = (acc[statusId] || 0) + 1;
      return acc;
    }, {}),
  )
    .map(([statusId, count]) => ({
      statusId,
      label: getStatusLabel(statusId),
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const importantJobIds = new Set<string>();
  for (const flagged of flaggedJobs) {
    if (!flagged?.id) continue;
    if (!matchesJobType(String(flagged.jobType || ""))) continue;
    if (!matchesDestination(String(flagged.orderDestination || ""))) continue;
    importantJobIds.add(String(flagged.id));
  }
  const starredWatchlist = flaggedJobs
    .filter((flagged) => {
      if (!flagged?.orderId || !flagged?.id) return false;
      if (!matchesJobType(String(flagged.jobType || ""))) return false;
      if (!matchesDestination(String(flagged.orderDestination || ""))) return false;
      return true;
    })
    .slice(0, 5)
    .map((flagged) => ({
      id: String(flagged.id),
      orderId: String(flagged.orderId),
      flaggedBy: flagged?.flaggedBy?.firstName
        ? `${String(flagged.flaggedBy.firstName)} ${String(flagged.flaggedBy.lastName || "")}`.trim()
        : "",
      hasNote: Boolean(String(flagged.importantNote || "").trim()),
    }));

  const periodLabel = `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}`;

  const createdJobsInRange = [...jobs, ...archivedJobs].filter((job) => {
    if (!matchesJobType(job.jobType)) return false;
    if (!matchesDestination(job.orderDestination)) return false;
    const createdDate = "originalCreatedAt" in job ? new Date(job.originalCreatedAt) : new Date(job.createdAt);
    return isInDateRange(createdDate);
  });
  const redoJobsInRange = createdJobsInRange.filter((j) => Boolean((j as any).isRedoJob));
  const redoRatePct = createdJobsInRange.length > 0 ? (redoJobsInRange.length / createdJobsInRange.length) * 100 : null;

  const doneInPeriod = totalCompletedJobs + totalCancelledJobs;
  const cancellationRatePct = doneInPeriod > 0 ? (totalCancelledJobs / doneInPeriod) * 100 : null;

  // Status distribution data - current backlog (not date-filtered)
  const statusDistribution = activeBacklogJobs.reduce((acc: Record<string, number>, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  const statusChartData = Object.entries(statusDistribution)
    .map(([statusId, value]) => ({
      name: getStatusLabel(statusId),
      value,
    }))
    .sort((a, b) => b.value - a.value);

  // Job type breakdown - created within selected period
  const jobTypeDistribution = createdJobsInRange.reduce((acc: Record<string, number>, job) => {
    acc[job.jobType] = (acc[job.jobType] || 0) + 1;
    return acc;
  }, {});

  const jobTypeChartData = Object.entries(jobTypeDistribution)
    .map(([jobTypeId, value]) => ({
      name: getJobTypeLabel(jobTypeId),
      count: value,
    }))
    .sort((a, b) => b.count - a.count);

  // Destination breakdown - created within selected period
  const destinationDistribution = createdJobsInRange.reduce((acc: Record<string, number>, job) => {
    acc[job.orderDestination] = (acc[job.orderDestination] || 0) + 1;
    return acc;
  }, {});

  const destinationChartData = Object.entries(destinationDistribution)
    .map(([destId, value]) => ({
      name: getDestinationLabel(destId),
      count: value,
    }))
    .sort((a, b) => b.count - a.count);

  const completionTimeByType = filteredArchivedJobs
    .filter((j) => j.finalStatus === "completed" && j.originalCreatedAt && j.archivedAt)
    .reduce((acc: Record<string, { totalDays: number; count: number }>, job) => {
      const created = new Date(job.originalCreatedAt);
      const archived = new Date(job.archivedAt);
      const days = (archived.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
      const bucket = acc[job.jobType] || { totalDays: 0, count: 0 };
      bucket.totalDays += days;
      bucket.count += 1;
      acc[job.jobType] = bucket;
      return acc;
    }, {});

  const completionTimeByTypeChartData = Object.entries(completionTimeByType)
    .map(([jobTypeId, stats]) => ({
      name: getJobTypeLabel(jobTypeId),
      days: Number((stats.totalDays / Math.max(1, stats.count)).toFixed(1)),
    }))
    .sort((a, b) => b.days - a.days);

  // Trend data - daily job creation and completion/cancellation (filtered by date range AND filters)
  const trendData = (() => {
    const days: Record<string, { date: string; created: number; completed: number; cancelled: number }> = {};
    
    // Count job creations in date range (with filters)
    const allJobs = [...jobs, ...archivedJobs].filter((job) => 
      matchesJobType(job.jobType) && matchesDestination(job.orderDestination)
    );
    
    allJobs.forEach(job => {
      const createdDate = 'originalCreatedAt' in job ? new Date(job.originalCreatedAt) : new Date(job.createdAt);
      if (isInDateRange(createdDate)) {
        const date = format(createdDate, 'MMM dd');
        if (!days[date]) days[date] = { date, created: 0, completed: 0, cancelled: 0 };
        days[date].created++;
      }
    });

    // Count completions in date range (already filtered)
    [...filteredArchivedJobs.filter((j) => j.finalStatus === "completed"), ...completedActiveJobs].forEach(job => {
      const completedDate = 'archivedAt' in job ? new Date(job.archivedAt) : new Date(job.statusChangedAt || job.createdAt);
      if (isInDateRange(completedDate)) {
        const date = format(completedDate, 'MMM dd');
        if (!days[date]) days[date] = { date, created: 0, completed: 0, cancelled: 0 };
        days[date].completed++;
      }
    });

    // Count cancellations in date range (already filtered)
    [...filteredArchivedJobs.filter((j) => j.finalStatus === "cancelled"), ...cancelledActiveJobs].forEach(job => {
      const cancelledDate = 'archivedAt' in job ? new Date(job.archivedAt) : new Date(job.statusChangedAt || job.createdAt);
      if (isInDateRange(cancelledDate)) {
        const date = format(cancelledDate, 'MMM dd');
        if (!days[date]) days[date] = { date, created: 0, completed: 0, cancelled: 0 };
        days[date].cancelled++;
      }
    });

    return Object.values(days).sort((a, b) => {
      const aDate = new Date(a.date + ', ' + new Date().getFullYear());
      const bDate = new Date(b.date + ', ' + new Date().getFullYear());
      return aDate.getTime() - bDate.getTime();
    }).slice(-14);
  })();

  return (
    <div className="space-y-6" data-testid="analytics-dashboard">
      {/* Filters / Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{periodLabel}</span>
          <span className="mx-2">·</span>
          <span>{jobTypeOptions.find((o) => o.value === selectedJobType)?.label ?? "All Job Types"}</span>
          <span className="mx-2">·</span>
          <span>{destinationOptions.find((o) => o.value === selectedDestination)?.label ?? "All Destinations"}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedJobType} onValueChange={setSelectedJobType}>
            <SelectTrigger className="w-[180px]" data-testid="select-job-type-filter">
              <SelectValue placeholder="Job type" />
            </SelectTrigger>
            <SelectContent>
              {jobTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedDestination} onValueChange={setSelectedDestination}>
            <SelectTrigger className="w-[200px]" data-testid="select-destination-filter">
              <SelectValue placeholder="Destination" />
            </SelectTrigger>
            <SelectContent>
              {destinationOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn("justify-start text-left font-normal")}
                data-testid="button-date-range"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(dateRange.from, "MMM d")} – {format(dateRange.to, "MMM d, yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="flex flex-col sm:flex-row">
                <div className="p-3 space-y-2 border-b sm:border-b-0 sm:border-r">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setDateRange({ from: subDays(new Date(), 7), to: new Date() })}
                  >
                    Last 7 days
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setDateRange({ from: subDays(new Date(), 30), to: new Date() })}
                  >
                    Last 30 days
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setDateRange({ from: subDays(new Date(), 90), to: new Date() })}
                  >
                    Last 90 days
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setDateRange({ from: startOfWeek(new Date()), to: endOfWeek(new Date()) })}
                  >
                    This week
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setDateRange({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) })}
                  >
                    This month
                  </Button>
                </div>

                <div className="p-3">
                  <Calendar
                    mode="range"
                    numberOfMonths={2}
                    selected={dateRange as any}
                    onSelect={(range: any) => {
                      if (range?.from && range?.to) {
                        setDateRange({ from: range.from, to: range.to });
                      }
                    }}
                    defaultMonth={dateRange.from}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedJobType("all");
              setSelectedDestination("all");
              setDateRange({ from: subDays(new Date(), 30), to: new Date() });
            }}
            data-testid="button-reset-filters"
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <Card data-testid="card-metric-backlog">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Backlog</p>
              <Package className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-1 text-3xl font-bold text-foreground" data-testid="text-metric-backlog">
              {totalActiveJobs}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {oldestBacklogDays != null ? `Oldest: ${oldestBacklogDays.toFixed(1)}d in status` : "No active jobs"}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-overdue">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Overdue</p>
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <p className="mt-1 text-3xl font-bold text-foreground" data-testid="text-metric-overdue">
              {overdueUniqueJobs.length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {overdueHighCount > 0 ? `${overdueHighCount} high/critical` : "No high/critical overdues"}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-starred">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Starred</p>
              <Star className="h-5 w-5 text-yellow-500" />
            </div>
            <p className="mt-1 text-3xl font-bold text-foreground" data-testid="text-metric-starred">
              {importantJobIds.size}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {starredWatchlist.filter((j) => j.hasNote).length > 0
                ? `${starredWatchlist.filter((j) => j.hasNote).length} with notes (recent)`
                : "Needs extra attention"}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-completed">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Completed</p>
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <p className="mt-1 text-3xl font-bold text-foreground" data-testid="text-metric-completed">
              {totalCompletedJobs}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {redoRatePct != null ? `Redo rate: ${redoRatePct.toFixed(1)}%` : "Redo rate: —"}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-cancelled">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Cancelled</p>
              <XCircle className="h-5 w-5 text-destructive" />
            </div>
            <p className="mt-1 text-3xl font-bold text-foreground" data-testid="text-metric-cancelled">
              {totalCancelledJobs}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {cancellationRatePct != null ? `Cancel rate: ${cancellationRatePct.toFixed(1)}%` : "Cancel rate: —"}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-avg-time">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Avg. Completion</p>
              <Clock className="h-5 w-5 text-info" />
            </div>
            <p className="mt-1 text-3xl font-bold text-foreground" data-testid="text-metric-avg-time">
              {avgCompletionTime === "N/A" ? "—" : `${avgCompletionTime}d`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {medianCompletionDays != null && p90CompletionDays != null
                ? `Median ${medianCompletionDays.toFixed(1)}d · P90 ${p90CompletionDays.toFixed(1)}d`
                : "No completed jobs in period"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-chart-status">
          <CardHeader>
            <CardTitle>Backlog by status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusChartData.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {statusChartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2">
                  {statusChartData.slice(0, 6).map((entry, index) => (
                    <div key={`${entry.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="truncate">{entry.name}</span>
                      </div>
                      <span className="tabular-nums">{entry.value}</span>
                    </div>
                  ))}
                  {statusChartData.length > 6 && (
                    <p className="text-xs text-muted-foreground">+ {statusChartData.length - 6} more</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-[240px] flex items-center justify-center text-muted-foreground">
                No active jobs to display
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-chart-job-types">
          <CardHeader className="space-y-1">
            <CardTitle>Jobs created by type</CardTitle>
            <p className="text-xs text-muted-foreground">{periodLabel}</p>
          </CardHeader>
          <CardContent>
            {jobTypeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={jobTypeChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => (String(value).length > 14 ? `${String(value).slice(0, 14)}…` : String(value))}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No jobs created in this period
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-chart-destinations">
          <CardHeader className="space-y-1">
            <CardTitle>Jobs created by destination</CardTitle>
            <p className="text-xs text-muted-foreground">{periodLabel}</p>
          </CardHeader>
          <CardContent>
            {destinationChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={destinationChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => (String(value).length > 14 ? `${String(value).slice(0, 14)}…` : String(value))}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--chart-2))" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No jobs created in this period
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-chart-completion-by-type">
          <CardHeader className="space-y-1">
            <CardTitle>Avg completion time by type</CardTitle>
            <p className="text-xs text-muted-foreground">{periodLabel}</p>
          </CardHeader>
          <CardContent>
            {completionTimeByTypeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={completionTimeByTypeChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => (String(value).length > 14 ? `${String(value).slice(0, 14)}…` : String(value))}
                  />
                  <YAxis />
                  <Tooltip formatter={(value) => [`${value} days`, "Avg completion"]} />
                  <Bar dataKey="days" fill="hsl(var(--chart-3))" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No completed jobs in this period
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trends + Watchlist */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card data-testid="card-chart-trends" className="xl:col-span-2">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Throughput trend
            </CardTitle>
            <p className="text-xs text-muted-foreground">{periodLabel}</p>
          </CardHeader>
          <CardContent>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="created" stroke="hsl(var(--primary))" strokeWidth={2} name="Created" />
                  <Line type="monotone" dataKey="completed" stroke="hsl(var(--success))" strokeWidth={2} name="Completed" />
                  <Line type="monotone" dataKey="cancelled" stroke="hsl(var(--destructive))" strokeWidth={2} name="Cancelled" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[320px] flex items-center justify-center text-muted-foreground">
                No trend data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-watchlist">
          <CardHeader>
            <CardTitle>Watchlist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Overdue hotspots
              </p>
              {overdueHotspots.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {overdueHotspots.slice(0, 3).map((h) => (
                    <div key={h.statusId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">{h.label}</span>
                      <span className="tabular-nums">{h.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">No overdue jobs.</p>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-sm font-semibold">Most overdue</p>
              {worstOverdueJobs.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {worstOverdueJobs.slice(0, 3).map((job: any) => (
                    <div key={job.id} className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-mono truncate">{job.orderId}</p>
                        <p className="text-xs text-muted-foreground truncate">{getStatusLabel(String(job.status || ""))}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{Number(job.daysOverdue || 0)}d</p>
                        <p className="text-xs text-muted-foreground">{String(job.severity || "").toUpperCase() || "—"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">No overdue jobs.</p>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-sm font-semibold">Oldest in status</p>
              {backlogWatchlist.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {backlogWatchlist.slice(0, 3).map((job) => (
                    <div key={job.id} className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-mono truncate">{job.orderId}</p>
                        <p className="text-xs text-muted-foreground truncate">{job.statusLabel}</p>
                      </div>
                      <p className="font-semibold tabular-nums">{job.ageDays.toFixed(1)}d</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">No active jobs.</p>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-sm font-semibold">Recently starred</p>
              {starredWatchlist.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {starredWatchlist.slice(0, 3).map((job) => (
                    <div key={job.id} className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-mono truncate">{job.orderId}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {job.flaggedBy ? `By ${job.flaggedBy}` : "Flagged"}
                          {job.hasNote ? " · Note" : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">No starred jobs.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
