import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, KeyRound, Building2, UserPlus, ShieldAlert, ArrowLeft, CheckCircle2 } from "lucide-react";

const ACTIVATION_CODE_REGEX = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/;
const SETUP_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{5,95}$/i;
const LOGIN_ID_REGEX = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/i;
const PIN_REGEX = /^\d{6}$/;

function normalizeSetupCode(raw: string): string {
  const value = String(raw || "").trim().replace(/\s+/g, "");
  if (!value) return "";
  return value.toUpperCase();
}

function formatSetupCode(raw: string): string {
  const normalized = normalizeSetupCode(raw);
  if (!normalized) return "";

  const activationCompact = normalized.replace(/[^A-Z0-9]/g, "").replace(/[IO01]/g, "");
  if (activationCompact.length <= 16) {
    const groups = activationCompact.match(/.{1,4}/g) || [];
    return groups.slice(0, 4).join("-").slice(0, 19);
  }

  return normalized.replace(/[^A-Z0-9_-]/g, "").slice(0, 96);
}

const setupSchema = z
  .object({
    activationCode: z
      .string()
      .min(1, "Host Claim Code is required")
      .refine((val) => {
        const normalized = normalizeSetupCode(val);
        if (!normalized) return false;
        if (ACTIVATION_CODE_REGEX.test(normalized)) return true;
        return SETUP_CODE_REGEX.test(normalized);
      }, {
        message: "Enter a valid Host Claim Code (or legacy Activation Code).",
      }),
    officeName: z.string().min(1, "Office name is required"),
    officeAddress: z.string().optional(),
    officePhone: z.string().optional(),
    officeEmail: z.string().email("Please enter a valid email").optional().or(z.literal("")),
    adminFirstName: z.string().min(1, "First name is required"),
    adminLastName: z.string().min(1, "Last name is required"),
    adminLoginId: z
      .string()
      .min(3, "Login ID must be at least 3 characters")
      .max(32, "Login ID must be 32 characters or fewer")
      .regex(LOGIN_ID_REGEX, "Login ID can use letters, numbers, '.', '-', and '_'"),
    adminPin: z.string().regex(PIN_REGEX, "PIN must be exactly 6 digits"),
    adminPinConfirm: z.string().optional(),
  })
  .refine((data) => {
    if (!data.adminPinConfirm) return true;
    return data.adminPin === data.adminPinConfirm;
  }, {
    message: "PINs do not match",
    path: ["adminPinConfirm"],
  });

type SetupFormData = z.infer<typeof setupSchema>;

type ClaimData = {
  validated: boolean;
  fallbackToConsume?: boolean;
  office?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    portalOfficeId?: string;
  };
  portalUser?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
};

type SetupStatus = {
  initialized: boolean;
  officeId: string | null;
  officeName: string | null;
  selfSignupEnabled: boolean;
};

