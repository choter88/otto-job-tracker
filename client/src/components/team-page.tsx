import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Users, Trash2, Copy, KeyRound } from "lucide-react";
import type { User } from "@shared/schema";

export default function TeamPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [staffCodeDialogOpen, setStaffCodeDialogOpen] = useState(false);
  const [generatedStaffCode, setGeneratedStaffCode] = useState<string | null>(null);

  const { data: members = [] } = useQuery<User[]>({
    queryKey: ["/api/offices", user?.officeId, "members"],
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

  const generateStaffCodeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/setup/staff-code/regenerate");
      return (await res.json()) as { staffCode: string };
    },
    onSuccess: (data) => {
      setGeneratedStaffCode(data.staffCode);
      setStaffCodeDialogOpen(true);
      toast({
        title: "Staff code generated",
        description: "Share it with the new team member to create their login.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not generate staff code",
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Add a team member
          </CardTitle>
          <CardDescription>
            Generate a Staff code and give it to the new team member. They’ll use it once on the <b>Sign Up</b> screen.
            Generating a new code replaces the old one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {user?.role === "owner" ? (
            <Button
              onClick={() => generateStaffCodeMutation.mutate()}
              disabled={generateStaffCodeMutation.isPending}
              data-testid="button-generate-staff-code"
            >
              Generate Staff code
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Ask the office owner to generate a Staff code.</p>
          )}
        </CardContent>
      </Card>

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
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Team Members</h3>
            <p className="text-sm text-muted-foreground">Your team members will appear here.</p>
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
                  <p className="text-sm text-muted-foreground">{member.email}</p>
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
                      {member.role.replace("_", " ")}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={staffCodeDialogOpen} onOpenChange={setStaffCodeDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-staff-code">
          <DialogHeader>
            <DialogTitle>Staff code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Share this code with the new team member. They’ll enter it once when signing up.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={generatedStaffCode || ""}
                readOnly
                className="flex-1"
                onClick={(e) => (e.target as HTMLInputElement).select()}
                data-testid="input-staff-code"
              />
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(generatedStaffCode || "");
                    toast({ title: "Copied", description: "Staff code copied to clipboard." });
                  } catch {
                    toast({
                      title: "Copy failed",
                      description: "Please manually copy the staff code above.",
                      variant: "destructive",
                    });
                  }
                }}
                data-testid="button-copy-staff-code"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Generating a new Staff code will replace the old one.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
