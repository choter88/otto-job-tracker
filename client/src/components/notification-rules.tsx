import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, Save, AlertTriangle, Bell } from "lucide-react";
import type { NotificationRule } from "@shared/schema";

const notificationRuleSchema = z.object({
  status: z.string({
    required_error: "Please select a status",
  }).min(1, "Please select a status"),
  maxDays: z.number().min(1, "Must be at least 1 day").max(365, "Cannot exceed 365 days"),
  enabled: z.boolean(),
  smsEnabled: z.boolean(),
  smsTemplate: z.string().optional(),
  notifyRoles: z.array(z.string()),
});

type NotificationRuleFormData = z.infer<typeof notificationRuleSchema>;

export default function NotificationRules() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: notificationRules = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/notification-rules"],
    enabled: !!user?.officeId,
  });

  const { data: office } = useQuery<Record<string, any>>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const form = useForm<NotificationRuleFormData>({
    resolver: zodResolver(notificationRuleSchema),
    defaultValues: {
      status: "ordered",
      maxDays: 7,
      enabled: true,
      smsEnabled: false,
      smsTemplate: "",
      notifyRoles: ["owner", "manager"],
    },
  });

  const createRuleMutation = useMutation({
    mutationFn: async (data: NotificationRuleFormData) => {
      const res = await apiRequest("POST", "/api/notification-rules", data);
      return res.json();
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["/api/notification-rules"] });
      
      const previousRules = queryClient.getQueryData(["/api/notification-rules"]);
      
      const optimisticRule = {
        id: `temp-${Date.now()}`,
        officeId: user?.officeId || '',
        ...data,
        createdAt: new Date(),
      };
      
      queryClient.setQueryData(["/api/notification-rules"], (old: NotificationRule[] | undefined) => 
        old ? [...old, optimisticRule as NotificationRule] : [optimisticRule as NotificationRule]
      );
      
      return { previousRules };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/notification-rules"], context?.previousRules);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Notification rule created successfully.",
      });
      setShowAddForm(false);
      form.reset();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/overdue"] });
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<NotificationRuleFormData> }) => {
      const res = await apiRequest("PUT", `/api/notification-rules/${id}`, data);
      return res.json();
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/notification-rules"] });
      
      const previousRules = queryClient.getQueryData(["/api/notification-rules"]);
      
      queryClient.setQueryData(["/api/notification-rules"], (old: NotificationRule[] | undefined) => 
        old ? old.map(rule => rule.id === id ? { ...rule, ...data } : rule) : []
      );
      
      return { previousRules };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/notification-rules"], context?.previousRules);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Notification rule updated successfully.",
      });
      setEditingRule(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/overdue"] });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/notification-rules/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["/api/notification-rules"] });
      
      const previousRules = queryClient.getQueryData(["/api/notification-rules"]);
      
      queryClient.setQueryData(["/api/notification-rules"], (old: NotificationRule[] | undefined) => 
        old ? old.filter(rule => rule.id !== id) : []
      );
      
      return { previousRules };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/notification-rules"], context?.previousRules);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Notification rule deleted successfully.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/overdue"] });
    },
  });

  const onSubmit = (data: NotificationRuleFormData) => {
    const normalized: NotificationRuleFormData = {
      ...data,
      // Desktop/offline mode: no automatic SMS sending.
      smsEnabled: false,
      smsTemplate: "",
    };
    if (editingRule) {
      updateRuleMutation.mutate({ id: editingRule.id, data: normalized });
    } else {
      createRuleMutation.mutate(normalized);
    }
  };

  const handleEdit = (rule: NotificationRule) => {
    setEditingRule(rule);
    form.reset({
      status: rule.status,
      maxDays: rule.maxDays,
      enabled: rule.enabled,
      smsEnabled: rule.smsEnabled,
      smsTemplate: rule.smsTemplate || "",
      notifyRoles: Array.isArray(rule.notifyRoles) ? rule.notifyRoles : [],
    });
    setShowAddForm(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this notification rule?")) {
      deleteRuleMutation.mutate(id);
    }
  };

  const handleAddNew = () => {
    setEditingRule(null);
    form.reset();
    setShowAddForm(true);
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditingRule(null);
    form.reset();
  };

  const customStatuses = office?.settings?.customStatuses || [];

  const getStatusLabel = (status: string) => {
    const customStatus = customStatuses.find((s: any) => s.id === status);
    if (customStatus) return customStatus.label;
    
    return status.replace('_', ' ').split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="text-muted-foreground">Loading notification rules...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="notification-rules">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold mb-2">Overdue Rules</h3>
          <p className="text-sm text-muted-foreground">
            Set how long a job can stay in a status before it’s considered overdue
          </p>
        </div>
        <Button onClick={handleAddNew} data-testid="button-add-rule">
          <Plus className="mr-2 h-4 w-4" />
          Add Rule
        </Button>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bell className="h-5 w-5" />
              {editingRule ? "Edit Notification Rule" : "Add Notification Rule"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="status">Job Status *</Label>
                  <Controller
                    name="status"
                    control={form.control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger data-testid="select-rule-status">
                          <SelectValue placeholder="Select status..." />
                        </SelectTrigger>
                        <SelectContent>
                          {customStatuses.length > 0 ? (
                            customStatuses
                              .filter((s: any) => s.id !== 'completed' && s.id !== 'cancelled')
                              .map((status: any) => (
                                <SelectItem key={status.id} value={status.id}>
                                  {status.label}
                                </SelectItem>
                              ))
                          ) : (
                            <>
                              <SelectItem value="job_created">Job Created</SelectItem>
                              <SelectItem value="ordered">Ordered</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="quality_check">Quality Check</SelectItem>
                              <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {form.formState.errors.status && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.status.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxDays">Max Days in Status *</Label>
                  <Input
                    id="maxDays"
                    type="number"
                    min="1"
                    max="365"
                    {...form.register("maxDays", { valueAsNumber: true })}
                    data-testid="input-max-days"
                  />
                  {form.formState.errors.maxDays && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.maxDays.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="enabled" className="text-base font-medium">
                      Enable Rule
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Turn this notification rule on or off
                    </p>
                  </div>
                  <Controller
                    name="enabled"
                    control={form.control}
                    render={({ field }) => (
                      <Switch
                        id="enabled"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-rule-enabled"
                      />
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notifyRoles">Notify Roles</Label>
                  <div className="space-y-2">
                    {["owner", "manager", "staff"].map((role) => (
                      <label key={role} className="flex items-center space-x-2 cursor-pointer">
                        <Controller
                          name="notifyRoles"
                          control={form.control}
                          render={({ field }) => (
                            <input
                              type="checkbox"
                              checked={field.value.includes(role)}
                              onChange={(e) => {
                                const updatedRoles = e.target.checked
                                  ? [...field.value, role]
                                  : field.value.filter(r => r !== role);
                                field.onChange(updatedRoles);
                              }}
                              className="rounded border border-border accent-primary"
                              data-testid={`checkbox-role-${role}`}
                            />
                          )}
                        />
                        <span className="text-sm capitalize">
                          {role.replace('_', ' ')}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-border">
                <Button
                  type="submit"
                  disabled={createRuleMutation.isPending || updateRuleMutation.isPending}
                  data-testid="button-save-rule"
                >
                  {(createRuleMutation.isPending || updateRuleMutation.isPending) && (
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-primary" />
                  )}
                  <Save className="mr-2 h-4 w-4" />
                  {editingRule ? "Update Rule" : "Create Rule"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  data-testid="button-cancel-rule"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Existing Rules */}
      <div className="space-y-4">
        {notificationRules.length === 0 && !showAddForm ? (
          <Card>
            <CardContent className="p-8 text-center">
              <div className="space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-muted rounded-full">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold">No Notification Rules</h3>
                <p className="text-muted-foreground">
                  Create notification rules to get alerts when jobs are overdue.
                </p>
                <Button onClick={handleAddNew}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Your First Rule
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          notificationRules.map((rule: NotificationRule) => (
            <Card key={rule.id} className={!rule.enabled ? "opacity-60" : ""} data-testid={`rule-${rule.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-lg">
                        {getStatusLabel(rule.status)} Status
                      </h3>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(enabled) => 
                            updateRuleMutation.mutate({ id: rule.id, data: { enabled } })
                          }
                          data-testid={`switch-enabled-${rule.id}`}
                        />
                        <span className="text-sm font-medium">
                          {rule.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </div>
                    
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>
                        <span className="font-medium">Max Days:</span> {rule.maxDays} days
                      </p>
                      <p>
                        <span className="font-medium">Notify Roles:</span> {
                          Array.isArray(rule.notifyRoles) 
                            ? rule.notifyRoles.map(role => role.charAt(0).toUpperCase() + role.slice(1)).join(", ")
                            : "None"
                        }
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(rule)}
                      data-testid={`button-edit-rule-${rule.id}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(rule.id)}
                      disabled={deleteRuleMutation.isPending}
                      data-testid={`button-delete-rule-${rule.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
