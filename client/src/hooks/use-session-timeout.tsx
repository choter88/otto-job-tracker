import { useEffect, useRef } from "react";
import { useAuth } from "./use-auth";
import { useToast } from "./use-toast";

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000; // Show warning 2 minutes before timeout

export function useSessionTimeout() {
  const { user, logoutMutation } = useAuth();
  const { toast } = useToast();

  // Keep the latest mutate/toast in refs so the activity effect below can depend
  // ONLY on `user` — and is therefore NOT torn down + re-armed on unrelated
  // re-renders. (Previously the effect depended on resetTimer -> handleLogout ->
  // the unstable `logoutMutation` object, so showing the 13-minute warning toast
  // re-rendered AuthProvider, reset both timers from zero, and the inactivity
  // logout never actually fired — the user just saw the warning on a loop.)
  const logoutRef = useRef(logoutMutation.mutate);
  const toastRef = useRef(toast);
  useEffect(() => {
    logoutRef.current = logoutMutation.mutate;
    toastRef.current = toast;
  });

  useEffect(() => {
    if (!user) return;

    let warningTimer: ReturnType<typeof setTimeout> | null = null;
    let logoutTimer: ReturnType<typeof setTimeout> | null = null;
    let warningShown = false;

    const clearTimers = () => {
      if (warningTimer) { clearTimeout(warningTimer); warningTimer = null; }
      if (logoutTimer) { clearTimeout(logoutTimer); logoutTimer = null; }
    };

    const resetTimer = () => {
      clearTimers();
      warningShown = false;

      warningTimer = setTimeout(() => {
        if (warningShown) return;
        warningShown = true;
        toastRef.current({
          title: "Session Expiring Soon",
          description:
            "Your session will expire in 2 minutes due to inactivity. Move your mouse or type to stay logged in.",
        });
      }, SESSION_TIMEOUT_MS - WARNING_BEFORE_MS);

      logoutTimer = setTimeout(() => {
        clearTimers();
        toastRef.current({
          title: "Session Expired",
          description: "You have been logged out due to inactivity for security purposes.",
          variant: "destructive",
        });
        logoutRef.current();
      }, SESSION_TIMEOUT_MS);
    };

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];
    const handleActivity = () => resetTimer();
    events.forEach((event) => document.addEventListener(event, handleActivity, { passive: true }));

    resetTimer();

    return () => {
      clearTimers();
      events.forEach((event) => document.removeEventListener(event, handleActivity));
    };
  }, [user]);
}
