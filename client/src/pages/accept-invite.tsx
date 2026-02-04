import { useRoute, Redirect, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Glasses, Mail, Building2, UserCheck, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  password: z.string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, "Password must contain at least one special character"),
});

type RegisterFormData = z.infer<typeof registerSchema>;

interface InviteData {
  email: string;
  role: string;
  message: string | null;
  officeId: string;
  officeName: string;
  inviterName: string;
}

export default function AcceptInvite() {
  const [match, params] = useRoute("/accept-invite/:token");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const token = params?.token;

  const { data: invite, isLoading, error } = useQuery<InviteData>({
    queryKey: ['/api/invitations/verify', token],
    queryFn: async () => {
      const res = await fetch(`/api/invitations/verify/${token}`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to verify invitation');
      }
      return res.json();
    },
    enabled: !!token && !user,
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", password: "" },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterFormData) => {
      const res = await apiRequest("POST", '/api/register', {
        email: invite?.email,
        firstName: data.firstName,
        lastName: data.lastName,
        password: data.password,
        inviteToken: token,
      });
      return res.json();
    },
    onSuccess: () => {
      setLocation('/');
    },
    onError: (error: Error) => {
      registerForm.setError('root', {
        message: error.message || 'Registration failed',
      });
    },
  });

  if (!match || !token) {
    return <Redirect to="/auth" />;
  }

  if (user) {
    return <Redirect to="/" />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center justify-center w-16 h-16 bg-destructive/10 rounded-xl mb-4 mx-auto">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-center">Invalid Invitation</CardTitle>
            <CardDescription className="text-center">
              {(error as Error).message}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => setLocation('/auth')}
              className="w-full"
              data-testid="button-go-to-auth"
            >
              Go to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!invite) {
    return null;
  }

  const onRegister = (data: RegisterFormData) => {
    registerMutation.mutate(data);
  };

  const roleLabel = invite.role.charAt(0).toUpperCase() + invite.role.slice(1).replace('_', ' ');

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-xl mb-4">
              <Glasses className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Otto Tracker</h1>
            <p className="text-muted-foreground">You've been invited to join a team!</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Team Invitation</CardTitle>
              <CardDescription>
                {invite.inviterName} has invited you to join {invite.officeName}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <Building2 className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Office</p>
                    <p className="text-sm text-muted-foreground" data-testid="text-office-name">{invite.officeName}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <UserCheck className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Role</p>
                    <p className="text-sm text-muted-foreground" data-testid="text-role">{roleLabel}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <Mail className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Email</p>
                    <p className="text-sm text-muted-foreground" data-testid="text-email">{invite.email}</p>
                  </div>
                </div>
              </div>

              {invite.message && (
                <Alert>
                  <AlertDescription data-testid="text-message">
                    <span className="font-semibold">Message: </span>
                    {invite.message}
                  </AlertDescription>
                </Alert>
              )}

              <div className="border-t pt-6">
                <h3 className="font-semibold mb-4">Create Your Account</h3>
                <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        placeholder="John"
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
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      {...registerForm.register("password")}
                      data-testid="input-password"
                    />
                    <p className="text-xs text-muted-foreground">At least 8 characters</p>
                    {registerForm.formState.errors.password && (
                      <p className="text-sm text-destructive">
                        {registerForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>

                  {registerForm.formState.errors.root && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        {registerForm.formState.errors.root.message}
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={registerMutation.isPending}
                    data-testid="button-accept-invite"
                  >
                    {registerMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Accept Invitation & Create Account
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-center text-muted-foreground">
            By creating an account, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>

      <div className="hidden lg:flex items-center justify-center bg-gradient-to-br from-primary/10 to-accent p-8">
        <div className="max-w-md text-center space-y-6">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-primary/20 rounded-full mb-6">
            <Glasses className="h-12 w-12 text-primary" />
          </div>
          <h2 className="text-3xl font-bold">Join Your Team</h2>
          <p className="text-lg text-muted-foreground">
            You're just one step away from collaborating with your team on Otto Tracker.
            Create your account to get started.
          </p>
          <div className="grid grid-cols-1 gap-4 text-left">
            <div className="flex items-center gap-3 p-4 bg-background/50 rounded-lg">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground font-semibold text-sm">✓</span>
              </div>
              <div>
                <h3 className="font-semibold">Instant Access</h3>
                <p className="text-sm text-muted-foreground">Join your team's workspace immediately</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-background/50 rounded-lg">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground font-semibold text-sm">✓</span>
              </div>
              <div>
                <h3 className="font-semibold">Pre-configured Role</h3>
                <p className="text-sm text-muted-foreground">Your permissions are already set up</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-background/50 rounded-lg">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground font-semibold text-sm">✓</span>
              </div>
              <div>
                <h3 className="font-semibold">Start Collaborating</h3>
                <p className="text-sm text-muted-foreground">Begin managing jobs with your team right away</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