export default function SetupPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [setupStep, setSetupStep] = useState<"claim" | "details">("claim");
  const [claimData, setClaimData] = useState<ClaimData | null>(null);
  const [setupMode, setSetupMode] = useState<"new" | "import">("new");
  const [snapshot, setSnapshot] = useState<any | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotPreview, setSnapshotPreview] = useState<{
    officeName: string;
    users: number;
    jobs: number;
    archivedJobs: number;
    comments: number;
  } | null>(null);

  const isLocalHost = useMemo(() => {
    const host = window.location.hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  }, []);

  const { data: setupStatus, isLoading: statusLoading } = useQuery<SetupStatus>({
    queryKey: ["/api/setup/status"],
  });

  const form = useForm<SetupFormData>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      activationCode: "",
      officeName: "",
      officeAddress: "",
      officePhone: "",
      officeEmail: "",
      adminFirstName: "",
      adminLastName: "",
      adminLoginId: "",
      adminPin: "",
      adminPinConfirm: "",
    },
  });

  const setupCodeValue = form.watch("activationCode");

  const hasPortalUser = Boolean(claimData?.portalUser);

  // --- Verify claim mutation (step 1 → step 2) ---
  const verifyClaimMutation = useMutation({
    mutationFn: async (code: string) => {
      const setupCode = normalizeSetupCode(code);
      const res = await fetch("/api/setup/verify-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ setupCode, claimCode: setupCode, activationCode: setupCode }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const message = payload?.error || payload?.message || res.statusText || "Verification failed";
        throw new Error(message);
      }
      return payload as ClaimData;
    },
    onSuccess: (data) => {
      setClaimData(data);

      // Pre-fill office fields from portal response
      if (data.office) {
        if (data.office.name) form.setValue("officeName", data.office.name, { shouldValidate: true });
        if (data.office.address) form.setValue("officeAddress", data.office.address);
        if (data.office.phone) form.setValue("officePhone", data.office.phone);
        if (data.office.email) form.setValue("officeEmail", data.office.email);
      }

      // Pre-fill owner fields from portal user
      if (data.portalUser) {
        if (data.portalUser.firstName) form.setValue("adminFirstName", data.portalUser.firstName);
        if (data.portalUser.lastName) form.setValue("adminLastName", data.portalUser.lastName);
        if (data.portalUser.email) {
          // Derive login ID from portal email (local part)
          const emailLocal = data.portalUser.email.split("@")[0] || "";
          const sanitized = emailLocal.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
          if (sanitized.length >= 3 && !form.getValues("adminLoginId")) {
            form.setValue("adminLoginId", sanitized);
          }
        }
      }

      setSetupStep("details");
    },
    onError: (error: Error) => {
      toast({
        title: "Claim verification failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Load pending activation code from Electron bridge
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const bridge = (window as any)?.otto;
        if (!bridge?.getPendingActivationCode) return;
        const pending = await bridge.getPendingActivationCode();
        if (cancelled) return;
        if (typeof pending !== "string") return;

        const trimmed = formatSetupCode(pending.trim());
        if (!trimmed) return;

        const current = form.getValues("activationCode");
        if (!current) {
          form.setValue("activationCode", trimmed, { shouldValidate: true });
          // Auto-verify the pending code
          verifyClaimMutation.mutate(trimmed);
        }
      } catch {
        // ignore
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bootstrapMutation = useMutation({
    mutationFn: async (data: SetupFormData) => {
      const setupCode = normalizeSetupCode(data.activationCode);
      const res = await fetch("/api/setup/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          setupCode,
          claimCode: setupCode,
          activationCode: setupCode,
          office: {
            name: data.officeName,
            address: data.officeAddress || undefined,
            phone: data.officePhone || undefined,
            email: data.officeEmail || undefined,
          },
          admin: {
            firstName: data.adminFirstName,
            lastName: data.adminLastName,
            loginId: data.adminLoginId,
            pin: data.adminPin,
          },
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const message = payload?.error || payload?.message || res.statusText || "Setup failed";
        const details = Array.isArray(payload?.details) ? payload.details.join("\n") : null;
        throw new Error(details ? `${message}\n${details}` : message);
      }

      return payload as {
        ok: true;
        office: any;
        user: any;
        activationWarning?: string | null;
      };
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(["/api/user"], payload.user);
      queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
      try {
        (window as any)?.otto?.clearPendingActivationCode?.();
      } catch {
        // ignore
      }
      toast({
        title: "Setup complete",
        description: "Your office is ready.",
      });

      if (payload.activationWarning) {
        toast({
          title: "Activation not verified yet",
          description: payload.activationWarning,
        });
      }

      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Setup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: SetupFormData) => {
      if (!snapshot) {
        throw new Error("Please choose a migration snapshot file.");
      }
      const setupCode = normalizeSetupCode(data.activationCode);

      const res = await fetch("/api/setup/import-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          setupCode,
          claimCode: setupCode,
          activationCode: setupCode,
          snapshot,
          office: {
            name: data.officeName,
            address: data.officeAddress || undefined,
            phone: data.officePhone || undefined,
            email: data.officeEmail || undefined,
          },
          admin: {
            firstName: data.adminFirstName,
            lastName: data.adminLastName,
            loginId: data.adminLoginId,
            pin: data.adminPin,
          },
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const message = payload?.error || payload?.message || res.statusText || "Import failed";
        const details = Array.isArray(payload?.details) ? payload.details.join("\n") : null;
        throw new Error(details ? `${message}\n${details}` : message);
      }

      return payload as {
        ok: true;
        office: any;
        user: any;
        importedCounts?: Record<string, number>;
        activationWarning?: string | null;
      };
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(["/api/user"], payload.user);
      queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
      try {
        (window as any)?.otto?.clearPendingActivationCode?.();
      } catch {
        // ignore
      }

      toast({
        title: "Import complete",
        description: "Your office data is imported.",
      });

      if (payload.activationWarning) {
        toast({
          title: "Activation not verified yet",
          description: payload.activationWarning,
        });
      }

      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const loading = authLoading || statusLoading;
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isLocalHost) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <div className="flex items-center justify-center w-16 h-16 bg-destructive/10 rounded-xl mb-4 mx-auto">
              <ShieldAlert className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-center">Setup must be done on the Host</CardTitle>
            <CardDescription className="text-center">
              This office hasn't been set up yet. Please open Otto Tracker on the Host computer and complete setup there.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>After the Host is set up, come back to this computer and sign in.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (setupStatus?.initialized) {
    setLocation(user ? "/" : "/auth");
    return null;
  }

  const handleSnapshotFile = async (file: File | null) => {
    if (!file) {
      setSnapshot(null);
      setSnapshotError(null);
      setSnapshotPreview(null);
      return;
    }

    setSnapshotError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== "object") {
        throw new Error("File is not a valid JSON snapshot.");
      }

      const format = (parsed as any).format;
      const version = (parsed as any).version;
      if (format !== "otto-snapshot" || version !== 1) {
        throw new Error("This snapshot file is not supported.");
      }

      setSnapshot(parsed);

      const office = (parsed as any).office || {};
      const officeName = typeof office?.name === "string" ? office.name : "";
      const officeAddress = typeof office?.address === "string" ? office.address : "";
      const officePhone = typeof office?.phone === "string" ? office.phone : "";
      const officeEmail = typeof office?.email === "string" ? office.email : "";

      form.setValue("officeName", officeName || "", { shouldValidate: true });
      form.setValue("officeAddress", officeAddress || "");
      form.setValue("officePhone", officePhone || "");
      form.setValue("officeEmail", officeEmail || "");

      setSnapshotPreview({
        officeName: officeName || "Office",
        users: Array.isArray((parsed as any).users) ? (parsed as any).users.length : 0,
        jobs: Array.isArray((parsed as any).jobs) ? (parsed as any).jobs.length : 0,
        archivedJobs: Array.isArray((parsed as any).archivedJobs) ? (parsed as any).archivedJobs.length : 0,
        comments: Array.isArray((parsed as any).jobComments) ? (parsed as any).jobComments.length : 0,
      });
    } catch (error: any) {
      setSnapshot(null);
      setSnapshotPreview(null);
      setSnapshotError(error?.message || "Could not read this snapshot file.");
    }
  };

  const handleVerifyClaim = async () => {
    const valid = await form.trigger("activationCode");
    if (!valid) return;
    const code = form.getValues("activationCode");
    verifyClaimMutation.mutate(code);
  };

  const onSubmit = (data: SetupFormData) => {
    if (setupMode === "import") {
      importMutation.mutate(data);
    } else {
      bootstrapMutation.mutate(data);
    }
  };

  const isSubmitting = bootstrapMutation.isPending || importMutation.isPending;
  const isVerifying = verifyClaimMutation.isPending;
  const importMissingFile = setupMode === "import" && !snapshot;

  // --- Step 1: Claim code entry (side-by-side: instructions | actions) ---
  if (setupStep === "claim") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="w-full max-w-5xl space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground mb-2">Set up Otto Tracker</h1>
            <p className="text-muted-foreground">
              Enter your Host Claim Code to get started. We'll verify it online and pre-fill your office details.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left column: instructions */}
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Before you start</CardTitle>
                <CardDescription>What this setup does and why.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Enter your Host Claim Code to verify your office setup (no patient data is sent).</li>
                  <li>Create your office record and first owner login (local to this office).</li>
                  <li>After setup, new users can request access from the sign-in screen and be approved in <b>Team</b>.</li>
                </ol>
                <Alert>
                  <AlertDescription>
                    This Host setup step requires internet access to verify your Host Claim Code.
                  </AlertDescription>
                </Alert>
                <Alert>
                  <AlertDescription>
                    Not the Host computer? Use <b>File → Change Connection…</b> to switch this computer to Client.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* Right column: claim code + migration */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-primary" />
                    Host claim
                  </CardTitle>
                  <CardDescription>
                    Paste the Host Claim Code from your portal handoff screen. Legacy Activation Codes are still accepted during
                    transition.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="activationCode">Host Claim Code *</Label>
                    <Input
                      id="activationCode"
                      placeholder="CLAIM-XXXX-XXXX or XXXX-XXXX-XXXX-XXXX"
                      value={setupCodeValue}
                      onChange={(event) => {
                        form.setValue("activationCode", formatSetupCode(event.target.value), {
                          shouldValidate: true,
                        });
                      }}
                      disabled={isVerifying}
                      data-testid="input-activation-code"
                    />
                    {form.formState.errors.activationCode && (
                      <p className="text-sm text-destructive">{form.formState.errors.activationCode.message}</p>
                    )}
                  </div>

                  <Button
                    type="button"
                    className="w-full"
                    disabled={isVerifying || !setupCodeValue}
                    onClick={handleVerifyClaim}
                  >
                    {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Verify & Continue
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Office migration (optional)</CardTitle>
                  <CardDescription>
                    If you used the hosted Otto web app, import a snapshot to bring your office data to this Host.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      type="button"
                      variant={setupMode === "new" ? "default" : "secondary"}
                      onClick={() => {
                        setSetupMode("new");
                        setSnapshotError(null);
                      }}
                    >
                      Start fresh
                    </Button>
                    <Button
                      type="button"
                      variant={setupMode === "import" ? "default" : "secondary"}
                      onClick={() => setSetupMode("import")}
                    >
                      Import snapshot
                    </Button>
                  </div>

                  {setupMode === "import" && (
                    <div className="space-y-2">
                      <Label htmlFor="snapshotFile">Snapshot file *</Label>
                      <Input
                        id="snapshotFile"
                        type="file"
                        accept=".otto-snapshot.json,application/json"
                        onChange={(event) => handleSnapshotFile(event.target.files?.[0] || null)}
                        disabled={isVerifying}
                      />
                      {snapshotError && <p className="text-sm text-destructive">{snapshotError}</p>}

                      {snapshotPreview && (
                        <div className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
                          <div className="font-medium text-foreground mb-1">{snapshotPreview.officeName}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>Users: {snapshotPreview.users}</div>
                            <div>Active jobs: {snapshotPreview.jobs}</div>
                            <div>Archived jobs: {snapshotPreview.archivedJobs}</div>
                            <div>Comments: {snapshotPreview.comments}</div>
                          </div>
                        </div>
                      )}

                      <Alert>
                        <AlertDescription>
                          In Otto Web, export a migration snapshot file. Import is only available on a fresh Host (no existing
                          data).
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Step 2: Office details + owner login (pre-filled from claim verification) ---
  const preFilledFromPortal = claimData && !claimData.fallbackToConsume && Boolean(claimData.office?.name || claimData.portalUser?.firstName);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 to-accent/5">
      <div className="w-full max-w-5xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground mb-2">Set up Otto Tracker</h1>
          <p className="text-muted-foreground">
            {preFilledFromPortal
              ? "We've pre-filled your office details from the portal. Confirm everything looks right and create your owner login."
              : "Enter your office details and create the first owner login."}
          </p>
        </div>

        {preFilledFromPortal && (
          <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="text-emerald-700 dark:text-emerald-300">
              Claim code verified. Office details have been pre-filled from your portal account.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Office details
              </CardTitle>
              <CardDescription>
                {setupMode === "import"
                  ? "These are loaded from the snapshot. You can adjust them now or later in Settings."
                  : preFilledFromPortal
                    ? "Pre-filled from your portal account — edit if needed."
                    : "This is shown inside the app for your team."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="officeName">Office name *</Label>
                <Input
                  id="officeName"
                  placeholder="Smith Eye Care"
                  {...form.register("officeName")}
                  data-testid="input-office-name"
                />
                {form.formState.errors.officeName && (
                  <p className="text-sm text-destructive">{form.formState.errors.officeName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="officeAddress">Address</Label>
                <Input id="officeAddress" placeholder="123 Main St" {...form.register("officeAddress")} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="officePhone">Phone</Label>
                  <Input id="officePhone" placeholder="(555) 123-4567" {...form.register("officePhone")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="officeEmail">Office email</Label>
                  <Input id="officeEmail" placeholder="contact@practice.com" {...form.register("officeEmail")} />
                  {form.formState.errors.officeEmail && (
                    <p className="text-sm text-destructive">{form.formState.errors.officeEmail.message}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                Create the owner login
              </CardTitle>
              <CardDescription>
                {hasPortalUser
                  ? "Pre-filled from your portal account — edit if needed. This owner login controls approvals and office settings."
                  : "This owner login controls approvals and office settings so your team can start work quickly and safely."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adminFirstName">First name *</Label>
                  <Input id="adminFirstName" {...form.register("adminFirstName")} />
                  {form.formState.errors.adminFirstName && (
                    <p className="text-sm text-destructive">{form.formState.errors.adminFirstName.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminLastName">Last name *</Label>
                  <Input id="adminLastName" {...form.register("adminLastName")} />
                  {form.formState.errors.adminLastName && (
                    <p className="text-sm text-destructive">{form.formState.errors.adminLastName.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="adminLoginId">Login ID *</Label>
                <Input id="adminLoginId" placeholder="jane.cho" {...form.register("adminLoginId")} />
                <p className="text-xs text-muted-foreground">3-32 characters. Use letters, numbers, ".", "-", or "_".</p>
                {form.formState.errors.adminLoginId && (
                  <p className="text-sm text-destructive">{form.formState.errors.adminLoginId.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adminPin">6-digit PIN *</Label>
                  <Input id="adminPin" type="password" inputMode="numeric" maxLength={6} {...form.register("adminPin")} />
                  {form.formState.errors.adminPin && (
                    <p className="text-sm text-destructive">{form.formState.errors.adminPin.message}</p>
                  )}
                </div>
                {!hasPortalUser && (
                  <div className="space-y-2">
                    <Label htmlFor="adminPinConfirm">Confirm PIN *</Label>
                    <Input
                      id="adminPinConfirm"
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      {...form.register("adminPinConfirm")}
                    />
                    {form.formState.errors.adminPinConfirm && (
                      <p className="text-sm text-destructive">{form.formState.errors.adminPinConfirm.message}</p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="lg:col-span-2 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="activationCodeDisplay" className="text-muted-foreground text-xs">Verified claim code</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="activationCodeDisplay"
                  value={setupCodeValue}
                  disabled
                  className="bg-muted max-w-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSetupStep("claim");
                    setClaimData(null);
                  }}
                >
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Change
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || importMissingFile}
              data-testid="button-complete-setup"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {setupMode === "import" ? "Import & complete setup" : "Complete setup"}
            </Button>
            {importMissingFile && (
              <p className="text-xs text-muted-foreground">Choose a snapshot file above to enable import.</p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
