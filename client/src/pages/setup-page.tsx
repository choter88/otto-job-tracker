import { useMemo, useState } from "react";
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
import {
  Loader2,
  LogIn,
  Building2,
  UserPlus,
  ShieldAlert,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

const LOGIN_ID_REGEX = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/i;
const PIN_REGEX = /^\d{6}$/;

// --- Types ---

type PortalOffice = {
  officeId: string;
  officeName: string;
  role: string;
};

type PortalAuthResponse = {
  token: string;
  expiresAt: number;
  offices: PortalOffice[];
  firstName?: string;
  lastName?: string;
  email?: string;
};

type SetupStatus = {
  initialized: boolean;
  officeId: string | null;
  officeName: string | null;
  selfSignupEnabled: boolean;
};

// --- Schemas ---

const signInSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type SignInFormData = z.infer<typeof signInSchema>;

const adminSchema = z
  .object({
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
    adminPinConfirm: z.string().regex(PIN_REGEX, "Confirm your PIN"),
  })
  .refine((data) => data.adminPin === data.adminPinConfirm, {
    message: "PINs do not match",
    path: ["adminPinConfirm"],
  });

type AdminFormData = z.infer<typeof adminSchema>;

// --- Component ---

export default function SetupPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Flow state
  const [step, setStep] = useState<"signin" | "office" | "admin">("signin");
  const [portalAuth, setPortalAuth] = useState<PortalAuthResponse | null>(null);
  const [selectedOffice, setSelectedOffice] = useState<PortalOffice | null>(null);
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

  const signInForm = useForm<SignInFormData>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const adminForm = useForm<AdminFormData>({
    resolver: zodResolver(adminSchema),
    defaultValues: {
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

  // --- Portal sign-in ---
  const signInMutation = useMutation({
    mutationFn: async (data: SignInFormData) => {
      const res = await fetch("/api/setup/portal-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: data.email, password: data.password }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Sign-in failed");
      }
      return payload as PortalAuthResponse;
    },
    onSuccess: (data) => {
      setPortalAuth(data);

      // Pre-fill admin name from portal user
      if (data.firstName) adminForm.setValue("adminFirstName", data.firstName);
      if (data.lastName) adminForm.setValue("adminLastName", data.lastName);
      if (data.email) {
        const emailLocal = data.email.split("@")[0] || "";
        const sanitized = emailLocal.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
        if (sanitized.length >= 3) adminForm.setValue("adminLoginId", sanitized);
      }

      if (data.offices.length === 1) {
        // Auto-select single office and skip to admin step
        const office = data.offices[0];
        setSelectedOffice(office);
        adminForm.setValue("officeName", office.officeName, { shouldValidate: true });
        setStep("admin");
      } else if (data.offices.length > 1) {
        setStep("office");
      } else {
        toast({
          title: "No practices found",
          description: "Your portal account has no practices. Create one at ottojobtracker.com first.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Sign-in failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // --- Bootstrap (final submit) ---
  const bootstrapMutation = useMutation({
    mutationFn: async (data: AdminFormData) => {
      if (!portalAuth || !selectedOffice) throw new Error("Missing portal authentication");

      const res = await fetch("/api/setup/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          portalToken: portalAuth.token,
          officeId: selectedOffice.officeId,
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
        const message = payload?.error || payload?.message || "Setup failed";
        const details = Array.isArray(payload?.details) ? payload.details.join("\n") : null;
        throw new Error(details ? `${message}\n${details}` : message);
      }
      return payload as { ok: true; office: any; user: any; license?: any };
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(["/api/user"], payload.user);
      queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
      toast({ title: "Setup complete", description: "Your office is ready." });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({ title: "Setup failed", description: error.message, variant: "destructive" });
    },
  });

  // --- Import with snapshot ---
  const importMutation = useMutation({
    mutationFn: async (data: AdminFormData) => {
      if (!portalAuth || !selectedOffice) throw new Error("Missing portal authentication");
      if (!snapshot) throw new Error("Please choose a migration snapshot file.");

      const res = await fetch("/api/setup/import-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          portalToken: portalAuth.token,
          officeId: selectedOffice.officeId,
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
        const message = payload?.error || payload?.message || "Import failed";
        const details = Array.isArray(payload?.details) ? payload.details.join("\n") : null;
        throw new Error(details ? `${message}\n${details}` : message);
      }
      return payload as { ok: true; office: any; user: any; importedCounts?: Record<string, number> };
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(["/api/user"], payload.user);
      queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
      toast({ title: "Import complete", description: "Your office data is imported." });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  // --- Helpers ---

  const handleSelectOffice = (officeId: string) => {
    const office = portalAuth?.offices.find((o) => o.officeId === officeId);
    if (!office) return;
    setSelectedOffice(office);
    adminForm.setValue("officeName", office.officeName, { shouldValidate: true });
    setStep("admin");
  };

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

      if (!parsed || typeof parsed !== "object") throw new Error("File is not a valid JSON snapshot.");
      if (parsed.format !== "otto-snapshot" || parsed.version !== 1) {
        throw new Error("This snapshot file is not supported.");
      }

      setSnapshot(parsed);

      const office = parsed.office || {};
      const officeName = typeof office.name === "string" ? office.name : "";
      if (officeName) adminForm.setValue("officeName", officeName, { shouldValidate: true });
      if (typeof office.address === "string") adminForm.setValue("officeAddress", office.address);
      if (typeof office.phone === "string") adminForm.setValue("officePhone", office.phone);
      if (typeof office.email === "string") adminForm.setValue("officeEmail", office.email);

      setSnapshotPreview({
        officeName: officeName || "Office",
        users: Array.isArray(parsed.users) ? parsed.users.length : 0,
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs.length : 0,
        archivedJobs: Array.isArray(parsed.archivedJobs) ? parsed.archivedJobs.length : 0,
        comments: Array.isArray(parsed.jobComments) ? parsed.jobComments.length : 0,
      });
    } catch (error: any) {
      setSnapshot(null);
      setSnapshotPreview(null);
      setSnapshotError(error?.message || "Could not read this snapshot file.");
    }
  };

  const onAdminSubmit = (data: AdminFormData) => {
    if (setupMode === "import") {
      importMutation.mutate(data);
    } else {
      bootstrapMutation.mutate(data);
    }
  };

  // --- Loading ---

  const loading = authLoading || statusLoading;
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // --- Non-localhost guard ---

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

  // --- Already initialized ---

  if (setupStatus?.initialized) {
    setLocation(user ? "/" : "/auth");
    return null;
  }

  const isSubmitting = bootstrapMutation.isPending || importMutation.isPending;

  // ============================
  // Step 1: Portal sign-in
  // ============================
  if (step === "signin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="w-full max-w-5xl space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground mb-2">Set up Otto Tracker</h1>
            <p className="text-muted-foreground">
              Sign in with your ottojobtracker.com account to get started.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left: instructions */}
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>How setup works</CardTitle>
                <CardDescription>Quick overview of what happens next.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Sign in with your Otto portal account to verify your practice.</li>
                  <li>Choose which practice to set up on this computer.</li>
                  <li>Create the first owner login (stored locally on this computer).</li>
                </ol>
                <Alert>
                  <AlertDescription>
                    This step requires internet access to verify your account. No patient data is sent.
                  </AlertDescription>
                </Alert>
                <Alert>
                  <AlertDescription>
                    Not the Host computer? Use <b>File &rarr; Change Connection&hellip;</b> to switch this computer to Client.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* Right: sign-in form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LogIn className="h-5 w-5 text-primary" />
                  Sign in to Otto
                </CardTitle>
                <CardDescription>
                  Use the email and password from your ottojobtracker.com account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={signInForm.handleSubmit((data) => signInMutation.mutate(data))}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      {...signInForm.register("email")}
                      disabled={signInMutation.isPending}
                      data-testid="input-portal-email"
                    />
                    {signInForm.formState.errors.email && (
                      <p className="text-sm text-destructive">{signInForm.formState.errors.email.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      {...signInForm.register("password")}
                      disabled={signInMutation.isPending}
                      data-testid="input-portal-password"
                    />
                    {signInForm.formState.errors.password && (
                      <p className="text-sm text-destructive">{signInForm.formState.errors.password.message}</p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={signInMutation.isPending}
                  >
                    {signInMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign in &amp; continue
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    <a
                      href="https://ottojobtracker.com/portal/reset"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      Forgot your password?
                    </a>
                  </p>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ============================
  // Step 2: Select practice
  // ============================
  if (step === "office" && portalAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground mb-2">Choose your practice</h1>
            <p className="text-muted-foreground">
              Your account has access to multiple practices. Select the one to set up on this computer.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Your practices
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {portalAuth.offices.map((office) => (
                <Button
                  key={office.officeId}
                  variant="outline"
                  className="w-full justify-start text-left h-auto py-3"
                  onClick={() => handleSelectOffice(office.officeId)}
                >
                  <div>
                    <div className="font-medium">{office.officeName}</div>
                    {office.role && (
                      <div className="text-xs text-muted-foreground capitalize">{office.role}</div>
                    )}
                  </div>
                </Button>
              ))}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep("signin");
                  setPortalAuth(null);
                }}
                className="mt-2"
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Use a different account
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ============================
  // Step 3: Office details + admin account
  // ============================
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 to-accent/5">
      <div className="w-full max-w-5xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground mb-2">Set up Otto Tracker</h1>
          <p className="text-muted-foreground">
            Confirm your office details and create the first owner login.
          </p>
        </div>

        <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertDescription className="text-emerald-700 dark:text-emerald-300">
            Signed in as {portalAuth?.email || portalAuth?.firstName}. Setting up <b>{selectedOffice?.officeName}</b>.
          </AlertDescription>
        </Alert>

        <form onSubmit={adminForm.handleSubmit(onAdminSubmit)} className="grid gap-6 lg:grid-cols-2">
          {/* Left: Office details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Office details
              </CardTitle>
              <CardDescription>
                {setupMode === "import"
                  ? "These are loaded from the snapshot. You can adjust them now or later in Settings."
                  : "Pre-filled from your portal account. Edit if needed."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="officeName">Office name *</Label>
                <Input
                  id="officeName"
                  placeholder="Smith Eye Care"
                  {...adminForm.register("officeName")}
                  data-testid="input-office-name"
                />
                {adminForm.formState.errors.officeName && (
                  <p className="text-sm text-destructive">{adminForm.formState.errors.officeName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="officeAddress">Address</Label>
                <Input id="officeAddress" placeholder="123 Main St" {...adminForm.register("officeAddress")} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="officePhone">Phone</Label>
                  <Input id="officePhone" placeholder="(555) 123-4567" {...adminForm.register("officePhone")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="officeEmail">Office email</Label>
                  <Input id="officeEmail" placeholder="contact@practice.com" {...adminForm.register("officeEmail")} />
                  {adminForm.formState.errors.officeEmail && (
                    <p className="text-sm text-destructive">{adminForm.formState.errors.officeEmail.message}</p>
                  )}
                </div>
              </div>

              {/* Migration option */}
              <div className="pt-3 border-t">
                <Label className="text-xs text-muted-foreground mb-2 block">Data migration (optional)</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={setupMode === "new" ? "default" : "secondary"}
                    onClick={() => { setSetupMode("new"); setSnapshotError(null); }}
                  >
                    Start fresh
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={setupMode === "import" ? "default" : "secondary"}
                    onClick={() => setSetupMode("import")}
                  >
                    Import snapshot
                  </Button>
                </div>

                {setupMode === "import" && (
                  <div className="space-y-2 mt-3">
                    <Label htmlFor="snapshotFile">Snapshot file *</Label>
                    <Input
                      id="snapshotFile"
                      type="file"
                      accept=".otto-snapshot.json,application/json"
                      onChange={(event) => handleSnapshotFile(event.target.files?.[0] || null)}
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
                        In Otto Web, export a migration snapshot file. Import is only available on a fresh Host (no existing data).
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Right: Admin account */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                Create the owner login
              </CardTitle>
              <CardDescription>
                This owner login controls approvals and office settings. Your name has been pre-filled from your portal account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adminFirstName">First name *</Label>
                  <Input id="adminFirstName" {...adminForm.register("adminFirstName")} />
                  {adminForm.formState.errors.adminFirstName && (
                    <p className="text-sm text-destructive">{adminForm.formState.errors.adminFirstName.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminLastName">Last name *</Label>
                  <Input id="adminLastName" {...adminForm.register("adminLastName")} />
                  {adminForm.formState.errors.adminLastName && (
                    <p className="text-sm text-destructive">{adminForm.formState.errors.adminLastName.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="adminLoginId">Login ID *</Label>
                <Input id="adminLoginId" placeholder="jane.cho" {...adminForm.register("adminLoginId")} />
                <p className="text-xs text-muted-foreground">3-32 characters. Use letters, numbers, ".", "-", or "_".</p>
                {adminForm.formState.errors.adminLoginId && (
                  <p className="text-sm text-destructive">{adminForm.formState.errors.adminLoginId.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adminPin">6-digit PIN *</Label>
                  <Input
                    id="adminPin"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    {...adminForm.register("adminPin")}
                  />
                  {adminForm.formState.errors.adminPin && (
                    <p className="text-sm text-destructive">{adminForm.formState.errors.adminPin.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminPinConfirm">Confirm PIN *</Label>
                  <Input
                    id="adminPinConfirm"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    {...adminForm.register("adminPinConfirm")}
                  />
                  {adminForm.formState.errors.adminPinConfirm && (
                    <p className="text-sm text-destructive">{adminForm.formState.errors.adminPinConfirm.message}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Bottom: submit */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (portalAuth && portalAuth.offices.length > 1) {
                    setStep("office");
                  } else {
                    setStep("signin");
                    setPortalAuth(null);
                    setSelectedOffice(null);
                  }
                }}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back
              </Button>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || (setupMode === "import" && !snapshot)}
              data-testid="button-complete-setup"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {setupMode === "import" ? "Import & complete setup" : "Complete setup"}
            </Button>
            {setupMode === "import" && !snapshot && (
              <p className="text-xs text-muted-foreground">Choose a snapshot file above to enable import.</p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
