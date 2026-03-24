import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Initialize Sentry for the renderer process.
// The DSN is injected at build time via Vite's define config (import.meta.env.VITE_SENTRY_DSN).
// If not set, Sentry silently no-ops.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    release: import.meta.env.VITE_APP_VERSION as string | undefined,
    environment: import.meta.env.MODE || "production",
    beforeSend(event) {
      // Strip any user-identifying information
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }
      return event;
    },
  });
}

createRoot(document.getElementById("root")!).render(<App />);
