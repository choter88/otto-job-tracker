import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Save, Check, ChevronsUpDown, ChevronDown, ChevronRight, AlertTriangle, Share2, Copy, Rows3, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job, Office, ArchivedJob } from "@shared/schema";
import { formatPatientDisplayName, normalizePatientNamePart } from "@shared/name-format";
import { ToastAction } from "@/components/ui/toast";
import { openJobDetails } from "@/components/spotlight/feature-spotlight-host";

const STICKY_LAB_STORAGE_KEY = "otto.newJob.lastLab";

const jobSchema = z.object({
  patientFirstName: z.string().optional().or(z.literal("")),
  patientLastName: z.string().optional().or(z.literal("")),
  trayNumber: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")).refine(
    (val) => !val || val.replace(/\D/g, '').length >= 10,
    { message: "Phone number must be at least 10 digits when provided" }
  ),
  jobType: z.string().min(1, "Please select a job type"),
  // Status defaults to "job_created" on the server when omitted in create
  // mode — the New Job dialog no longer surfaces this field because a
  // brand-new job is always "Created". Edit mode still includes it.
  status: z.string().min(1).default("job_created"),
  orderDestination: z.string().min(1, "Lab is required"),
  // Creation date defaults to today on submit when omitted; edit mode
  // surfaces it for back-dating.
  createdAt: z.string().optional().refine(
    (date) => !date || new Date(date) <= new Date(),
    "Creation date cannot be in the future",
  ),
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
  archivedJob?: ArchivedJob;
  readOnly?: boolean;
}

