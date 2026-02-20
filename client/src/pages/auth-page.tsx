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
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Glasses, MonitorCog, Building2, UserPlus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const loginSchema = z.object({
  identifier: z.string().min(1, "Login ID is required"),
  password: z.string().min(1, "Password is required"),
});

const pinLoginSchema = z.object({
  loginId: z
    .string()
    .min(3, "Login ID must be at least 3 characters")
    .max(32, "Login ID must be 32 characters or fewer")
    .regex(/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/i, "Enter a valid Login ID"),
  pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
});

const registerSchema = z.object({
  loginId: z
    .string()
    .min(3, "Login ID must be at least 3 characters")
    .max(32, "Login ID must be 32 characters or fewer")
    .regex(/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/i, "Login ID can include letters, numbers, '.', '-', and '_'"),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, "Password must contain at least one special character"),
  passwordConfirm: z.string().min(1, "Please confirm your password"),
  pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
  pinConfirm: z.string().regex(/^\d{6}$/, "Please confirm your 6-digit PIN"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
})
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  })
  .refine((data) => data.pin === data.pinConfirm, {
    message: "PINs do not match",
    path: ["pinConfirm"],
  });

type LoginFormData = z.infer<typeof loginSchema>;
type PinLoginFormData = z.infer<typeof pinLoginSchema>;
type RegisterFormData = z.infer<typeof registerSchema>;

type SetupStatus = {
  initialized: boolean;
  officeId: string | null;
  officeName: string | null;
  selfSignupEnabled: boolean;
};

type DesktopMode = "host" | "client" | "unknown";

