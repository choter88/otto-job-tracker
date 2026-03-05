import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Users, Trash2, Clock, Check, X, KeyRound } from "lucide-react";
import { format } from "date-fns";
import type { PublicUser } from "@shared/schema";

type AssignableRole = "manager" | "staff" | "view_only";

type AccountSignupRequest = {
  id: string;
  email: string;
  loginId: string | null;
  firstName: string;
  lastName: string;
  requestedRole: string;
  requestMessage: string | null;
  requestedByIp: string | null;
  userAgent: string | null;
  createdAt: string;
};

type PinResetRequestItem = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  loginId: string | null;
  status: string;
  createdAt: string;
};

export default function TeamPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [requestRoles, setRequestRoles] = useState<Record<string, AssignableRole>>({});

  const canManageTeam = user?.role === "owner" || user?.role === "manager";

  const { data: members = [] } = useQuery<PublicUser[]>({
    queryKey: ["/api/offices", user?.officeId, "members"],
    enabled: !!user?.officeId,
  });

  const { data: accountRequests = [] } = useQuery<AccountSignupRequest[]>({
    queryKey: ["/api/offices", user?.officeId, "account-requests"],
    enabled: !!user?.officeId && canManageTeam,
  });

  const { data: pinResetRequests = [] } = useQuery<PinResetRequestItem[]>({
    queryKey: ["/api/offices", user?.officeId, "pin-reset-requests"],
    enabled: !!user?.officeId && canManageTeam,
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("PUT", `/api/users/${userId}`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "members"] });
      toast({
        title: "Success",
        description: "User role updated successfully.",
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

  const removeUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("PUT", `/api/users/${userId}`, {
        officeId: null,
        role: "staff",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "members"] });
      toast({
        title: "Success",
        description: "User removed from office successfully.",
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

  const approveRequestMutation = useMutation({
    mutationFn: async ({ requestId, role }: { requestId: string; role: AssignableRole }) => {
      const res = await apiRequest("POST", `/api/account-requests/${requestId}/approve`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "account-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", "recent"] });
      toast({
        title: "Request approved",
        description: "Account created and added to the team.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not approve request",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const rejectRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      await apiRequest("DELETE", `/api/account-requests/${requestId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "account-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", "recent"] });
      toast({
        title: "Request rejected",
        description: "The pending account request was rejected.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not reject request",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const approvePinResetMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await apiRequest("POST", `/api/pin-reset-requests/${requestId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "pin-reset-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", "recent"] });
      toast({
        title: "PIN reset approved",
        description: "The user's PIN has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not approve PIN reset",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const rejectPinResetMutation = useMutation({
    mutationFn: async (requestId: string) => {
      await apiRequest("DELETE", `/api/pin-reset-requests/${requestId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "pin-reset-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", "recent"] });
      toast({
        title: "PIN reset rejected",
        description: "The PIN reset request was rejected.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not reject PIN reset",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRoleChange = (userId: string, newRole: string) => {
    updateUserRoleMutation.mutate({ userId, role: newRole });
  };

  const handleRemoveUser = (userId: string, userName: string) => {
    if (confirm(`Are you sure you want to remove ${userName} from this office?`)) {
      removeUserMutation.mutate(userId);
    }
  };

  const handleApproveRequest = (request: AccountSignupRequest) => {
    const selected = requestRoles[request.id] || "staff";
    approveRequestMutation.mutate({ requestId: request.id, role: selected });
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  };

  const getRoleBadgeVariant = (role: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      owner: "default",
      manager: "secondary",
      staff: "outline",
      view_only: "outline",
    };
    return variants[role] || "outline";
  };

  const canManageMember = (member: PublicUser): boolean => {
    if (!canManageTeam) return false;
    if (member.id === user?.id) return false;
    if (user?.role === "owner") return true;
    return member.role !== "owner" && member.role !== "manager";
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            New account onboarding
          </CardTitle>
          <CardDescription>
            Team members can request access from the sign-in screen. Approve or reject requests below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {canManageTeam
              ? "Pending requests appear in Team and Notifications."
              : "Owners and managers can review account requests."}
          </p>
        </CardContent>
      </Card>

      {canManageTeam && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Pending Account Requests
              <Badge variant={accountRequests.length > 0 ? "destructive" : "secondary"}>{accountRequests.length}</Badge>
            </CardTitle>
            <CardDescription>Approve a request to create that user account and add them to this office.</CardDescription>
          </CardHeader>
          <CardContent>
            {accountRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending account requests.</p>
            ) : (
              <div className="space-y-3">
                {accountRequests.map((request) => {
                  const defaultRole: AssignableRole =
                    request.requestedRole === "manager" || request.requestedRole === "view_only"
                      ? request.requestedRole
                      : "staff";
                  const selectedRole: AssignableRole = requestRoles[request.id] || defaultRole;
                  const canAssignManager = user?.role === "owner";

                  return (
                    <div key={request.id} className="rounded-lg border p-4" data-testid={`account-request-${request.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {request.firstName} {request.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground">Login ID: {request.loginId || "Not provided"}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">{format(new Date(request.createdAt), "MMM d, h:mm a")}</p>
                      </div>

                      {request.requestMessage && (
                        <p className="mt-2 text-sm text-muted-foreground">"{request.requestMessage}"</p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Select
                          value={selectedRole}
                          onValueChange={(value) => {
                            if (value === "manager" || value === "staff" || value === "view_only") {
                              setRequestRoles((prev) => ({ ...prev, [request.id]: value }));
                            }
                          }}
                        >
                          <SelectTrigger className="w-40" data-testid={`select-request-role-${request.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {canAssignManager && <SelectItem value="manager">Manager</SelectItem>}
                            <SelectItem value="staff">Staff</SelectItem>
                            <SelectItem value="view_only">View Only</SelectItem>
                          </SelectContent>
                        </Select>

                        <Button
                          onClick={() => handleApproveRequest(request)}
                          disabled={approveRequestMutation.isPending}
                          data-testid={`button-approve-request-${request.id}`}
                        >
                          <Check className="mr-2 h-4 w-4" />
                          Approve
                        </Button>

                        <Button
                          variant="outline"
                          onClick={() => rejectRequestMutation.mutate(request.id)}
                          disabled={rejectRequestMutation.isPending}
                          data-testid={`button-reject-request-${request.id}`}
                        >
                          <X className="mr-2 h-4 w-4" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canManageTeam && pinResetRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Pending PIN Resets
              <Badge variant="destructive">{pinResetRequests.length}</Badge>
            </CardTitle>
            <CardDescription>Approve a request to update that user's PIN so they can sign in again.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pinResetRequests.map((request) => (
                <div key={request.id} className="rounded-lg border p-4" data-testid={`pin-reset-request-${request.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {request.firstName} {request.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground">Login ID: {request.loginId || "Unknown"}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{format(new Date(request.createdAt), "MMM d, h:mm a")}</p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => approvePinResetMutation.mutate(request.id)}
                      disabled={approvePinResetMutation.isPending}
                      data-testid={`button-approve-pin-reset-${request.id}`}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Approve
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => rejectPinResetMutation.mutate(request.id)}
                      disabled={rejectPinResetMutation.isPending}
                      data-testid={`button-reject-pin-reset-${request.id}`}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Team Members</h2>
          {members.length > 0 && <Badge variant="secondary">{members.length}</Badge>}
        </div>
      </div>

      {members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold text-foreground">No Team Members</h3>
            <p className="text-sm text-muted-foreground">Your team members will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {members.map((member) => (
            <Card key={member.id} data-testid={`member-${member.id}`}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-lg font-semibold text-primary">
                  {getInitials(member.firstName, member.lastName)}
                </div>

                <div className="flex-1">
                  <h4 className="font-semibold">
                    {member.firstName} {member.lastName}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Login ID: {member.loginId || "Legacy account"}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {canManageMember(member) ? (
                    <>
                      <Select
                        value={member.role}
                        onValueChange={(value) => handleRoleChange(member.id, value)}
                        data-testid={`select-role-${member.id}`}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {user?.role === "owner" && <SelectItem value="owner">Owner</SelectItem>}
                          {user?.role === "owner" && <SelectItem value="manager">Manager</SelectItem>}
                          <SelectItem value="staff">Staff</SelectItem>
                          <SelectItem value="view_only">View Only</SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveUser(member.id, `${member.firstName} ${member.lastName}`)}
                        data-testid={`button-remove-${member.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  ) : (
                    <Badge variant={getRoleBadgeVariant(member.role)} className="capitalize">
                      {member.role.replace("_", " ")}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
