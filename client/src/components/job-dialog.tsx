import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Briefcase, Save, Check, ChevronsUpDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job, Office, ArchivedJob } from "@shared/schema";
import { formatPatientDisplayName, normalizePatientNamePart } from "@shared/name-format";

const jobSchema = z.object({
  patientFirstName: z.string().optional().or(z.literal("")),
  patientLastName: z.string().optional().or(z.literal("")),
  trayNumber: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")).refine(
    (val) => !val || val.replace(/\D/g, '').length >= 10,
    { message: "Phone number must be at least 10 digits when provided" }
  ),
  jobType: z.string().min(1, "Please select a job type"),
  status: z.string().min(1, "Please select a status"),
  orderDestination: z.string().min(1, "Order destination is required"),
  createdAt: z.string().refine(date => new Date(date) <= new Date(), "Creation date cannot be in the future"),
  isRedoJob: z.boolean().default(false),
  originalJobId: z.string().optional(),
  notes: z.string().optional(),
});

type JobFormData = z.infer<typeof jobSchema>;
type JobMutationData = JobFormData & { clientJobId?: string };

interface JobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job?: Job;
}

export default function JobDialog({ open, onOpenChange, job }: JobDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const { data: activeJobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    enabled: !!user?.officeId && open,
  });

  const { data: archivedJobs = [] } = useQuery<ArchivedJob[]>({
    queryKey: ["/api/jobs/archived"],
    enabled: !!user?.officeId && open,
  });

  const [customColumnValues, setCustomColumnValues] = useState<Record<string, any>>(job?.customColumnValues || {});
  const [originalJobOpen, setOriginalJobOpen] = useState(false);
  const [duplicateTrayModalOpen, setDuplicateTrayModalOpen] = useState(false);
  const [duplicateTrayNumber, setDuplicateTrayNumber] = useState("");

  useEffect(() => {
    setCustomColumnValues(job?.customColumnValues || {});
  }, [job, open]);

  // Memoize form default values to prevent unnecessary re-creation
  const defaultValues = useMemo(() => ({
    patientFirstName: job?.patientFirstName || "",
    patientLastName: job?.patientLastName || "",
    trayNumber: job?.trayNumber || "",
    phone: job?.phone || "",
    jobType: job?.jobType || undefined,
    status: job?.status || "job_created",
    orderDestination: job?.orderDestination || "",
    createdAt: job?.createdAt ? new Date(job.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    isRedoJob: job?.isRedoJob || false,
    originalJobId: job?.originalJobId || undefined,
    notes: job?.notes || "",
  }), [job]);

  const form = useForm<JobFormData>({
    resolver: zodResolver(jobSchema),
    defaultValues,
  });

  // Reset form when job or open state changes
  useEffect(() => {
    if (open) {
      form.reset({
        patientFirstName: job?.patientFirstName || "",
        patientLastName: job?.patientLastName || "",
        trayNumber: job?.trayNumber || "",
        phone: job?.phone || "",
        jobType: job?.jobType || undefined,
        status: job?.status || "job_created",
        orderDestination: job?.orderDestination || "",
        createdAt: job?.createdAt ? new Date(job.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        isRedoJob: job?.isRedoJob || false,
        originalJobId: job?.originalJobId || undefined,
        notes: job?.notes || "",
      });
    }
  }, [job, open, form]);

  const isRedoJob = form.watch("isRedoJob");
  const selectedOriginalJobId = form.watch("originalJobId");

  // Get identifier mode from office settings
  const jobIdentifierModeForMutation = (office?.settings as any)?.jobIdentifierMode || "patientName";
  const useTrayNumberForMutation = jobIdentifierModeForMutation === "trayNumber";

  const createJobMutation = useMutation({
    mutationFn: async (data: JobMutationData) => {
      const { createdAt, ...rest } = data;
      const normalizedFirstName = normalizePatientNamePart(data.patientFirstName);
      const normalizedLastName = normalizePatientNamePart(data.patientLastName);
      const formattedData = {
        ...rest,
        phone: data.phone ? data.phone.replace(/\D/g, '') : '', // Remove formatting
        // When using tray number mode, set placeholder values for patient name fields
        patientFirstName: useTrayNumberForMutation ? "" : normalizedFirstName,
        patientLastName: useTrayNumberForMutation ? "" : normalizedLastName,
        trayNumber: data.trayNumber || null,
        customColumnValues,
        originalJobId: data.originalJobId || null,
      };

      if (job) {
        // For updates, don't include createdAt
        const res = await apiRequest("PUT", `/api/jobs/${job.id}`, formattedData);
        return res.json();
      } else {
        // For creates, include createdAt as a Date
        const res = await apiRequest("POST", "/api/jobs", {
          id: data.clientJobId,
          ...formattedData,
          createdAt: new Date(createdAt),
        });
        return res.json();
      }
    },
    onMutate: async (data: JobMutationData) => {
      await queryClient.cancelQueries({ queryKey: ["/api/jobs"] });
      
      const previousJobs = queryClient.getQueryData(["/api/jobs"]);
      
      if (job) {
        // Optimistically update existing job
        queryClient.setQueryData(["/api/jobs"], (old: Job[] | undefined) => 
          old ? old.map(j => j.id === job.id ? { 
            ...j, 
            ...data,
            phone: data.phone ? data.phone.replace(/\D/g, '') : '',
            customColumnValues: {
              ...(j.customColumnValues || {}),
              ...customColumnValues
            },
            originalJobId: data.originalJobId || null,
            createdAt: j.createdAt,
            updatedAt: new Date()
          } : j) : []
        );
      } else {
        const clientJobId =
          typeof data.clientJobId === "string" && data.clientJobId ? data.clientJobId : `temp-${Date.now()}`;
        const pendingSuffix = clientJobId.replace(/[^a-fA-F0-9]/g, "").slice(0, 6).toUpperCase() || "PENDING";

        // Optimistically add new job with client-generated ID
        const optimisticJob = {
          id: clientJobId,
          orderId: `PENDING-${pendingSuffix}`,
          officeId: user?.officeId || '',
          ...data,
          phone: data.phone ? data.phone.replace(/\D/g, '') : '',
          customColumnValues,
          originalJobId: data.originalJobId || null,
          createdAt: new Date(data.createdAt),
          isRedoJob: data.isRedoJob || false,
        } as unknown as Job;
        
        queryClient.setQueryData(["/api/jobs"], (old: Job[] | undefined) => 
          old ? [optimisticJob, ...old] : [optimisticJob]
        );
      }
      
      return { previousJobs };
    },
    onError: (error: Error & { status?: number; existingJobId?: string }, variables, context) => {
      queryClient.setQueryData(["/api/jobs"], context?.previousJobs);
      
      // Check if this is a duplicate tray number error
      if (error.message?.includes("Duplicate tray number") || error.message?.includes("A job with this tray number already exists")) {
        setDuplicateTrayNumber(variables.trayNumber || "");
        setDuplicateTrayModalOpen(true);
        return;
      }
      
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: job ? "Job Updated" : "Job Created",
        description: job ? "Job has been updated successfully." : "Job has been created successfully.",
      });
      onOpenChange(false);
      form.reset();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/archived"] });
    },
  });

  const onSubmit = (data: JobFormData) => {
    const normalizedFirstName = normalizePatientNamePart(data.patientFirstName);
    const normalizedLastName = normalizePatientNamePart(data.patientLastName);

    // Validate based on identifier mode
    if (useTrayNumberForMutation) {
      if (!data.trayNumber || data.trayNumber.trim() === "") {
        toast({
          title: "Validation Error",
          description: "Tray number is required",
          variant: "destructive",
        });
        return;
      }
    } else {
      if (!normalizedFirstName || !normalizedLastName) {
        toast({
          title: "Validation Error",
          description: "Patient first name and last name are required",
          variant: "destructive",
        });
        return;
      }
    }

    const normalizedData = useTrayNumberForMutation
      ? data
      : {
          ...data,
          patientFirstName: normalizedFirstName,
          patientLastName: normalizedLastName,
        };

    if (job) {
      createJobMutation.mutate(normalizedData);
    } else {
      const id = (globalThis as any)?.crypto?.randomUUID?.() || `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      createJobMutation.mutate({ ...normalizedData, clientJobId: id });
    }
  };

  const formatPhoneNumber = (value: string) => {
    if (!value) return '';
    const phoneNumber = value.replace(/[^\d]/g, '');
    const phoneNumberLength = phoneNumber.length;
    
    if (phoneNumberLength < 4) return phoneNumber;
    if (phoneNumberLength < 7) {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
    }
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
  };

  const formatJobDisplay = (job: Job | ArchivedJob, isArchived: boolean = false) => {
    const jobTypeLabel = customJobTypes.find((t: any) => t.id === job.jobType)?.label || 
                         job.jobType.charAt(0).toUpperCase() + job.jobType.slice(1);
    const prefix = isArchived ? "[ARCHIVED] " : "";
    const patientName = formatPatientDisplayName(job.patientFirstName, job.patientLastName);
    return `${prefix}${job.orderId} - ${patientName}`.trim() + ` - ${jobTypeLabel}`;
  };

  const customJobTypes = (office?.settings as any)?.customJobTypes || [];
  const customStatuses = (office?.settings as any)?.customStatuses || [];
  const customOrderDestinations = (office?.settings as any)?.customOrderDestinations || [];
  const customColumns = ((office?.settings as any)?.customColumns || []).filter((col: any) => col.active);
  const jobIdentifierMode = (office?.settings as any)?.jobIdentifierMode || "patientName";
  const useTrayNumber = jobIdentifierMode === "trayNumber";

  // Combine active and archived jobs for selection, excluding the current job being edited
  const allSelectableJobs = [
    ...activeJobs.filter(j => j.id !== job?.id).map(j => ({ ...j, isArchived: false })),
    ...archivedJobs.map(j => ({ ...j, isArchived: true }))
  ];

  const selectedJob = allSelectableJobs.find(j => j.id === selectedOriginalJobId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-fade-in" data-testid="dialog-job">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            {job ? "Edit Job" : "Create New Job"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit, () => {
          // Scroll to first validation error
          requestAnimationFrame(() => {
            const firstError = document.querySelector('[data-testid="dialog-job"] .text-destructive');
            if (firstError) {
              firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          });
        })} className="space-y-6">
          {/* Patient Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-3">
              <User className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">{useTrayNumber ? "Job Identifier" : "Patient Information"}</h3>
            </div>

            {useTrayNumber ? (
              <div className="space-y-2">
                <Label htmlFor="trayNumber">Tray Number *</Label>
                <Input
                  id="trayNumber"
                  placeholder="Enter tray number"
                  {...form.register("trayNumber")}
                  data-testid="input-tray-number"
                />
                {form.formState.errors.trayNumber && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.trayNumber.message}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="patientFirstName">First Name *</Label>
                  <Input
                    id="patientFirstName"
                    placeholder="Jane"
                    {...form.register("patientFirstName", {
                      onBlur: (e) => {
                        form.setValue("patientFirstName", normalizePatientNamePart(e.target.value), {
                          shouldDirty: true,
                        });
                      },
                    })}
                    data-testid="input-patient-firstname"
                  />
                  {form.formState.errors.patientFirstName && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.patientFirstName.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="patientLastName">Last Name *</Label>
                  <Input
                    id="patientLastName"
                    placeholder="Doe"
                    {...form.register("patientLastName", {
                      onBlur: (e) => {
                        form.setValue("patientLastName", normalizePatientNamePart(e.target.value), {
                          shouldDirty: true,
                        });
                      },
                    })}
                    data-testid="input-patient-lastname"
                  />
                  {form.formState.errors.patientLastName && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.patientLastName.message}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="(555) 123-4567"
                {...form.register("phone")}
                onChange={(e) => {
                  const formatted = formatPhoneNumber(e.target.value);
                  form.setValue("phone", formatted);
                }}
                data-testid="input-phone"
              />
              {form.formState.errors.phone && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.phone.message}
                </p>
              )}
            </div>
          </div>

          {/* Job Details */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-3">
              <Briefcase className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">Job Details</h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="jobType">Job Type *</Label>
                <Controller
                  name="jobType"
                  control={form.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger data-testid="select-job-type">
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                      <SelectContent>
                        {customJobTypes.length > 0 ? (
                          customJobTypes.map((type: any) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.label}
                            </SelectItem>
                          ))
                        ) : (
                          <>
                            <SelectItem value="contacts">Contacts</SelectItem>
                            <SelectItem value="glasses">Glasses</SelectItem>
                            <SelectItem value="sunglasses">Sunglasses</SelectItem>
                            <SelectItem value="prescription">Prescription</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.jobType && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.jobType.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status *</Label>
                <Controller
                  name="status"
                  control={form.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger data-testid="select-status">
                        <SelectValue placeholder="Select status..." />
                      </SelectTrigger>
                      <SelectContent>
                        {customStatuses.length > 0 ? (
                          customStatuses.map((status: any) => (
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
                <Label htmlFor="orderDestination">Order Destination *</Label>
                <Controller
                  name="orderDestination"
                  control={form.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger data-testid="select-destination">
                        <SelectValue placeholder="Select destination..." />
                      </SelectTrigger>
                      <SelectContent>
                        {customOrderDestinations.length > 0 ? (
                          customOrderDestinations.map((destination: any) => (
                            <SelectItem key={destination.id} value={destination.id}>
                              {destination.label}
                            </SelectItem>
                          ))
                        ) : (
                          <>
                            <SelectItem value="Vision Lab">Vision Lab</SelectItem>
                            <SelectItem value="EyeTech Labs">EyeTech Labs</SelectItem>
                            <SelectItem value="Premium Optics">Premium Optics</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.orderDestination && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.orderDestination.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="createdAt">Creation Date *</Label>
                <Input
                  id="createdAt"
                  type="date"
                  max={new Date().toISOString().split('T')[0]}
                  {...form.register("createdAt")}
                  data-testid="input-created-date"
                />
                {form.formState.errors.createdAt && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.createdAt.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Redo Order Option */}
          <div className="p-4 bg-muted rounded-lg space-y-4">
            <div className="flex items-center space-x-2">
              <Controller
                name="isRedoJob"
                control={form.control}
                render={({ field }) => (
                  <Checkbox
                    id="isRedoJob"
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      if (!checked) {
                        form.setValue("originalJobId", undefined);
                      }
                    }}
                    data-testid="checkbox-redo"
                  />
                )}
              />
              <div className="space-y-1 leading-none">
                <Label htmlFor="isRedoJob" className="font-medium">
                  Redo Order?
                </Label>
                <p className="text-sm text-muted-foreground">
                  Create a new job linked to an original order
                </p>
              </div>
            </div>

            {/* Original Job Selector - shown when isRedoJob is true */}
            {isRedoJob && (
              <div className="space-y-2">
                <Label htmlFor="originalJob">Select Original Job *</Label>
                <Controller
                  name="originalJobId"
                  control={form.control}
                  render={({ field }) => (
                    <Popover open={originalJobOpen} onOpenChange={setOriginalJobOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={originalJobOpen}
                          className="w-full justify-between"
                          data-testid="button-select-original-job"
                        >
                          {selectedJob
                            ? formatJobDisplay(selectedJob, selectedJob.isArchived)
                            : "Select original job..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search jobs..." />
                          <CommandList>
                            <CommandEmpty>No jobs found.</CommandEmpty>
                            <CommandGroup>
                              {allSelectableJobs.map((selectableJob) => (
                                <CommandItem
                                  key={selectableJob.id}
                                  value={formatJobDisplay(selectableJob, selectableJob.isArchived)}
                                  onSelect={() => {
                                    field.onChange(selectableJob.id);
                                    setOriginalJobOpen(false);
                                  }}
                                  data-testid={`item-job-${selectableJob.id}`}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedOriginalJobId === selectableJob.id
                                        ? "opacity-100"
                                        : "opacity-0"
                                    )}
                                  />
                                  {formatJobDisplay(selectableJob, selectableJob.isArchived)}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                />
                {isRedoJob && !selectedOriginalJobId && (
                  <p className="text-sm text-muted-foreground">
                    Please select the original job this is a redo of
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Custom Columns */}
          {customColumns.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-lg font-semibold">Custom Fields</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {customColumns.map((column: any) => (
                  <div key={column.id} className="space-y-2">
                    {column.type === 'checkbox' ? (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`custom-${column.id}`}
                          checked={customColumnValues[column.id] || false}
                          onCheckedChange={(checked) => setCustomColumnValues({...customColumnValues, [column.id]: checked})}
                          data-testid={`checkbox-custom-${column.id}`}
                        />
                        <Label htmlFor={`custom-${column.id}`}>{column.name}</Label>
                      </div>
                    ) : (
                      <>
                        <Label htmlFor={`custom-${column.id}`}>{column.name}</Label>
                        {column.type === 'text' && (
                          <Input
                            id={`custom-${column.id}`}
                            value={customColumnValues[column.id] || ''}
                            onChange={(e) => setCustomColumnValues({...customColumnValues, [column.id]: e.target.value})}
                            data-testid={`input-custom-${column.id}`}
                          />
                        )}
                        {column.type === 'date' && (
                          <Input
                            id={`custom-${column.id}`}
                            type="date"
                            value={customColumnValues[column.id] || ''}
                            onChange={(e) => setCustomColumnValues({...customColumnValues, [column.id]: e.target.value})}
                            data-testid={`input-custom-date-${column.id}`}
                          />
                        )}
                        {column.type === 'number' && (
                          <Input
                            id={`custom-${column.id}`}
                            type="number"
                            value={customColumnValues[column.id] || ''}
                            onChange={(e) => setCustomColumnValues({...customColumnValues, [column.id]: e.target.value})}
                            data-testid={`input-custom-number-${column.id}`}
                          />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Order ID Display */}
          {job && (
            <div className="p-4 bg-accent rounded-lg">
              <Label className="block text-sm font-medium mb-1.5 text-muted-foreground">
                Order ID
              </Label>
              <Input
                value={job.orderId}
                readOnly
                className="bg-muted font-mono"
                data-testid="input-order-id"
              />
            </div>
          )}

          {/* Form Actions */}
          <div className="flex gap-3 pt-4 border-t border-border">
            <Button
              type="submit"
              className="flex-1"
              disabled={createJobMutation.isPending}
              data-testid="button-save-job"
            >
              {createJobMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              <Save className="mr-2 h-4 w-4" />
              {job ? "Update Job" : "Create Job"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>

      {/* Duplicate Tray Number Alert Dialog */}
      <AlertDialog open={duplicateTrayModalOpen} onOpenChange={setDuplicateTrayModalOpen}>
        <AlertDialogContent data-testid="dialog-duplicate-tray">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Duplicate Tray Number
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              A job with tray number <span className="font-semibold">"{duplicateTrayNumber}"</span> already exists.
              Please check for accuracy and enter a different tray number.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction 
              onClick={() => setDuplicateTrayModalOpen(false)}
              data-testid="button-close-duplicate-modal"
            >
              OK, I'll check
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
