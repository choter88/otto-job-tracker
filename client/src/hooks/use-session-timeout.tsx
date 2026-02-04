import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "./use-auth";
import { useToast } from "./use-toast";

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000; // Show warning 2 minutes before timeout

export function useSessionTimeout() {
  const { user, logoutMutation } = useAuth();
  const { toast } = useToast();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningRef = useRef<NodeJS.Timeout | null>(null);
  const warningShownRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (warningRef.current) {
      clearTimeout(warningRef.current);
      warningRef.current = null;
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearTimers();
    toast({
      title: "Session Expired",
      description: "You have been logged out due to inactivity for security purposes.",
      variant: "destructive",
    });
    logoutMutation.mutate();
  }, [clearTimers, toast, logoutMutation]);

  const showWarning = useCallback(() => {
    if (!warningShownRef.current) {
      warningShownRef.current = true;
      toast({
        title: "Session Expiring Soon",
        description: "Your session will expire in 2 minutes due to inactivity. Move your mouse or type to stay logged in.",
      });
    }
  }, [toast]);

  const resetTimer = useCallback(() => {
    if (!user) return;
    
    clearTimers();
    warningShownRef.current = false;
    
    warningRef.current = setTimeout(() => {
      showWarning();
    }, SESSION_TIMEOUT_MS - WARNING_BEFORE_MS);

    timeoutRef.current = setTimeout(() => {
      handleLogout();
    }, SESSION_TIMEOUT_MS);
  }, [user, clearTimers, showWarning, handleLogout]);

  useEffect(() => {
    if (!user) {
      clearTimers();
      return;
    }

    const events = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    const handleActivity = () => {
      resetTimer();
    };

    events.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    resetTimer();

    return () => {
      clearTimers();
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [user, resetTimer, clearTimers]);

  return { resetTimer };
}
