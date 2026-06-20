import { createContext, ReactNode, useContext, useEffect } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import type { PublicUser, InsertUser } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type AuthContextType = {
  user: PublicUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<PublicUser, Error, LoginData>;
  pinLoginMutation: UseMutationResult<PublicUser, Error, PinLoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<PublicUser, Error, RegisterData>;
};

type LoginData = {
  identifier: string;
  password: string;
};
type PinLoginData = {
  loginId: string;
  pin: string;
};
type RegisterData = Pick<InsertUser, "email" | "password" | "firstName" | "lastName"> & {
  inviteToken?: string;
};

export const AuthContext = createContext<AuthContextType | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<PublicUser | undefined, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      const res = await apiRequest("POST", "/api/login", credentials);
      return await res.json();
    },
    onSuccess: (user: PublicUser) => {
      queryClient.clear();
      queryClient.setQueryData(["/api/user"], user);
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const pinLoginMutation = useMutation({
    mutationFn: async (credentials: PinLoginData) => {
      const res = await apiRequest("POST", "/api/login/pin", credentials);
      return await res.json();
    },
    onSuccess: (user: PublicUser) => {
      queryClient.clear();
      queryClient.setQueryData(["/api/user"], user);
    },
    onError: (error: Error) => {
      toast({
        title: "PIN login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: RegisterData) => {
      const res = await apiRequest("POST", "/api/register", credentials);
      return await res.json();
    },
    onSuccess: (user: PublicUser) => {
      queryClient.clear();
      queryClient.setQueryData(["/api/user"], user);
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      // Clear cached data AFTER the server session is destroyed, then pin the
      // user to null. Clearing in onMutate (before the POST) refetched
      // /api/user with the still-valid cookie and repopulated the user — which
      // silently defeated logout, including the inactivity timeout.
      queryClient.clear();
      queryClient.setQueryData(["/api/user"], null);
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // The Electron main process clears the window's session and fires this when
  // the window is hidden to tray (HIPAA: shared machines). POST the logout so
  // the server invalidates the session and records it.
  useEffect(() => {
    const otto = (window as any).otto;
    if (!otto?.onAutoLogout) return;
    const unsubscribe = otto.onAutoLogout(() => {
      try { logoutMutation.mutate(); } catch { /* best-effort */ }
    });
    return () => { try { unsubscribe?.(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        loginMutation,
        pinLoginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
