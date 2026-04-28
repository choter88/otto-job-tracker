import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { SessionTimeoutProvider } from "@/components/session-timeout-provider";
import { SentryErrorBoundary } from "@/components/sentry-error-boundary";
import SyncManager from "@/components/sync-manager";
import { ProtectedRoute } from "@/lib/protected-route";
import { OwnerOrManagerRoute } from "@/lib/owner-or-manager-route";
import { WizardAutoRedirect } from "@/components/wizard-auto-redirect";
import Dashboard from "@/pages/dashboard";
import AuthPage from "@/pages/auth-page";
import NotFound from "@/pages/not-found";
import SetupWizardPage from "@/pages/setup-wizard/setup-wizard-page";

function GuardedDashboard() {
  return (
    <WizardAutoRedirect>
      <Dashboard />
    </WizardAutoRedirect>
  );
}

function Router() {
  return (
    <Switch>
      <OwnerOrManagerRoute path="/setup" component={SetupWizardPage} />
      <ProtectedRoute path="/" component={GuardedDashboard} />
      <ProtectedRoute path="/dashboard/:tab?" component={GuardedDashboard} />
      <ProtectedRoute path="/important" component={GuardedDashboard} />
      <Route path="/auth" component={AuthPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <SentryErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SessionTimeoutProvider>
            <TooltipProvider>
              <Toaster />
              <SyncManager />
              <Router />
            </TooltipProvider>
          </SessionTimeoutProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SentryErrorBoundary>
  );
}

export default App;