export default function JobDialog({ open, onOpenChange, job, archivedJob, readOnly }: JobDialogProps) {
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

  // Use archivedJob as data source in read-only mode, otherwise use job
  const source: any = readOnly && archivedJob ? archivedJob : job;
  const sourceCreatedAt = readOnly && archivedJob
    ? archivedJob.originalCreatedAt
    : job?.createdAt;

  useEffect(() => {
    setCustomColumnValues(source?.customColumnValues || {});
  }, [source, open]);

  // Sticky lab default per workstation. Pre-fills Lab on create-mode
  // so the common case (every job goes to the same lab in this clinic)
  // is zero clicks. Saved to localStorage on successful create. Edit
  // mode ignores this and uses the source's own lab.
  const stickyLab = useMemo(() => {
    if (typeof window === "undefined") return "";
    try { return window.localStorage.getItem(STICKY_LAB_STORAGE_KEY) || ""; }
    catch { return ""; }
  }, []);

  // Memoize form default values to prevent unnecessary re-creation
  const defaultValues = useMemo(() => ({
    patientFirstName: source?.patientFirstName || "",
    patientLastName: source?.patientLastName || "",
    trayNumber: source?.trayNumber || "",
    phone: source?.phone || "",
    jobType: source?.jobType || undefined,
    status: readOnly && archivedJob ? archivedJob.finalStatus : source?.status || "job_created",
    orderDestination: source?.orderDestination || (job ? "" : stickyLab),
    createdAt: sourceCreatedAt ? new Date(sourceCreatedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    isRedoJob: source?.isRedoJob || false,
    originalJobId: source?.originalJobId || undefined,
    notes: source?.notes || "",
  }), [source, archivedJob, readOnly, job, stickyLab]);

  const form = useForm<JobFormData>({
    resolver: zodResolver(jobSchema),
    defaultValues,
  });

  // Per-job opt-in checkbox state for "generate tracking link on save".
  // Only relevant when (a) we're CREATING a job (not editing) and
  // (b) the office has auto-generate turned on. Defaults to checked
  // when shown so the office's chosen default behavior is the path of
  // least resistance — staff can uncheck per-job if a particular
  // patient shouldn't get a link.
  //
  // The actual link creation happens server-side inside `POST /api/jobs`
  // — this checkbox value is forwarded as `generateTrackingLink` in
  // the request body so a single round-trip both creates the job and
  // returns the link URL (when one was generated).
  const trackingDefaults = (office?.settings as any)?.trackingLinkDefaults ?? {};
  const officeAutoGenerate = !!trackingDefaults.autoGenerateTrackingLinks;
  const [generateTrackingLink, setGenerateTrackingLink] = useState(true);

  // Reset the checkbox to the office default whenever the dialog opens
  // for a new job (avoid sticky state from a previous job's choice).
  useEffect(() => {
    if (open && !job) setGenerateTrackingLink(true);
  }, [open, job]);

  // Reset form when job or open state changes
  useEffect(() => {
    if (open) {
      form.reset({
        patientFirstName: source?.patientFirstName || "",
        patientLastName: source?.patientLastName || "",
        trayNumber: source?.trayNumber || "",
        phone: source?.phone || "",
        jobType: source?.jobType || undefined,
        status: readOnly && archivedJob ? archivedJob.finalStatus : source?.status || "job_created",
        orderDestination: source?.orderDestination || (job ? "" : stickyLab),
        createdAt: sourceCreatedAt ? new Date(sourceCreatedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        isRedoJob: source?.isRedoJob || false,
        originalJobId: source?.originalJobId || undefined,
        notes: source?.notes || "",
      });
    }
  }, [job, open, form, stickyLab]);

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
        // For creates, include createdAt as a Date (defaults to today
        // when omitted). Status defaults to "job_created" via the
        // schema. The server reads `generateTrackingLink` and
        // auto-creates (or merges into) a tracking link in the same
        // handler, returning the URL on the response.
        const effectiveCreatedAt = createdAt ? new Date(createdAt) : new Date();
        const res = await apiRequest("POST", "/api/jobs", {
          id: data.clientJobId,
          ...formattedData,
          status: formattedData.status || "job_created",
          createdAt: effectiveCreatedAt,
          generateTrackingLink: officeAutoGenerate && generateTrackingLink,
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
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
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
    onSuccess: (data, variables) => {
      // Sticky lab: remember the chosen lab on this workstation so the
      // next New Job dialog opens with it pre-selected. Skip on edit
      // — staff editing an existing job's lab shouldn't change the
      // default for future new jobs.
      if (!job && variables.orderDestination && typeof window !== "undefined") {
        try { window.localStorage.setItem(STICKY_LAB_STORAGE_KEY, variables.orderDestination); }
        catch {}
      }

      // Server-side auto-gen path: the create call returns `trackingLinkUrl`
      // on the response when a link was generated (or an existing
      // sibling-link was extended via the merge path).
      const trackingLinkUrl =
        data && typeof data === "object" && typeof (data as any).trackingLinkUrl === "string"
          ? ((data as any).trackingLinkUrl as string)
          : null;
      const createdJobId =
        data && typeof data === "object" && typeof (data as any).id === "string"
          ? ((data as any).id as string)
          : null;

      if (!job && trackingLinkUrl) {
        // Two-action toast: Copy puts the URL on the clipboard (the 90%
        // workflow — staff paste into Weave / SMS / email), Open jumps
        // to the Tracking tab of Job Details for the full share view
        // (QR code, message template, edit, revoke).
        toast({
          title: "Job Created",
          description: "Tracking link ready",
          action: (
            <div className="flex items-center gap-1.5">
              <ToastAction
                altText="Copy tracking link"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(trackingLinkUrl);
                    toast({ title: "Link copied", description: "Paste into Weave, SMS, or email." });
                    fetch("/api/track", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({
                        eventType: "tracking_link_copy_url",
                        metadata: { source: "toast" },
                      }),
                    }).catch(() => {});
                  } catch {
                    toast({ title: "Copy failed", variant: "destructive" });
                  }
                }}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy link
              </ToastAction>
              {createdJobId && (
                <ToastAction
                  altText="Open job details"
                  onClick={() => openJobDetails(createdJobId, "tracking")}
                >
                  Open
                </ToastAction>
              )}
            </div>
          ),
        });
      } else {
        toast({
          title: job ? "Job Updated" : "Job Created",
          description: job ? "Job has been updated successfully." : "Job has been created successfully.",
        });
      }

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
                         (job.jobType ? job.jobType.charAt(0).toUpperCase() + job.jobType.slice(1) : "Unknown");
    const prefix = isArchived ? "[ARCHIVED] " : "";
    const patientName = formatPatientDisplayName(job.patientFirstName, job.patientLastName);
    const trayLabel = (job as any).trayNumber ? `Tray ${(job as any).trayNumber}` : "";
    const identifier = patientName || trayLabel || "Unnamed";
    return `${prefix}${identifier} — ${jobTypeLabel}`;
  };

  const customJobTypes = (office?.settings as any)?.customJobTypes || [];
  const customStatuses = (office?.settings as any)?.customStatuses || [];
  const customOrderDestinations = (office?.settings as any)?.customOrderDestinations || [];
  const customColumns = ((office?.settings as any)?.customColumns || []).filter((col: any) => col.active);
  const jobIdentifierMode = (office?.settings as any)?.jobIdentifierMode || "patientName";
  const useTrayNumber = jobIdentifierMode === "trayNumber";

  // Tab state: create-mode shows "Single" and "Bulk"; edit-mode (and
  // read-only) is single-only.
  const showTabs = !job && !readOnly;
  const [activeTab, setActiveTab] = useState<"single" | "bulk">("single");
  useEffect(() => { if (open) setActiveTab("single"); }, [open]);

  // More-options disclosure state for the Single tab.
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { if (open) setMoreOpen(false); }, [open]);

  // When the user opts in to "Generate tracking link", surface Phone
  // inline (an SMS link without a phone is useless). Otherwise Phone
  // lives inside More options for the rare case staff still wants to
  // record it.
  const phoneInline = !job && !readOnly && officeAutoGenerate && generateTrackingLink;

  // Fallback job-type / lab seed lists when the office hasn't configured
  // any. The Tracking spec assumes a small enumerated set per office;
  // these mirror the seed defaults the rest of the app uses.
  const jobTypeOptions: { id: string; label: string }[] = customJobTypes.length > 0
    ? customJobTypes.map((t: any) => ({ id: t.id, label: t.label }))
    : [
        { id: "glasses", label: "Glasses" },
        { id: "sunglasses", label: "Sunglasses" },
        { id: "contacts", label: "Contacts" },
        { id: "prescription", label: "Prescription" },
      ];
  const labOptions: { id: string; label: string }[] = customOrderDestinations.length > 0
    ? customOrderDestinations.map((d: any) => ({ id: d.id, label: d.label }))
    : [
        { id: "hoya", label: "Hoya" },
        { id: "essilor", label: "Essilor" },
        { id: "zeiss", label: "Zeiss" },
      ];

  // Combine active and archived jobs for selection, excluding the current job being edited
  const allSelectableJobs = [
    ...activeJobs.filter(j => j.id !== job?.id).map(j => ({ ...j, isArchived: false })),
    ...archivedJobs.map(j => ({ ...j, isArchived: true }))
  ];

  const selectedJob = allSelectableJobs.find(j => j.id === selectedOriginalJobId);

  // Shared field styling — all form labels and error lines run through the
  // same density-aware tokens so the form holds together as the user changes
  // their font-size preference.
  const fieldLabel = "text-[calc(12.5px*var(--ui-scale))] font-medium text-ink-2";
  const fieldError = "text-[calc(11.5px*var(--ui-scale))] text-danger mt-1";
  const sectionTitle = "font-display text-[calc(18px*var(--ui-scale))] font-medium tracking-[-0.02em] text-ink m-0";
  const sectionDesc = "text-[calc(12.5px*var(--ui-scale))] text-ink-mute mt-1";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "w-full p-0 overflow-hidden flex flex-col gap-0",
          activeTab === "bulk" ? "max-w-[1080px] h-[min(760px,calc(100vh-64px))]" : "max-w-[560px] h-[min(720px,calc(100vh-64px))]",
        )}
        data-testid="dialog-job"
      >
        <DialogHeader className="px-6 py-[18px] border-b border-line space-y-0">
          <DialogTitle asChild>
            <h3 className="font-display text-[calc(20px*var(--ui-scale))] font-medium tracking-[-0.025em] text-ink m-0">
              {readOnly ? "Archived Job" : job ? "Edit Job" : "New Job"}
            </h3>
          </DialogTitle>
        </DialogHeader>

        {showTabs && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "single" | "bulk")} className="border-b border-line">
            <TabsList className="h-9 mx-6 my-2 bg-paper-2 p-0.5 inline-flex">
              <TabsTrigger value="single" className="text-[calc(12.5px*var(--ui-scale))] gap-1.5 px-3" data-testid="tab-single">
                <User className="h-3.5 w-3.5" />
                Single
              </TabsTrigger>
              <TabsTrigger value="bulk" className="text-[calc(12.5px*var(--ui-scale))] gap-1.5 px-3" data-testid="tab-bulk">
                <Rows3 className="h-3.5 w-3.5" />
                Bulk
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {showTabs && activeTab === "bulk" ? (
          <BulkAddJobsTab
            jobTypeOptions={jobTypeOptions}
            labOptions={labOptions}
            customColumns={customColumns}
            useTrayNumber={useTrayNumber}
            stickyLab={stickyLab}
            officeAutoGenerate={officeAutoGenerate}
            onClose={() => onOpenChange(false)}
          />
        ) : (

        <form
          onSubmit={readOnly ? (e) => e.preventDefault() : form.handleSubmit(onSubmit, () => {
            // Scroll to first validation error
            requestAnimationFrame(() => {
              const firstError = document.querySelector('[data-testid="dialog-job"] .text-danger');
              if (firstError) {
                firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            });
          })}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <fieldset disabled={readOnly} className={cn("space-y-5 p-0 m-0 border-0", readOnly && "opacity-80")}>
            {/* Patient Information */}
            <div className="space-y-3">
              {(job || readOnly) && (
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-ink-mute" />
                  <h4 className="text-[calc(11px*var(--ui-scale))] uppercase tracking-wider text-ink-mute font-semibold m-0">
                    {useTrayNumber ? "Identifier" : "Patient"}
                  </h4>
                </div>
              )}

              {useTrayNumber ? (
                <div className="space-y-1.5">
                  <Label htmlFor="trayNumber" className={fieldLabel}>Tray Number *</Label>
                  <Input
                    id="trayNumber"
                    placeholder="Enter tray number"
                    {...form.register("trayNumber")}
                    data-testid="input-tray-number"
                  />
                  {form.formState.errors.trayNumber && (
                    <p className={fieldError}>
                      {form.formState.errors.trayNumber.message}
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="patientFirstName" className={fieldLabel}>First Name *</Label>
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
                      <p className={fieldError}>
                        {form.formState.errors.patientFirstName.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="patientLastName" className={fieldLabel}>Last Name *</Label>
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
                      <p className={fieldError}>
                        {form.formState.errors.patientLastName.message}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Phone is surfaced inline only when a tracking link is
                  going out (SMS needs a phone) or when editing. Otherwise
                  it lives under More options to keep the new-job surface
                  tight. */}
              {(phoneInline || job || readOnly) && (
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className={fieldLabel}>
                    Phone Number
                    {phoneInline && (
                      <span className="ml-1.5 text-[calc(10.5px*var(--ui-scale))] text-ink-faint font-normal">
                        for tracking-link SMS
                      </span>
                    )}
                  </Label>
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
                    <p className={fieldError}>
                      {form.formState.errors.phone.message}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Job Type — button row. A small enumerated set is faster
                to scan and pick from than a dropdown. Falls back to
                seed defaults when the office hasn't configured types. */}
            <div className="space-y-1.5">
              <Label className={fieldLabel}>Job Type *</Label>
              <Controller
                name="jobType"
                control={form.control}
                render={({ field }) => (
                  <div className="flex flex-wrap gap-1.5" data-testid="select-job-type">
                    {jobTypeOptions.map((opt) => {
                      const selected = field.value === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => field.onChange(opt.id)}
                          disabled={readOnly}
                          className={cn(
                            "px-3 py-1.5 rounded-md text-[calc(12.5px*var(--ui-scale))] border transition-colors",
                            selected
                              ? "bg-otto-accent text-white border-otto-accent"
                              : "bg-white text-ink border-line hover:bg-paper-2",
                          )}
                          data-testid={`button-job-type-${opt.id}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              />
              {form.formState.errors.jobType && (
                <p className={fieldError}>{form.formState.errors.jobType.message}</p>
              )}
            </div>

            {/* Lab — sticky default per workstation (localStorage). The
                common case (every job goes to the same lab in this
                clinic) is pre-selected, so the user can skip this
                field entirely. */}
            <div className="space-y-1.5">
              <Label htmlFor="orderDestination" className={fieldLabel}>Lab *</Label>
              <Controller
                name="orderDestination"
                control={form.control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value || undefined}>
                    <SelectTrigger data-testid="select-destination">
                      <SelectValue placeholder="Select lab..." />
                    </SelectTrigger>
                    <SelectContent>
                      {labOptions.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.orderDestination && (
                <p className={fieldError}>{form.formState.errors.orderDestination.message}</p>
              )}
            </div>

            {/* Status + Creation Date — only meaningful when editing or
                reading an archived job. A new job is always
                "job_created" at today's date; surfacing these as
                required fields was dead weight. */}
            {(job || readOnly) && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="status" className={fieldLabel}>Status</Label>
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
                              <SelectItem value="job_created">Created</SelectItem>
                              <SelectItem value="ordered">Ordered</SelectItem>
                              <SelectItem value="in_progress">Lab Processing</SelectItem>
                              <SelectItem value="quality_check">Quality Check</SelectItem>
                              <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="createdAt" className={fieldLabel}>Creation Date</Label>
                  <Input
                    id="createdAt"
                    type="date"
                    max={new Date().toISOString().split('T')[0]}
                    {...form.register("createdAt")}
                    data-testid="input-created-date"
                  />
                  {form.formState.errors.createdAt && (
                    <p className={fieldError}>{form.formState.errors.createdAt.message}</p>
                  )}
                </div>
              </div>
            )}

            {/* More options — create-mode only. Edit mode surfaces the
                redo + phone fields inline above. Collapsed by default
                so the new-job surface stays tight. */}
            {!job && !readOnly && (
              <div>
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-1 py-1 text-[calc(12px*var(--ui-scale))] text-ink-mute hover:text-ink"
                  data-testid="button-toggle-more-options"
                >
                  {moreOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  More options
                </button>

                {moreOpen && (
                  <div className="mt-2 space-y-4 rounded-lg bg-paper-2 border border-line p-3.5">
                    {/* Phone (only if not surfaced inline above). */}
                    {!phoneInline && (
                      <div className="space-y-1.5">
                        <Label htmlFor="phone-more" className={fieldLabel}>Phone Number</Label>
                        <Input
                          id="phone-more"
                          type="tel"
                          placeholder="(555) 123-4567"
                          {...form.register("phone")}
                          onChange={(e) => {
                            const formatted = formatPhoneNumber(e.target.value);
                            form.setValue("phone", formatted);
                          }}
                          data-testid="input-phone-more"
                        />
                        {form.formState.errors.phone && (
                          <p className={fieldError}>{form.formState.errors.phone.message}</p>
                        )}
                      </div>
                    )}

                    {/* Redo order toggle — small switch + conditional
                        original-job selector. */}
                    <div className="space-y-2">
                      <div className="flex items-start gap-2.5">
                        <Controller
                          name="isRedoJob"
                          control={form.control}
                          render={({ field }) => (
                            <Checkbox
                              id="isRedoJob"
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked);
                                if (!checked) form.setValue("originalJobId", undefined);
                              }}
                              className="mt-0.5"
                              data-testid="checkbox-redo"
                            />
                          )}
                        />
                        <Label htmlFor="isRedoJob" className="text-[calc(12.5px*var(--ui-scale))] font-medium text-ink cursor-pointer m-0">
                          This is a redo of an existing order
                        </Label>
                      </div>

                      {isRedoJob && (
                        <div className="space-y-1.5">
                          <Label className={fieldLabel}>Original Job *</Label>
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
                                                selectedOriginalJobId === selectableJob.id ? "opacity-100" : "opacity-0",
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
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Edit-mode keeps the Redo card visible since editing an
                existing job's redo-link state happens here. */}
            {(job || readOnly) && (
              <div className="rounded-lg bg-paper-2 border border-line p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <Controller
                    name="isRedoJob"
                    control={form.control}
                    render={({ field }) => (
                      <Checkbox
                        id="isRedoJob"
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          if (!checked) form.setValue("originalJobId", undefined);
                        }}
                        className="mt-0.5"
                        data-testid="checkbox-redo"
                      />
                    )}
                  />
                  <Label htmlFor="isRedoJob" className="text-[calc(13px*var(--ui-scale))] font-medium text-ink cursor-pointer m-0">
                    This is a redo of an existing order
                  </Label>
                </div>
                {isRedoJob && (
                  <div className="space-y-1.5">
                    <Label className={fieldLabel}>Original Job *</Label>
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
                                          selectedOriginalJobId === selectableJob.id ? "opacity-100" : "opacity-0",
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
                  </div>
                )}
              </div>
            )}

          {/* Custom Columns */}
          {customColumns.length > 0 && (
            <>
              <div className="border-t border-line-2" />
              <div className="space-y-3.5">
                <div className="flex items-center gap-2.5">
                  <h4 className={sectionTitle}>Custom Fields</h4>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {customColumns.map((column: any) => (
                    <div key={column.id} className="space-y-1.5">
                      {column.type === 'checkbox' ? (
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`custom-${column.id}`}
                            checked={customColumnValues[column.id] || false}
                            onCheckedChange={(checked) => setCustomColumnValues({...customColumnValues, [column.id]: checked})}
                            data-testid={`checkbox-custom-${column.id}`}
                          />
                          <Label htmlFor={`custom-${column.id}`} className="text-[calc(13px*var(--ui-scale))] font-medium text-ink cursor-pointer">
                            {column.name}
                          </Label>
                        </div>
                      ) : (
                        <>
                          <Label htmlFor={`custom-${column.id}`} className={fieldLabel}>{column.name}</Label>
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
                        {column.type === 'select' && Array.isArray(column.options) && (
                          (() => {
                            // Radix Select rejects "" as a value (reserved for placeholder).
                            // Use a sentinel for "(none)" and translate at the boundary.
                            const NONE = "__otto_none__";
                            const current = customColumnValues[column.id];
                            return (
                              <Select
                                value={current ? String(current) : NONE}
                                onValueChange={(val) => setCustomColumnValues({
                                  ...customColumnValues,
                                  [column.id]: val === NONE ? null : (val || null),
                                })}
                              >
                                <SelectTrigger id={`custom-${column.id}`} data-testid={`select-custom-${column.id}`}>
                                  <SelectValue placeholder="Select..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>
                                    <span className="text-muted-foreground">(none)</span>
                                  </SelectItem>
                                  {column.options.map((opt: string) => (
                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            );
                          })()
                        )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

            </fieldset>
          </div>

          {/* Sticky footer — buttons stay anchored as the form scrolls.
              When the office has tracking-link auto-generate on AND
              this is a NEW job, a left-justified opt-out checkbox lets
              staff skip link generation for this particular patient
              without changing the office default.

              The left slot is always reserved in create-mode so the
              Cancel / Create buttons don't reflow when the office
              query resolves (used to flicker: officeAutoGenerate is
              false while loading, then true once settings arrive). */}
          <div className="flex items-center gap-2 px-6 py-3.5 border-t border-line bg-panel-2 shrink-0">
            {!readOnly && !job && (
              <div className="mr-auto min-h-[20px] flex items-center" data-testid="generate-tracking-link-checkbox-slot">
                {officeAutoGenerate && (
                  <label
                    className="flex items-center gap-2 text-[calc(12.5px*var(--ui-scale))] text-ink-2 cursor-pointer"
                    data-testid="generate-tracking-link-checkbox-row"
                  >
                    <Checkbox
                      checked={generateTrackingLink}
                      onCheckedChange={(v) => setGenerateTrackingLink(v === true)}
                      data-testid="checkbox-generate-tracking-link"
                    />
                    <Share2 className="h-3.5 w-3.5 text-otto-accent" aria-hidden />
                    Generate tracking link
                  </label>
                )}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel"
              className={(!readOnly && !job) ? "" : "ml-auto"}
            >
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button
                type="submit"
                size="sm"
                disabled={createJobMutation.isPending}
                data-testid="button-save-job"
              >
                {createJobMutation.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {job ? "Update Job" : "Create Job"}
              </Button>
            )}
          </div>
        </form>
        )}
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

// ── Bulk add (spreadsheet view) ────────────────────────────────────
//
// Spreadsheet-style multi-job creation. Columns are dynamic — driven
// by the office's job-type / lab options + any active custom columns.
// Tab/Shift+Tab moves between cells; Enter moves down one row (and
// adds a fresh row if the user is on the last one). Submit creates
// every row in parallel against the same POST /api/jobs handler the
// single-job form uses.

interface BulkAddProps {
  jobTypeOptions: { id: string; label: string }[];
  labOptions: { id: string; label: string }[];
  customColumns: any[];
  useTrayNumber: boolean;
  stickyLab: string;
  officeAutoGenerate: boolean;
  onClose: () => void;
}

interface BulkRow {
  id: string;
  patientFirstName: string;
  patientLastName: string;
  trayNumber: string;
  phone: string;
  jobType: string;
  orderDestination: string;
  custom: Record<string, string>;
}

interface BulkColumn {
  key: string;
  label: string;
  width: string;
  type: "text" | "select" | "tel" | "date" | "number";
  options?: { id: string; label: string }[];
  custom?: boolean;
}

function newBulkRow(stickyLab: string): BulkRow {
  return {
    id: (globalThis as any)?.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    patientFirstName: "",
    patientLastName: "",
    trayNumber: "",
    phone: "",
    jobType: "",
    orderDestination: stickyLab || "",
    custom: {},
  };
}

function BulkAddJobsTab({
  jobTypeOptions,
  labOptions,
  customColumns,
  useTrayNumber,
  stickyLab,
  officeAutoGenerate,
  onClose,
}: BulkAddProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Build the column layout once per render. Standard columns first,
  // then any office-defined custom columns. Identifier mode swaps in
  // tray number for patient name. Phone is always present (optional
  // per row) since the bulk surface has plenty of horizontal space.
  const columns: BulkColumn[] = useMemo(() => {
    const cols: BulkColumn[] = [];
    if (useTrayNumber) {
      cols.push({ key: "trayNumber", label: "Tray #", width: "w-[120px]", type: "text" });
    } else {
      cols.push({ key: "patientFirstName", label: "First name", width: "w-[140px]", type: "text" });
      cols.push({ key: "patientLastName", label: "Last name", width: "w-[140px]", type: "text" });
    }
    cols.push({ key: "phone", label: "Phone", width: "w-[140px]", type: "tel" });
    cols.push({ key: "jobType", label: "Job type", width: "w-[140px]", type: "select", options: jobTypeOptions });
    cols.push({ key: "orderDestination", label: "Lab", width: "w-[140px]", type: "select", options: labOptions });
    for (const col of customColumns) {
      cols.push({
        key: `custom:${col.id}`,
        label: col.name,
        width: "w-[140px]",
        type: col.type === "date" ? "date" : col.type === "number" ? "number" : "text",
        custom: true,
      });
    }
    return cols;
  }, [useTrayNumber, jobTypeOptions, labOptions, customColumns]);

  const [rows, setRows] = useState<BulkRow[]>(() => [newBulkRow(stickyLab), newBulkRow(stickyLab), newBulkRow(stickyLab)]);
  const [generateTrackingLink, setGenerateTrackingLink] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Track refs to every input so Tab can move forward and Enter can
  // move down without leaving the grid. Keyed by `${rowId}:${colKey}`.
  const cellRefs = useRef<Map<string, HTMLInputElement | HTMLButtonElement>>(new Map());

  const setCell = (rowId: string, key: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        if (key.startsWith("custom:")) {
          return { ...r, custom: { ...r.custom, [key.slice("custom:".length)]: value } };
        }
        return { ...r, [key]: value };
      }),
    );
    // Auto-append a fresh row when the user starts filling the last one.
    setRows((prev) => {
      const last = prev[prev.length - 1];
      if (last.id !== rowId) return prev;
      const anyFilled = ["patientFirstName", "patientLastName", "trayNumber", "phone", "jobType"].some(
        (k) => (last as any)[k]?.trim?.().length > 0,
      );
      if (anyFilled && prev.length < 50) {
        return [...prev, newBulkRow(stickyLab)];
      }
      return prev;
    });
  };

  const getCell = (row: BulkRow, key: string): string => {
    if (key.startsWith("custom:")) return row.custom[key.slice("custom:".length)] ?? "";
    return (row as any)[key] ?? "";
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== rowId)));
  };

  const focusCell = (rowId: string, colKey: string) => {
    const el = cellRefs.current.get(`${rowId}:${colKey}`);
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>, rowIdx: number, colIdx: number) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      let nextRow = rows[rowIdx + 1];
      if (!nextRow) {
        // On Enter at the last row, append a fresh one and focus the
        // same column on it. Matches Notion/Airtable behavior.
        const fresh = newBulkRow(stickyLab);
        setRows((prev) => [...prev, fresh]);
        setTimeout(() => focusCell(fresh.id, columns[colIdx].key), 0);
        return;
      }
      focusCell(nextRow.id, columns[colIdx].key);
    }
    // Tab is the browser default — we just need each cell to be
    // focusable in DOM order, which the rendering does.
  };

  // Validate a row enough to bother submitting it. Empty rows are
  // skipped silently; partial rows with no identifier OR no jobType
  // surface an inline error and block submit.
  const isRowEmpty = (r: BulkRow) => {
    const identifierEmpty = useTrayNumber ? !r.trayNumber.trim() : (!r.patientFirstName.trim() && !r.patientLastName.trim());
    return identifierEmpty && !r.jobType && !r.phone.trim() && Object.values(r.custom).every((v) => !v?.trim?.());
  };

  const validateRow = (r: BulkRow): string | null => {
    if (isRowEmpty(r)) return null; // skipped, not error
    if (useTrayNumber) {
      if (!r.trayNumber.trim()) return "Tray # is required";
    } else {
      if (!r.patientFirstName.trim() || !r.patientLastName.trim()) return "First and last name are required";
    }
    if (!r.jobType) return "Job type is required";
    if (!r.orderDestination) return "Lab is required";
    if (r.phone && r.phone.replace(/\D/g, "").length < 10) return "Phone must be at least 10 digits";
    return null;
  };

  const handleSubmit = async () => {
    const errors: Record<string, string> = {};
    const toSubmit: BulkRow[] = [];
    for (const r of rows) {
      if (isRowEmpty(r)) continue;
      const err = validateRow(r);
      if (err) errors[r.id] = err;
      else toSubmit.push(r);
    }
    if (Object.keys(errors).length > 0) {
      setRowErrors(errors);
      toast({ title: "Fix errors before creating jobs", description: `${Object.keys(errors).length} row(s) have problems.`, variant: "destructive" });
      return;
    }
    if (toSubmit.length === 0) {
      toast({ title: "Nothing to create", description: "Add at least one row.", variant: "destructive" });
      return;
    }
    setRowErrors({});
    setSubmitting(true);

    let okCount = 0;
    let failCount = 0;
    for (const r of toSubmit) {
      const clientJobId = (globalThis as any)?.crypto?.randomUUID?.() || `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const customColumnValues: Record<string, any> = {};
      for (const [k, v] of Object.entries(r.custom)) {
        if (v?.trim?.().length > 0) customColumnValues[k] = v;
      }
      try {
        await apiRequest("POST", "/api/jobs", {
          id: clientJobId,
          patientFirstName: useTrayNumber ? "" : normalizePatientNamePart(r.patientFirstName),
          patientLastName: useTrayNumber ? "" : normalizePatientNamePart(r.patientLastName),
          trayNumber: r.trayNumber || null,
          phone: r.phone ? r.phone.replace(/\D/g, "") : "",
          jobType: r.jobType,
          orderDestination: r.orderDestination,
          status: "job_created",
          createdAt: new Date(),
          isRedoJob: false,
          customColumnValues,
          generateTrackingLink: officeAutoGenerate && generateTrackingLink,
        });
        okCount++;
      } catch {
        failCount++;
      }
    }

    setSubmitting(false);
    queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    if (typeof window !== "undefined" && toSubmit[0]?.orderDestination) {
      try { window.localStorage.setItem(STICKY_LAB_STORAGE_KEY, toSubmit[0].orderDestination); } catch {}
    }

    if (failCount === 0) {
      toast({ title: `Created ${okCount} job${okCount === 1 ? "" : "s"}` });
      onClose();
    } else {
      toast({
        title: `${okCount} created, ${failCount} failed`,
        description: "Failed rows were left in the grid.",
        variant: failCount > okCount ? "destructive" : "default",
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-auto px-6 py-5">
        <p className="text-[calc(12.5px*var(--ui-scale))] text-ink-mute mb-3 m-0 leading-snug">
          Add several jobs at once. Tab moves between cells, Enter moves down a row, empty rows are skipped. Job type and Lab are required per row.
        </p>

        <div className="rounded-lg border border-line overflow-hidden" data-testid="bulk-grid">
          <table className="w-full border-collapse text-[calc(12.5px*var(--ui-scale))]">
            <thead className="bg-paper-2 text-ink-mute">
              <tr>
                <th className="w-8" />
                {columns.map((col) => (
                  <th key={col.key} className={cn("text-left font-medium px-2 py-1.5 border-b border-line", col.width)}>
                    {col.label}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => {
                const err = rowErrors[row.id];
                return (
                  <tr key={row.id} className={cn("group", err && "bg-danger/5")}>
                    <td className="px-1 text-center text-ink-faint text-[calc(11px*var(--ui-scale))] border-b border-line-2 select-none">
                      {rIdx + 1}
                    </td>
                    {columns.map((col, cIdx) => {
                      const cellKey = `${row.id}:${col.key}`;
                      const value = getCell(row, col.key);

                      if (col.type === "select") {
                        return (
                          <td key={col.key} className="border-b border-line-2 p-0">
                            <Select
                              value={value || undefined}
                              onValueChange={(v) => setCell(row.id, col.key, v)}
                            >
                              <SelectTrigger
                                className="h-8 border-0 rounded-none bg-transparent shadow-none focus:ring-1 focus:ring-otto-accent text-[calc(12.5px*var(--ui-scale))]"
                                ref={(el) => {
                                  if (el) cellRefs.current.set(cellKey, el);
                                  else cellRefs.current.delete(cellKey);
                                }}
                                onKeyDown={(e) => onKeyDown(e, rIdx, cIdx)}
                                data-testid={`bulk-cell-${col.key}-${rIdx}`}
                              >
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                {(col.options ?? []).map((opt) => (
                                  <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        );
                      }

                      return (
                        <td key={col.key} className="border-b border-line-2 p-0">
                          <input
                            type={col.type === "tel" ? "tel" : col.type === "date" ? "date" : col.type === "number" ? "number" : "text"}
                            value={value}
                            onChange={(e) => {
                              const next = col.type === "tel"
                                ? (e.target.value.replace(/[^\d]/g, "").length < 4
                                    ? e.target.value.replace(/[^\d]/g, "")
                                    : e.target.value.replace(/[^\d]/g, "").length < 7
                                      ? `(${e.target.value.replace(/[^\d]/g, "").slice(0, 3)}) ${e.target.value.replace(/[^\d]/g, "").slice(3)}`
                                      : `(${e.target.value.replace(/[^\d]/g, "").slice(0, 3)}) ${e.target.value.replace(/[^\d]/g, "").slice(3, 6)}-${e.target.value.replace(/[^\d]/g, "").slice(6, 10)}`)
                                : e.target.value;
                              setCell(row.id, col.key, next);
                            }}
                            ref={(el) => {
                              if (el) cellRefs.current.set(cellKey, el);
                              else cellRefs.current.delete(cellKey);
                            }}
                            onKeyDown={(e) => onKeyDown(e, rIdx, cIdx)}
                            className="w-full h-8 px-2 bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-otto-accent focus:bg-white"
                            data-testid={`bulk-cell-${col.key}-${rIdx}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-1 border-b border-line-2 text-right">
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-ink-faint hover:text-danger"
                          aria-label={`Remove row ${rIdx + 1}`}
                          data-testid={`bulk-remove-${rIdx}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {Object.keys(rowErrors).length > 0 && (
          <div className="mt-3 space-y-1 text-[calc(11.5px*var(--ui-scale))] text-danger">
            {rows.map((r, i) => rowErrors[r.id]
              ? <div key={r.id} data-testid={`bulk-error-${i}`}>Row {i + 1}: {rowErrors[r.id]}</div>
              : null)}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, newBulkRow(stickyLab)])}
            className="text-[calc(12px*var(--ui-scale))] text-ink-mute hover:text-ink px-1 py-1"
            data-testid="bulk-add-row"
          >
            + Add row
          </button>
          <span className="text-[calc(11px*var(--ui-scale))] text-ink-faint">
            {rows.filter((r) => !isRowEmpty(r)).length} non-empty row{rows.filter((r) => !isRowEmpty(r)).length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 px-6 py-3.5 border-t border-line bg-panel-2 shrink-0">
        {officeAutoGenerate && (
          <label className="mr-auto flex items-center gap-2 text-[calc(12.5px*var(--ui-scale))] text-ink-2 cursor-pointer">
            <Checkbox
              checked={generateTrackingLink}
              onCheckedChange={(v) => setGenerateTrackingLink(v === true)}
              data-testid="bulk-checkbox-generate-tracking-link"
            />
            <Share2 className="h-3.5 w-3.5 text-otto-accent" aria-hidden />
            Generate tracking links
          </label>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onClose} data-testid="bulk-button-cancel">
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={submitting}
          data-testid="bulk-button-create"
        >
          {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          <Save className="mr-1.5 h-3.5 w-3.5" />
          Create jobs
        </Button>
      </div>
    </div>
  );
}
