import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";

/**
 * Like ProtectedRoute, but additionally requires the user to be an Owner or
 * Manager. super_admin is intentionally NOT allowed — they bypass office-
 * scoped role checks elsewhere, but they should not be funneled into the
 * setup wizard.
 */
export function OwnerOrManagerRoute({
  path,
  component: Component,
}: {
  path: string;
  component: () => JSX.Element | null;
}) {
  const { user, isLoading } = useAuth();

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

  if (user.role !== "owner" && user.role !== "manager") {
    return (
      <Route path={path}>
        <Redirect to="/" />
      </Route>
    );
  }

  return (
    <Route path={path}>
      <Component />
    </Route>
  );
}
