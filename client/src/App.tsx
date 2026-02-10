import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { SessionTimeoutProvider } from "@/components/session-timeout-provider";
import SyncManager from "@/components/sync-manager";
import { ProtectedRoute } from "@/lib/protected-route";
import Dashboard from "@/pages/dashboard";
import AuthPage from "@/pages/auth-page";
import SetupPage from "@/pages/setup-page";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/setup" component={SetupPage} />
      <ProtectedRoute path="/" component={Dashboard} />
      <ProtectedRoute path="/dashboard/:tab?" component={Dashboard} />
      <ProtectedRoute path="/important" component={Dashboard} />
      <Route path="/auth" component={AuthPage} />
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
