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
import { Loader2, KeyRound, Building2, UserPlus, ShieldAlert } from "lucide-react";

const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
    "Password must contain at least one special character",
  );

const ACTIVATION_CODE_REGEX = /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/;

const setupSchema = z
  .object({
    activationCode: z
      .string()
      .min(1, "Activation Code is required")
      .refine((val) => ACTIVATION_CODE_REGEX.test(val), {
        message: "Activation Code must look like XXXX-XXXX-XXXX-XXXX",
      }),
    officeName: z.string().min(1, "Office name is required"),
    officeAddress: z.string().optional(),
    officePhone: z.string().optional(),
    officeEmail: z.string().email("Please enter a valid email").optional().or(z.literal("")),
    adminFirstName: z.string().min(1, "First name is required"),
    adminLastName: z.string().min(1, "Last name is required"),
    adminEmail: z.string().email("Please enter a valid email address"),
    adminPassword: passwordSchema,
    adminPasswordConfirm: z.string().min(1, "Please confirm the password"),
  })
  .refine((data) => data.adminPassword === data.adminPasswordConfirm, {
    message: "Passwords do not match",
    path: ["adminPasswordConfirm"],
  });

type SetupFormData = z.infer<typeof setupSchema>;

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
      adminEmail: "",
      adminPassword: "",
      adminPasswordConfirm: "",
    },
  });

  const activationCodeValue = form.watch("activationCode");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const bridge = (window as any)?.otto;
        if (!bridge?.getPendingActivationCode) return;
        const pending = await bridge.getPendingActivationCode();
        if (cancelled) return;
        if (typeof pending !== "string") return;

        const trimmed = pending.trim();
        if (!trimmed) return;

        const current = form.getValues("activationCode");
        if (!current) {
          form.setValue("activationCode", trimmed, { shouldValidate: true });
        }
      } catch {
        // ignore
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [form]);

  const formatActivationCode = (raw: string) => {
    const cleaned = String(raw || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .replace(/[IO01]/g, "");
    const groups = cleaned.match(/.{1,4}/g) || [];
    return groups.slice(0, 4).join("-").slice(0, 19);
  };

  const bootstrapMutation = useMutation({
    mutationFn: async (data: SetupFormData) => {
      const res = await fetch("/api/setup/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          activationCode: data.activationCode,
          office: {
            name: data.officeName,
            address: data.officeAddress || undefined,
            phone: data.officePhone || undefined,
            email: data.officeEmail || undefined,
          },
          admin: {
            firstName: data.adminFirstName,
            lastName: data.adminLastName,
            email: data.adminEmail,
            password: data.adminPassword,
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

      const res = await fetch("/api/setup/import-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          activationCode: data.activationCode,
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
            email: data.adminEmail,
            password: data.adminPassword,
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
              This office hasn’t been set up yet. Please open Otto Tracker on the Host computer and complete setup there.
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

  const onSubmit = (data: SetupFormData) => {
    if (setupMode === "import") {
      importMutation.mutate(data);
    } else {
      bootstrapMutation.mutate(data);
    }
  };

  const isSubmitting = bootstrapMutation.isPending || importMutation.isPending;
  const importMissingFile = setupMode === "import" && !snapshot;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 to-accent/5">
      <div className="w-full max-w-4xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground mb-2">Set up Otto Tracker</h1>
          <p className="text-muted-foreground">
            This only happens once, on the Host computer. You’ll activate the office, enter office details, and create the
            first admin login.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Before you start</CardTitle>
            <CardDescription>What this setup does and why.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Enter your Activation Code to verify your subscription (no patient data is sent).</li>
              <li>Create your office record and first admin login (local to this office).</li>
              <li>After setup, new users can request access from the sign-in screen and be approved in <b>Team</b>.</li>
            </ol>
            <Alert>
              <AlertDescription>
                Not the Host computer? Use <b>File → Change Connection…</b> to switch this computer to Client.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-2">
          <Card className="lg:col-span-2">
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
                    disabled={isSubmitting}
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                Activation
              </CardTitle>
              <CardDescription>
                Paste the Activation Code from your billing portal (ottojobtracker.com/portal). This verifies your
                subscription (no patient data is sent).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="activationCode">Activation Code *</Label>
                <Input
                  id="activationCode"
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  value={activationCodeValue}
                  onChange={(event) => {
                    form.setValue("activationCode", formatActivationCode(event.target.value), {
                      shouldValidate: true,
                    });
                  }}
                  data-testid="input-activation-code"
                />
                {form.formState.errors.activationCode && (
                  <p className="text-sm text-destructive">{form.formState.errors.activationCode.message}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Office details
              </CardTitle>
              <CardDescription>
                {setupMode === "import"
                  ? "These are loaded from the snapshot. You can adjust them now or later in Settings."
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

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                Create the admin login
              </CardTitle>
              <CardDescription>
                This person can manage the office and add team members. It’s separate from the billing portal login (you
                can use the same email if you want).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
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
                <Label htmlFor="adminEmail">Email *</Label>
                <Input id="adminEmail" type="email" placeholder="admin@practice.com" {...form.register("adminEmail")} />
                {form.formState.errors.adminEmail && (
                  <p className="text-sm text-destructive">{form.formState.errors.adminEmail.message}</p>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adminPassword">Password *</Label>
                  <Input id="adminPassword" type="password" {...form.register("adminPassword")} />
                  {form.formState.errors.adminPassword && (
                    <p className="text-sm text-destructive">{form.formState.errors.adminPassword.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminPasswordConfirm">Confirm password *</Label>
                  <Input id="adminPasswordConfirm" type="password" {...form.register("adminPasswordConfirm")} />
                  {form.formState.errors.adminPasswordConfirm && (
                    <p className="text-sm text-destructive">{form.formState.errors.adminPasswordConfirm.message}</p>
                  )}
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
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
