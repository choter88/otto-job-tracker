import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Users, Clock, Check, X, Trash2, UserPlus } from "lucide-react";
import { format } from "date-fns";

interface PeopleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function PeopleModal({ open, onOpenChange }: PeopleModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("members");

  const { data: members = [] } = useQuery({
    queryKey: ["/api/offices", user?.officeId, "members"],
    enabled: !!user?.officeId && open,
  });

  const { data: joinRequests = [] } = useQuery({
    queryKey: ["/api/offices", user?.officeId, "join-requests"],
    enabled: !!user?.officeId && open,
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
        role: "staff" 
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

  const approveJoinRequestMutation = useMutation({
    mutationFn: async ({ requestId, role }: { requestId: string; role: string }) => {
      const res = await apiRequest("POST", `/api/join-requests/${requestId}/approve`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "join-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "members"] });
      toast({
        title: "Success",
        description: "Join request approved successfully.",
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

  const rejectJoinRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      await apiRequest("DELETE", `/api/join-requests/${requestId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offices", user?.officeId, "join-requests"] });
      toast({
        title: "Success",
        description: "Join request rejected.",
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

  const handleRoleChange = (userId: string, newRole: string) => {
    updateUserRoleMutation.mutate({ userId, role: newRole });
  };

  const handleRemoveUser = (userId: string, userName: string) => {
    if (confirm(`Are you sure you want to remove ${userName} from this office?`)) {
      removeUserMutation.mutate(userId);
    }
  };

  const handleApproveRequest = (requestId: string, role: string) => {
    approveJoinRequestMutation.mutate({ requestId, role });
  };

  const handleRejectRequest = (requestId: string) => {
    rejectJoinRequestMutation.mutate(requestId);
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      owner: "bg-purple-100 text-purple-800",
      manager: "bg-blue-100 text-blue-800", 
      staff: "bg-green-100 text-green-800",
      view_only: "bg-gray-100 text-gray-800",
    };
    return colors[role] || colors.staff;
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-fade-in">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Users className="h-6 w-6" />
            Team Management
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Manage office members and join requests
          </p>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="border-b border-border justify-start bg-transparent p-0 h-auto">
            <TabsTrigger 
              value="members"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              data-testid="tab-members"
            >
              <Users className="mr-2 h-4 w-4" />
              Team Members
              {members.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {members.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="requests"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
              data-testid="tab-requests"
            >
              <Clock className="mr-2 h-4 w-4" />
              Join Requests
              {joinRequests.length > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {joinRequests.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="members" className="p-6 mt-0">
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Office Members</h3>
                  <Button data-testid="button-invite-member">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Invite Member
                  </Button>
                </div>

                <div className="space-y-3">
                  {members.map((member: any) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg"
                      data-testid={`member-${member.id}`}
                    >
                      <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center text-primary font-semibold text-lg">
                        {getInitials(member.firstName, member.lastName)}
                      </div>

                      <div className="flex-1">
                        <h4 className="font-semibold">
                          {member.firstName} {member.lastName}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {member.email}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <Select
                          value={member.role}
                          onValueChange={(newRole) => handleRoleChange(member.id, newRole)}
                          disabled={member.id === user?.id || updateUserRoleMutation.isPending}
                        >
                          <SelectTrigger className="w-32" data-testid={`select-role-${member.id}`}>
                            <Badge className={getRoleBadgeColor(member.role)}>
                              {member.role.charAt(0).toUpperCase() + member.role.slice(1).replace('_', ' ')}
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Owner</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="staff">Staff</SelectItem>
                            <SelectItem value="view_only">View Only</SelectItem>
                          </SelectContent>
                        </Select>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveUser(member.id, `${member.firstName} ${member.lastName}`)}
                          disabled={member.id === user?.id || removeUserMutation.isPending}
                          data-testid={`button-remove-${member.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {members.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No team members found.
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="requests" className="p-6 mt-0">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Pending Join Requests</h3>

                <div className="space-y-4">
                  {joinRequests.map((request: any) => (
                    <div
                      key={request.id}
                      className="p-4 bg-card border border-border rounded-lg"
                      data-testid={`request-${request.id}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-warning/20 rounded-full flex items-center justify-center text-warning font-semibold text-lg">
                            {getInitials(request.requester.firstName, request.requester.lastName)}
                          </div>
                          <div>
                            <h4 className="font-semibold">
                              {request.requester.firstName} {request.requester.lastName}
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              {request.requester.email}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(request.createdAt), 'MMM d, h:mm a')}
                        </span>
                      </div>

                      {request.message && (
                        <p className="text-sm text-muted-foreground mb-4 pl-15">
                          "{request.message}"
                        </p>
                      )}

                      <div className="flex items-center gap-2 pl-15">
                        <Select
                          defaultValue="staff"
                          onValueChange={(role) => {
                            // Store selected role for approval
                            (document.getElementById(`approve-${request.id}`) as any)?.setAttribute('data-role', role);
                          }}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="staff">Staff</SelectItem>
                            <SelectItem value="view_only">View Only</SelectItem>
                          </SelectContent>
                        </Select>

                        <Button
                          id={`approve-${request.id}`}
                          onClick={(e) => {
                            const role = (e.target as any).getAttribute('data-role') || 'staff';
                            handleApproveRequest(request.id, role);
                          }}
                          disabled={approveJoinRequestMutation.isPending}
                          data-testid={`button-approve-${request.id}`}
                        >
                          <Check className="mr-2 h-4 w-4" />
                          Approve
                        </Button>

                        <Button
                          variant="outline"
                          onClick={() => handleRejectRequest(request.id)}
                          disabled={rejectJoinRequestMutation.isPending}
                          data-testid={`button-reject-${request.id}`}
                        >
                          <X className="mr-2 h-4 w-4" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}

                  {joinRequests.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No pending join requests.
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
