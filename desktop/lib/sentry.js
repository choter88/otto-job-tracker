import * as Sentry from "@sentry/electron/main";
import os from "os";

const dsn = process.env.SENTRY_DSN || "";

/**
 * Initialize Sentry for the Electron main process.
 * If SENTRY_DSN is not set, Sentry silently no-ops.
 */
export function initSentryMain({ appVersion, appMode } = {}) {
  if (!dsn) return;

  Sentry.init({
    dsn,
    release: appVersion || undefined,
    environment: process.env.NODE_ENV || "production",
    // Disable default integrations that send PII
    autoSessionTracking: true,
    initialScope: {
      tags: {
        "os.platform": os.platform(),
        "os.version": os.release(),
        "app.mode": appMode || "unknown",
      },
    },
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

/**
 * Update the app mode tag after config is loaded.
 */
export function setSentryAppMode(mode) {
  if (!dsn) return;
  Sentry.setTag("app.mode", mode);
}

export { Sentry };
