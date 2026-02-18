import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Glasses, MonitorCog, Building2, UserPlus } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  staffCode: z.string().min(1, "Staff code is required"),
  email: z.string().email("Please enter a valid email address"),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, "Password must contain at least one special character"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;
type RegisterFormData = z.infer<typeof registerSchema>;

type SetupStatus = {
  initialized: boolean;
  officeId: string | null;
  officeName: string | null;
  staffSignupConfigured: boolean;
};

type DesktopMode = "host" | "client" | "unknown";

export default function AuthPage() {
  const { user, isLoading, loginMutation, registerMutation } = useAuth();
  const [showSignup, setShowSignup] = useState(false);
  const [desktopMode, setDesktopMode] = useState<DesktopMode>("unknown");

  const { data: setupStatus, isLoading: setupLoading } = useQuery<SetupStatus>({
    queryKey: ["/api/setup/status"],
  });

  const isLocalHost = (() => {
    const host = window.location.hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  })();

  useEffect(() => {
    let active = true;
    const bridge = (window as any)?.otto;
    if (!bridge?.getConfig) return () => undefined;

    void bridge
      .getConfig()
      .then((config: any) => {
        if (!active) return;
        const mode = String(config?.mode || "").toLowerCase();
        if (mode === "host" || mode === "client") {
          setDesktopMode(mode);
        }
      })
      .catch(() => {
        // Ignore bridge errors and use hostname fallback.
      });

    return () => {
      active = false;
    };
  }, []);

  const effectiveMode: "host" | "client" = useMemo(() => {
    if (desktopMode === "host" || desktopMode === "client") return desktopMode;
    return isLocalHost ? "host" : "client";
  }, [desktopMode, isLocalHost]);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { staffCode: "", email: "", password: "", firstName: "", lastName: "" },
  });

  if (user) {
    return <Redirect to="/" />;
  }

  if (isLoading || setupLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!setupStatus?.initialized) {
    if (isLocalHost) {
      return <Redirect to="/setup" />;
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Office setup needed</CardTitle>
            <p className="text-sm text-muted-foreground">
              This office hasn’t been set up yet. Please open Otto Tracker on the Host computer and complete setup first.
            </p>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.reload()} className="w-full">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const onLogin = (data: LoginFormData) => {
    loginMutation.mutate(data);
  };

  const onRegister = (data: RegisterFormData) => {
    registerMutation.mutate(data);
  };

  const officeName = setupStatus?.officeName || "your office";
  const modeLabel = effectiveMode === "host" ? "Host" : "Client";
  const modeDescription =
    effectiveMode === "host"
      ? "This is the main Host workstation for this office."
      : "This workstation syncs to the Host over the office network.";

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-accent/10">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center p-6 lg:p-10">
        <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-5">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-primary rounded-xl">
              <Glasses className="h-7 w-7 text-primary-foreground" />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-primary">Otto Tracker Desktop</p>
              <h1 className="text-3xl font-bold tracking-tight">Welcome to {officeName}</h1>
              <p className="text-muted-foreground text-base max-w-xl">
                Sign in to continue working in this office workspace.
              </p>
            </div>

            <Card className="border-primary/20 bg-card/90">
              <CardContent className="p-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-foreground font-medium">
                    <MonitorCog className="h-4 w-4 text-primary" />
                    Station mode
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {modeLabel}
                  </span>
                </div>
                <p className="text-muted-foreground">{modeDescription}</p>
                <div className="flex items-center gap-2 text-foreground">
                  <Building2 className="h-4 w-4 text-primary" />
                  <span className="font-medium">{officeName}</span>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Sign in</CardTitle>
                <p className="text-sm text-muted-foreground">Use your office credentials to open your workspace.</p>
              </CardHeader>
              <CardContent>
                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      {...loginForm.register("email")}
                      data-testid="input-email"
                    />
                    {loginForm.formState.errors.email && (
                      <p className="text-sm text-destructive">{loginForm.formState.errors.email.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      {...loginForm.register("password")}
                      data-testid="input-password"
                    />
                    {loginForm.formState.errors.password && (
                      <p className="text-sm text-destructive">{loginForm.formState.errors.password.message}</p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loginMutation.isPending}
                    data-testid="button-sign-in"
                  >
                    {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Continue
                  </Button>
                </form>
              </CardContent>
            </Card>

            {setupStatus.staffSignupConfigured ? (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <Button
                    type="button"
                    variant={showSignup ? "secondary" : "outline"}
                    className="w-full"
                    onClick={() => setShowSignup((prev) => !prev)}
                    data-testid="button-toggle-signup"
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    {showSignup ? "Hide account setup" : "First time here? Create your account"}
                  </Button>

                  {showSignup && (
                    <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4 pt-1">
                      <div className="space-y-2">
                        <Label htmlFor="staffCode">Staff code</Label>
                        <Input
                          id="staffCode"
                          placeholder="Ask your office admin"
                          {...registerForm.register("staffCode")}
                          data-testid="input-staffCode"
                        />
                        {registerForm.formState.errors.staffCode && (
                          <p className="text-sm text-destructive">
                            {registerForm.formState.errors.staffCode.message}
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">First Name</Label>
                          <Input
                            id="firstName"
                            placeholder="Jane"
                            {...registerForm.register("firstName")}
                            data-testid="input-firstName"
                          />
                          {registerForm.formState.errors.firstName && (
                            <p className="text-sm text-destructive">
                              {registerForm.formState.errors.firstName.message}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName">Last Name</Label>
                          <Input
                            id="lastName"
                            placeholder="Doe"
                            {...registerForm.register("lastName")}
                            data-testid="input-lastName"
                          />
                          {registerForm.formState.errors.lastName && (
                            <p className="text-sm text-destructive">
                              {registerForm.formState.errors.lastName.message}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="reg-email">Email</Label>
                        <Input
                          id="reg-email"
                          type="email"
                          placeholder="you@example.com"
                          {...registerForm.register("email")}
                          data-testid="input-reg-email"
                        />
                        {registerForm.formState.errors.email && (
                          <p className="text-sm text-destructive">{registerForm.formState.errors.email.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="reg-password">Password</Label>
                        <Input
                          id="reg-password"
                          type="password"
                          placeholder="••••••••••••"
                          {...registerForm.register("password")}
                          data-testid="input-reg-password"
                        />
                        <p className="text-xs text-muted-foreground">
                          12+ characters with uppercase, lowercase, number, and symbol.
                        </p>
                        {registerForm.formState.errors.password && (
                          <p className="text-sm text-destructive">{registerForm.formState.errors.password.message}</p>
                        )}
                      </div>

                      <Button
                        type="submit"
                        className="w-full"
                        disabled={registerMutation.isPending}
                        data-testid="button-sign-up"
                      >
                        {registerMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create Account
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground px-1">
                Account self-signup is disabled for this office. Ask the office owner for an invite.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
