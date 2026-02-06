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
import { Loader2, KeyRound, Building2, UserPlus, Copy, CheckCircle2, ShieldAlert } from "lucide-react";

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

const setupSchema = z
  .object({
    activationCode: z.string().min(1, "Activation Code is required"),
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
  staffSignupConfigured: boolean;
};

export default function SetupPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [staffCode, setStaffCode] = useState<string | null>(null);

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

      return payload as { ok: true; office: any; user: any; staffCode: string };
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(["/api/user"], payload.user);
      queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
      setStaffCode(payload.staffCode);
      toast({
        title: "Setup complete",
        description: "Your office is ready. Save the Staff code before continuing.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Setup failed",
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

  if (setupStatus?.initialized) {
    setLocation(user ? "/" : "/auth");
    return null;
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

  if (staffCode) {
    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(staffCode);
        toast({ title: "Copied", description: "Staff code copied to clipboard." });
      } catch {
        toast({ title: "Copy failed", description: "Please copy the code manually.", variant: "destructive" });
      }
    };

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 to-accent/5">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <div className="flex items-center justify-center w-16 h-16 bg-primary/10 rounded-xl mb-4 mx-auto">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-center">Office is ready</CardTitle>
            <CardDescription className="text-center">
              Save this Staff code. Each team member will need it once to create their login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border bg-card p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Staff code</div>
                <div className="text-2xl font-semibold tracking-widest" data-testid="text-staff-code">
                  {staffCode}
                </div>
              </div>
              <Button variant="secondary" onClick={onCopy} data-testid="button-copy-staff-code">
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>

            <Alert>
              <AlertDescription>
                If you ever lose this code, go to <b>Team</b> inside Otto Tracker and generate a new Staff code.
                Generating a new code will replace the old one.
              </AlertDescription>
            </Alert>

            <Button className="w-full" onClick={() => setLocation("/")} data-testid="button-continue">
              Continue to Otto Tracker
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const onSubmit = (data: SetupFormData) => bootstrapMutation.mutate(data);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 to-accent/5">
      <div className="w-full max-w-4xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground mb-2">Set up Otto Tracker</h1>
          <p className="text-muted-foreground">
            This only happens once, on the Host computer. You’ll create your office and the first admin login.
          </p>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                Activation
              </CardTitle>
              <CardDescription>Paste the Activation Code from your billing portal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="activationCode">Activation Code *</Label>
                <Input
                  id="activationCode"
                  placeholder="XXXX-XXXX-XXXX"
                  {...form.register("activationCode")}
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
              <CardDescription>This is shown inside the app for your team.</CardDescription>
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
              <CardDescription>This person can manage the office and add team members.</CardDescription>
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
                disabled={bootstrapMutation.isPending}
                data-testid="button-complete-setup"
              >
                {bootstrapMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Complete setup
              </Button>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}

