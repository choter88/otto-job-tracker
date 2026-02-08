import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { SessionTimeoutProvider } from "@/components/session-timeout-provider";
import SyncManager from "@/components/sync-manager";
import { ProtectedRoute } from "@/lib/protected-route";
import { RoleProtectedRoute } from "@/lib/role-protected-route";
import Dashboard from "@/pages/dashboard";
import Admin from "@/pages/admin";
import AuthPage from "@/pages/auth-page";
import OfficeSetup from "@/pages/office-setup";
import SetupPage from "@/pages/setup-page";
import SMSOptIn from "@/pages/sms-opt-in";
import AcceptInvite from "@/pages/accept-invite";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/setup" component={SetupPage} />
      <ProtectedRoute path="/" component={Dashboard} />
      <ProtectedRoute path="/dashboard/:tab?" component={Dashboard} />
      <ProtectedRoute path="/important" component={Dashboard} />
      <RoleProtectedRoute path="/admin" component={Admin} requiredRole="super_admin" />
      <ProtectedRoute path="/office-setup" component={OfficeSetup} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/sms-opt-in" component={SMSOptIn} />
      <Route path="/accept-invite/:token" component={AcceptInvite} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
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
  );
}

export default App;
