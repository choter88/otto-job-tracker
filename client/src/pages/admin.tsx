import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  Building2, 
  Users, 
  Briefcase, 
  Clock, 
  Eye, 
  Power,
  Activity,
  CheckCircle,
  XCircle
} from "lucide-react";
import { format } from "date-fns";
import type { Office, PublicUser, AdminAuditLog } from "@shared/schema";

interface PlatformStats {
  totalOffices: number;
  activeOffices: number;
  totalUsers: number;
  totalJobs: number;
  avgCompletionTime: number | null;
}

interface OfficeWithStats extends Office {
  userCount: number;
  activeJobCount: number;
}

interface OfficeDetails {
  office: Office;
  users: PublicUser[];
  activeJobs: number;
  completedJobs: number;
  totalJobs: number;
}

interface ActivityLog extends AdminAuditLog {
  adminName: string;
}

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedOffice, setSelectedOffice] = useState<string | null>(null);
  const [officeToToggle, setOfficeToToggle] = useState<{ id: string; name: string; enabled: boolean } | null>(null);

  // Fetch platform stats
  const { data: stats, isLoading: statsLoading } = useQuery<PlatformStats>({
    queryKey: ["/api/admin/stats"],
    enabled: user?.role === "super_admin",
  });

  // Fetch all offices
  const { data: offices = [], isLoading: officesLoading } = useQuery<OfficeWithStats[]>({
    queryKey: ["/api/admin/offices"],
    enabled: user?.role === "super_admin",
  });

  // Fetch office details
  const { data: officeDetails, isLoading: detailsLoading } = useQuery<OfficeDetails>({
    queryKey: ["/api/admin/offices", selectedOffice],
    enabled: !!selectedOffice,
  });

  // Fetch recent activity
  const { data: activities = [], isLoading: activitiesLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/admin/activity"],
    enabled: user?.role === "super_admin",
  });

  // Toggle office status mutation
  const toggleOfficeMutation = useMutation({
    mutationFn: async ({ officeId, enabled }: { officeId: string; enabled: boolean }) => {
      return await apiRequest("PATCH", `/api/admin/offices/${officeId}/status`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/offices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Success",
        description: `Office ${officeToToggle?.enabled ? "disabled" : "enabled"} successfully`,
      });
      setOfficeToToggle(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update office status",
        variant: "destructive",
      });
      setOfficeToToggle(null);
    },
  });

  const handleToggleOffice = (office: OfficeWithStats) => {
    setOfficeToToggle({
      id: office.id,
      name: office.name,
      enabled: office.enabled,
    });
  };

  const confirmToggle = () => {
    if (officeToToggle) {
      toggleOfficeMutation.mutate({
        officeId: officeToToggle.id,
        enabled: !officeToToggle.enabled,
      });
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-admin-title">
              Super Admin Portal
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage offices, users, and monitor platform activity
            </p>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Platform KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <Card data-testid="card-total-offices">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Total Offices</p>
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-9 w-20 mb-1" />
                ) : (
                  <>
                    <p className="text-3xl font-bold text-foreground" data-testid="text-total-offices">
                      {stats?.totalOffices || 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1" data-testid="text-active-offices">
                      {stats?.activeOffices || 0} active
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-total-users">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Total Users</p>
                  <Users className="h-5 w-5 text-success" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-9 w-20" />
                ) : (
                  <p className="text-3xl font-bold text-foreground" data-testid="text-total-users">
                    {stats?.totalUsers || 0}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-total-jobs">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Total Jobs</p>
                  <Briefcase className="h-5 w-5 text-info" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-9 w-20 mb-1" />
                ) : (
                  <>
                    <p className="text-3xl font-bold text-foreground" data-testid="text-total-jobs">
                      {stats?.totalJobs || 0}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Active + Archived
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-avg-completion">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Avg Completion Time</p>
                  <Clock className="h-5 w-5 text-warning" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-9 w-20 mb-1" />
                ) : (
                  <>
                    <p className="text-3xl font-bold text-foreground" data-testid="text-avg-completion">
                      {stats?.avgCompletionTime?.toFixed(1) || "0.0"}d
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Days on average
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Office Management Section */}
          <Card className="mb-6" data-testid="card-office-management">
            <div className="p-6 border-b border-border">
              <h2 className="text-xl font-semibold text-foreground">Office Management</h2>
              <p className="text-sm text-muted-foreground">Manage all offices on the platform</p>
            </div>
            <div className="overflow-x-auto">
              <Table className="table-fixed">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[18%]" data-testid="header-office-name">Office Name</TableHead>
                    <TableHead className="w-[20%]" data-testid="header-email">Email</TableHead>
                    <TableHead className="w-[12%]" data-testid="header-phone">Phone</TableHead>
                    <TableHead className="w-[9%]" data-testid="header-users">Users</TableHead>
                    <TableHead className="w-[9%]" data-testid="header-jobs">Jobs</TableHead>
                    <TableHead className="w-[10%]" data-testid="header-status">Status</TableHead>
                    <TableHead className="w-[22%]" data-testid="header-actions">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {officesLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                      </TableRow>
                    ))
                  ) : offices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No offices found
                      </TableCell>
                    </TableRow>
                  ) : (
                    offices.map((office) => (
                      <TableRow key={office.id} data-testid={`row-office-${office.id}`}>
                        <TableCell className="font-medium truncate" data-testid={`text-office-name-${office.id}`}>
                          {office.name}
                        </TableCell>
                        <TableCell className="truncate text-muted-foreground" data-testid={`text-office-email-${office.id}`}>
                          {office.email || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground" data-testid={`text-office-phone-${office.id}`}>
                          {office.phone || "—"}
                        </TableCell>
                        <TableCell data-testid={`text-office-users-${office.id}`}>
                          {office.userCount}
                        </TableCell>
                        <TableCell data-testid={`text-office-jobs-${office.id}`}>
                          {office.activeJobCount}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={office.enabled ? "default" : "secondary"}
                            data-testid={`badge-office-status-${office.id}`}
                          >
                            {office.enabled ? (
                              <><CheckCircle className="h-3 w-3 mr-1" /> Enabled</>
                            ) : (
                              <><XCircle className="h-3 w-3 mr-1" /> Disabled</>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedOffice(office.id)}
                              data-testid={`button-view-details-${office.id}`}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View Details
                            </Button>
                            <Button
                              variant={office.enabled ? "destructive" : "default"}
                              size="sm"
                              onClick={() => handleToggleOffice(office)}
                              data-testid={`button-toggle-status-${office.id}`}
                            >
                              <Power className="h-4 w-4 mr-1" />
                              {office.enabled ? "Disable" : "Enable"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Recent Activity Section */}
          <Card data-testid="card-recent-activity">
            <div className="p-6 border-b border-border">
              <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Recent Activity
              </h2>
              <p className="text-sm text-muted-foreground">Last 10 admin actions</p>
            </div>
            <div className="overflow-x-auto">
              <Table className="table-fixed">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[25%]" data-testid="header-timestamp">Timestamp</TableHead>
                    <TableHead className="w-[20%]" data-testid="header-admin">Admin</TableHead>
                    <TableHead className="w-[30%]" data-testid="header-action">Action</TableHead>
                    <TableHead className="w-[25%]" data-testid="header-target">Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activitiesLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      </TableRow>
                    ))
                  ) : activities.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No activity logs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    activities.map((activity) => (
                      <TableRow key={activity.id} data-testid={`row-activity-${activity.id}`}>
                        <TableCell data-testid={`text-activity-time-${activity.id}`}>
                          {format(new Date(activity.createdAt), "MMM dd, yyyy HH:mm")}
                        </TableCell>
                        <TableCell data-testid={`text-activity-admin-${activity.id}`}>
                          {activity.adminName}
                        </TableCell>
                        <TableCell data-testid={`text-activity-action-${activity.id}`}>
                          {activity.action}
                        </TableCell>
                        <TableCell data-testid={`text-activity-target-${activity.id}`}>
                          {activity.targetType}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </main>

      {/* Office Details Modal */}
      <Dialog open={!!selectedOffice} onOpenChange={() => setSelectedOffice(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-office-details">
          <DialogHeader>
            <DialogTitle>Office Details</DialogTitle>
            <DialogDescription>
              View detailed information about this office
            </DialogDescription>
          </DialogHeader>
          
          {detailsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : officeDetails ? (
            <div className="space-y-6">
              {/* Office Info */}
              <div>
                <h3 className="font-semibold mb-3">Office Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Name</p>
                    <p className="font-medium" data-testid="text-details-office-name">
                      {officeDetails.office.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p className="font-medium" data-testid="text-details-office-email">
                      {officeDetails.office.email || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <p className="font-medium" data-testid="text-details-office-phone">
                      {officeDetails.office.phone || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant={officeDetails.office.enabled ? "default" : "secondary"} data-testid="badge-details-status">
                      {officeDetails.office.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Users */}
              <div>
                <h3 className="font-semibold mb-3">Users ({officeDetails.users.length})</h3>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {officeDetails.users.map((user) => (
                        <TableRow key={user.id} data-testid={`row-details-user-${user.id}`}>
                          <TableCell>{user.firstName} {user.lastName}</TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {user.role}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Job Stats */}
              <div>
                <h3 className="font-semibold mb-3">Job Statistics</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground">Active Jobs</p>
                    <p className="text-2xl font-bold" data-testid="text-details-active-jobs">
                      {officeDetails.activeJobs}
                    </p>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground">Completed Jobs</p>
                    <p className="text-2xl font-bold" data-testid="text-details-completed-jobs">
                      {officeDetails.completedJobs}
                    </p>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground">Total Jobs</p>
                    <p className="text-2xl font-bold" data-testid="text-details-total-jobs">
                      {officeDetails.totalJobs}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!officeToToggle} onOpenChange={() => setOfficeToToggle(null)}>
        <AlertDialogContent data-testid="dialog-confirm-toggle">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {officeToToggle?.enabled ? "Disable" : "Enable"} Office?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {officeToToggle?.enabled ? "disable" : "enable"} "{officeToToggle?.name}"?
              {officeToToggle?.enabled && " Users will no longer be able to access this office."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-toggle">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmToggle}
              data-testid="button-confirm-toggle"
            >
              {officeToToggle?.enabled ? "Disable" : "Enable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
