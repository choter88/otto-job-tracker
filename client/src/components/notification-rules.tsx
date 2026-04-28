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
      // Always-on by default — the toggle was removed from the form. Users
      // who want a rule silent should delete it instead.
      enabled: true,
      // Notify the full team by default — the per-rule role picker was
      // removed. If we ever bring back per-rule routing, this default
      // matches "everyone".
      notifyRoles: ["owner", "manager", "staff"],
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
        description: "Overdue rule created successfully.",
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
        description: "Overdue rule updated successfully.",
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
        description: "Overdue rule deleted successfully.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/overdue"] });
    },
  });

  const onSubmit = (data: NotificationRuleFormData) => {
    // Force always-on + notify-everyone since the form no longer exposes
    // those toggles. Stays consistent regardless of what the form state had.
    const normalized: NotificationRuleFormData = {
      ...data,
      enabled: true,
      notifyRoles: ["owner", "manager", "staff"],
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
      enabled: true,
      notifyRoles: ["owner", "manager", "staff"],
    });
    setShowAddForm(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this overdue rule?")) {
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
        <div className="text-muted-foreground">Loading overdue rules...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="notification-rules">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0">
            Overdue Rules
          </h3>
          <p className="text-[calc(13px*var(--ui-scale))] text-ink-mute mt-1">
            Set how long a job can stay in a status before it’s considered overdue.
          </p>
        </div>
        <Button size="sm" onClick={handleAddNew} data-testid="button-add-rule" className="shrink-0">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Rule
        </Button>
      </div>

      {/* Add/Edit Form — compact single-row layout. Notify Roles + Enable
          toggle removed: rules always notify all team roles and are always
          on. Owners can still delete a rule to silence it. */}
      {showAddForm && (
        <div className="rounded-lg border border-otto-accent-line bg-otto-accent-soft/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="h-4 w-4 text-otto-accent-ink" />
            <h4 className="text-[calc(13px*var(--ui-scale))] font-semibold text-ink">
              {editingRule ? "Edit overdue rule" : "Add overdue rule"}
            </h4>
          </div>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
              <div>
                <Label htmlFor="status" className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
                  Job status
                </Label>
                <Controller
                  name="status"
                  control={form.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger className="h-9 mt-1" data-testid="select-rule-status">
                        <SelectValue placeholder="Select status..." />
                      </SelectTrigger>
                      <SelectContent>
                        {customStatuses.length > 0 ? (
                          customStatuses
                            .filter((s: any) => s.id !== "completed" && s.id !== "cancelled")
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
                  <p className="text-[calc(11.5px*var(--ui-scale))] text-danger mt-1">
                    {form.formState.errors.status.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="maxDays" className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold">
                  Max days
                </Label>
                <Input
                  id="maxDays"
                  type="number"
                  min="1"
                  max="365"
                  className="h-9 mt-1 tabular-nums"
                  {...form.register("maxDays", { valueAsNumber: true })}
                  data-testid="input-max-days"
                />
                {form.formState.errors.maxDays && (
                  <p className="text-[calc(11.5px*var(--ui-scale))] text-danger mt-1">
                    {form.formState.errors.maxDays.message}
                  </p>
                )}
              </div>
            </div>

            <p className="text-[calc(11.5px*var(--ui-scale))] text-ink-mute leading-relaxed">
              Notifies your full team when a job sits in this status for the maximum
              number of days. Delete the rule any time to silence it.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <Button
                type="submit"
                size="sm"
                disabled={createRuleMutation.isPending || updateRuleMutation.isPending}
                data-testid="button-save-rule"
              >
                {(createRuleMutation.isPending || updateRuleMutation.isPending) && (
                  <div className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-background border-t-primary" />
                )}
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {editingRule ? "Update rule" : "Create rule"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleCancel}
                data-testid="button-cancel-rule"
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Existing Rules */}
      <div className="space-y-3">
        {notificationRules.length === 0 && !showAddForm ? (
          <div className="px-6 py-10 text-center bg-paper-2 rounded-lg border border-dashed border-line">
            <div className="space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-paper rounded-full">
                <AlertTriangle className="h-5 w-5 text-ink-mute" />
              </div>
              <div className="space-y-1">
                <p className="text-[calc(14px*var(--ui-scale))] font-medium text-ink">No Overdue Rules</p>
                <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute">
                  Create overdue rules to get alerts when jobs sit too long in a status.
                </p>
              </div>
              <Button size="sm" onClick={handleAddNew} className="mt-1">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Your First Rule
              </Button>
            </div>
          </div>
        ) : (
          notificationRules.map((rule: NotificationRule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 px-4 h-12 bg-panel border border-line rounded-lg"
              data-testid={`rule-${rule.id}`}
            >
              <Bell className="h-4 w-4 text-ink-mute shrink-0" />
              <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                <span className="text-[calc(13px*var(--ui-scale))] font-medium text-ink">
                  {getStatusLabel(rule.status)}
                </span>
                <span className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute">
                  &gt; {rule.maxDays} {rule.maxDays === 1 ? "day" : "days"} → notify team
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5"
                onClick={() => handleEdit(rule)}
                data-testid={`button-edit-rule-${rule.id}`}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-ink-mute hover:text-danger"
                onClick={() => handleDelete(rule.id)}
                disabled={deleteRuleMutation.isPending}
                data-testid={`button-delete-rule-${rule.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
