import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { Redirect, Route, useLocation } from "wouter";
import { useEffect } from "react";

export function RoleProtectedRoute({
  path,
  component: Component,
  requiredRole,
}: {
  path: string;
  component: () => JSX.Element | null;
  requiredRole: string;
}) {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();

  useEffect(() => {
    if (!isLoading && user && user.role !== requiredRole && location === path) {
      toast({
        title: "Access denied",
        description: "Access denied: insufficient permissions",
        variant: "destructive",
      });
    }
  }, [isLoading, user, requiredRole, location, path, toast]);

  if (isLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }

  if (user.role !== requiredRole) {
    return (
      <Route path={path}>
        <Redirect to="/dashboard" />
      </Route>
    );
  }

  return (
    <Route path={path}>
      <Component />
    </Route>
  );
}
