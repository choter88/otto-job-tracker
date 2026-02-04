import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Users, Clock, X, Trash2, Check, UserPlus, Copy } from "lucide-react";
import { format } from "date-fns";
import type { User, JoinRequestWithRequester } from "@shared/schema";

export default function TeamPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("members");

  const { data: members = [] } = useQuery<User[]>({
    queryKey: ["/api/offices", user?.officeId, "members"],
    enabled: !!user?.officeId,
  });

  const { data: joinRequests = [] } = useQuery<JoinRequestWithRequester[]>({
    queryKey: ["/api/offices", user?.officeId, "join-requests"],
    enabled: !!user?.officeId,
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

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    role: "staff",
    message: "",
  });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  const createInvitationMutation = useMutation({
    mutationFn: async (data: { email: string; role: string; message?: string }) => {
      const res = await apiRequest("POST", "/api/invitations", data);
      return res.json();
    },
    onSuccess: (data) => {
      setInviteDialogOpen(false);
      setInviteForm({ email: "", role: "staff", message: "" });
      const url = `${window.location.origin}/accept-invite/${data.token}`;
      setInviteUrl(url);
      setShowInviteDialog(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSendInvite = () => {
    if (!inviteForm.email) {
      toast({
        title: "Error",
        description: "Please enter an email address",
        variant: "destructive",
      });
      return;
    }
    createInvitationMutation.mutate(inviteForm);
  };

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

  const getRoleBadgeVariant = (role: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      owner: "default",
      manager: "secondary",
      staff: "outline",
      view_only: "outline",
    };
    return variants[role] || "outline";
  };

  const canManageTeam = user?.role === 'owner' || user?.role === 'manager';

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="members" data-testid="tab-members">
              <Users className="mr-2 h-4 w-4" />
              Team Members
              {members.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {members.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="requests" data-testid="tab-requests">
              <Clock className="mr-2 h-4 w-4" />
              Join Requests
              {joinRequests.length > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {joinRequests.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {user?.role === 'owner' && (
            <Button 
              onClick={() => setInviteDialogOpen(true)}
              data-testid="button-invite"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Invite
            </Button>
          )}
        </div>

        <TabsContent value="members" className="mt-6 space-y-4">
          {members.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No Team Members</h3>
                <p className="text-sm text-muted-foreground">Invite people to join your office to get started.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {members.map((member: any) => (
                <Card key={member.id} data-testid={`member-${member.id}`}>
                  <CardContent className="flex items-center gap-4 py-4">
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
                      {canManageTeam && member.id !== user?.id ? (
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
                            data-testid={`button-remove-${member.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      ) : (
                        <Badge variant={getRoleBadgeVariant(member.role)} className="capitalize">
                          {member.role.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="requests" className="mt-6 space-y-4">
          {joinRequests.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No Pending Requests</h3>
                <p className="text-sm text-muted-foreground">Join requests will appear here when users request to join your office.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {joinRequests.map((request: any) => (
                <Card key={request.id} data-testid={`request-${request.id}`}>
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center text-primary font-semibold text-lg">
                        {getInitials(request.requester.firstName, request.requester.lastName)}
                      </div>

                      <div className="flex-1">
                        <h4 className="font-semibold">
                          {request.requester.firstName} {request.requester.lastName}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {request.requester.email}
                        </p>
                        {request.message && (
                          <p className="text-sm mt-2 bg-muted p-3 rounded-md">
                            {request.message}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          Requested {format(new Date(request.createdAt), 'MMM d, yyyy')}
                        </p>
                      </div>

                      {canManageTeam && (
                        <div className="flex items-center gap-2">
                          <Select
                            defaultValue="staff"
                            onValueChange={(role) => handleApproveRequest(request.id, role)}
                            data-testid={`select-approve-role-${request.id}`}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manager">Approve as Manager</SelectItem>
                              <SelectItem value="staff">Approve as Staff</SelectItem>
                              <SelectItem value="view_only">Approve as View Only</SelectItem>
                            </SelectContent>
                          </Select>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRejectRequest(request.id)}
                            data-testid={`button-reject-${request.id}`}
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent data-testid="dialog-invite">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join your office. The invitee will receive a link to accept the invitation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="colleague@example.com"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                data-testid="input-invite-email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
              >
                <SelectTrigger id="role" data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="view_only">View Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">Personal Message (Optional)</Label>
              <Textarea
                id="message"
                placeholder="Add a personal message to the invitation..."
                value={inviteForm.message}
                onChange={(e) => setInviteForm({ ...inviteForm, message: e.target.value })}
                rows={3}
                data-testid="textarea-invite-message"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteDialogOpen(false)}
              data-testid="button-cancel-invite"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendInvite}
              disabled={createInvitationMutation.isPending}
              data-testid="button-send-invite"
            >
              {createInvitationMutation.isPending ? "Sending..." : "Send Invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-invite-link">
          <DialogHeader>
            <DialogTitle>Invitation Link Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Share this link with the invitee to join your team:
            </p>
            <div className="flex items-center gap-2">
              <Input 
                value={inviteUrl || ""} 
                readOnly 
                className="flex-1"
                onClick={(e) => (e.target as HTMLInputElement).select()}
                data-testid="input-invite-url"
              />
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteUrl || "");
                    toast({
                      title: "Copied!",
                      description: "Link copied to clipboard",
                    });
                  } catch {
                    toast({
                      title: "Copy Failed",
                      description: "Please manually copy the link above",
                      variant: "destructive"
                    });
                  }
                }}
                data-testid="button-copy-invite"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Click the link to select all, then copy manually if the Copy button doesn't work.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