export default function AuthPage() {
  const { user, isLoading, loginMutation, pinLoginMutation } = useAuth();
  const [showSignup, setShowSignup] = useState(false);
  const [loginMethod, setLoginMethod] = useState<"password" | "pin">("password");
  const [requestSubmittedMessage, setRequestSubmittedMessage] = useState<string | null>(null);
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
    defaultValues: { identifier: "", password: "" },
  });

  const pinLoginForm = useForm<PinLoginFormData>({
    resolver: zodResolver(pinLoginSchema),
    defaultValues: { loginId: "", pin: "" },
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      loginId: "",
      password: "",
      passwordConfirm: "",
      pin: "",
      pinConfirm: "",
      firstName: "",
      lastName: "",
    },
  });

  const requestAccessMutation = useMutation({
    mutationFn: async (payload: Omit<RegisterFormData, "passwordConfirm" | "pinConfirm">) => {
      const res = await apiRequest("POST", "/api/account-requests", payload);
      return (await res.json()) as { message?: string };
    },
    onMutate: () => {
      registerForm.clearErrors("root");
    },
    onSuccess: (payload) => {
      setShowSignup(false);
      setRequestSubmittedMessage(
        payload?.message ||
          "Request submitted. An owner or manager must approve your account on the Host before you can sign in.",
      );
      registerForm.reset();
    },
    onError: (error: Error) => {
      registerForm.setError("root", { type: "server", message: error.message });
    },
  });

  useEffect(() => {
    if (!setupStatus?.selfSignupEnabled && showSignup) {
      setShowSignup(false);
    }
  }, [setupStatus?.selfSignupEnabled, showSignup]);

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

  const onPinLogin = (data: PinLoginFormData) => {
    pinLoginMutation.mutate({
      loginId: data.loginId,
      pin: data.pin,
    });
  };

  const onRegister = (data: RegisterFormData) => {
    const { passwordConfirm: _passwordConfirm, pinConfirm: _pinConfirm, ...payload } = data;
    setRequestSubmittedMessage(null);
    requestAccessMutation.mutate(payload);
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
            <Card className="flex h-[620px] flex-col">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{showSignup ? "Request account access" : "Sign in"}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {showSignup
                        ? "Submit your details for owner/manager approval on the Host computer."
                        : "Use your office credentials to open your workspace."}
                    </p>
                  </div>
                  {setupStatus.selfSignupEnabled && (
                    <Button
                      type="button"
                      variant={showSignup ? "secondary" : "outline"}
                      size="sm"
                      className="shrink-0"
                      onClick={() => setShowSignup((prev) => !prev)}
                      data-testid="button-toggle-signup"
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      {showSignup ? "Back to sign in" : "First time here?"}
                    </Button>
                  )}
                </div>
                {!setupStatus.selfSignupEnabled && (
                  <p className="text-sm text-muted-foreground">
                    Account requests are disabled for this office. Ask an owner or manager to create your account.
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto">
                {!showSignup ? (
                  <div className="space-y-4">
                    {requestSubmittedMessage && (
                      <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
                        {requestSubmittedMessage}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
                      <Button
                        type="button"
                        variant={loginMethod === "password" ? "secondary" : "ghost"}
                        className="h-8"
                        onClick={() => setLoginMethod("password")}
                        data-testid="button-login-method-password"
                      >
                        Password
                      </Button>
                      <Button
                        type="button"
                        variant={loginMethod === "pin" ? "secondary" : "ghost"}
                        className="h-8"
                        onClick={() => setLoginMethod("pin")}
                        data-testid="button-login-method-pin"
                      >
                        PIN
                      </Button>
                    </div>

                    {loginMethod === "password" ? (
                      <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="identifier">Login ID</Label>
                          <Input
                            id="identifier"
                            type="text"
                            autoCapitalize="none"
                            autoCorrect="off"
                            placeholder="jane.cho"
                            {...loginForm.register("identifier")}
                            data-testid="input-login-identifier"
                          />
                          <p className="text-xs text-muted-foreground">Older accounts can still sign in with email.</p>
                          {loginForm.formState.errors.identifier && (
                            <p className="text-sm text-destructive">{loginForm.formState.errors.identifier.message}</p>
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
                    ) : (
                      <form onSubmit={pinLoginForm.handleSubmit(onPinLogin)} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="pin-login-id">Login ID</Label>
                          <Input
                            id="pin-login-id"
                            type="text"
                            autoCapitalize="none"
                            autoCorrect="off"
                            placeholder="jane.cho"
                            {...pinLoginForm.register("loginId")}
                            data-testid="input-pin-login-id"
                          />
                          {pinLoginForm.formState.errors.loginId && (
                            <p className="text-sm text-destructive">{pinLoginForm.formState.errors.loginId.message}</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pin-login">PIN</Label>
                          <Input
                            id="pin-login"
                            type="password"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="••••••"
                            {...pinLoginForm.register("pin")}
                            data-testid="input-pin-login"
                          />
                          {pinLoginForm.formState.errors.pin && (
                            <p className="text-sm text-destructive">{pinLoginForm.formState.errors.pin.message}</p>
                          )}
                        </div>

                        <Button
                          type="submit"
                          className="w-full"
                          disabled={pinLoginMutation.isPending}
                          data-testid="button-pin-sign-in"
                        >
                          {pinLoginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Unlock with PIN
                        </Button>
                      </form>
                    )}
                  </div>
                ) : (
                  <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
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
                      <Label htmlFor="reg-login-id">Login ID</Label>
                      <Input
                        id="reg-login-id"
                        type="text"
                        autoCapitalize="none"
                        autoCorrect="off"
                        placeholder="jane.cho"
                        {...registerForm.register("loginId")}
                        data-testid="input-reg-login-id"
                      />
                      <p className="text-xs text-muted-foreground">
                        3-32 characters. Use letters, numbers, ".", "-", or "_".
                      </p>
                      {registerForm.formState.errors.loginId && (
                        <p className="text-sm text-destructive">{registerForm.formState.errors.loginId.message}</p>
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

                    <div className="space-y-2">
                      <Label htmlFor="reg-password-confirm">Confirm password</Label>
                      <Input
                        id="reg-password-confirm"
                        type="password"
                        placeholder="••••••••••••"
                        {...registerForm.register("passwordConfirm")}
                        data-testid="input-reg-password-confirm"
                      />
                      {registerForm.formState.errors.passwordConfirm && (
                        <p className="text-sm text-destructive">
                          {registerForm.formState.errors.passwordConfirm.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-pin">6-digit PIN</Label>
                      <Input
                        id="reg-pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="••••••"
                        {...registerForm.register("pin")}
                        data-testid="input-reg-pin"
                      />
                      {registerForm.formState.errors.pin && (
                        <p className="text-sm text-destructive">{registerForm.formState.errors.pin.message}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-pin-confirm">Confirm PIN</Label>
                      <Input
                        id="reg-pin-confirm"
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="••••••"
                        {...registerForm.register("pinConfirm")}
                        data-testid="input-reg-pin-confirm"
                      />
                      {registerForm.formState.errors.pinConfirm && (
                        <p className="text-sm text-destructive">{registerForm.formState.errors.pinConfirm.message}</p>
                      )}
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={requestAccessMutation.isPending}
                      data-testid="button-sign-up"
                    >
                      {requestAccessMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Send Access Request
                    </Button>
                    {registerForm.formState.errors.root && (
                      <p className="text-sm text-destructive">{registerForm.formState.errors.root.message}</p>
                    )}
                  </form>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
