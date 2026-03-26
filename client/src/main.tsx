import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── PHI scrubbing helpers ──
// Ensures no Protected Health Information leaves the device via Sentry.
const PHI_KEY_PATTERNS = [
  /patient/i, /first.?name/i, /last.?name/i, /phone/i, /email/i,
  /address/i, /notes/i, /tray.?number/i, /login.?id/i, /pin/i,
  /password/i, /secret/i, /token/i, /ssn/i, /dob|date.?of.?birth/i,
  /insurance/i, /diagnosis/i, /prescription/i, /medical/i, /health/i,
  /content/i, /message/i, /user.?agent/i, /ip.?address/i,
  /requested.?by.?ip/i, /request.?message/i, /custom.?column/i,
];

function scrubPhi(obj: unknown, depth = 0): unknown {
  if (depth > 8 || obj == null) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrubPhi(v, depth + 1));
  if (typeof obj !== "object") return obj;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (PHI_KEY_PATTERNS.some((p) => p.test(key))) {
      cleaned[key] = "[Redacted]";
    } else if (typeof value === "object" && value !== null) {
      cleaned[key] = scrubPhi(value, depth + 1);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function redactFreeText(text: string): string {
  if (typeof text !== "string") return text;
  for (const pattern of PHI_KEY_PATTERNS) {
    const src = pattern.source;
    text = text.replace(new RegExp(`("${src}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi"), '$1"[Redacted]"');
    text = text.replace(new RegExp(`(${src}\\s*[:=]\\s*)\\S[^,}\\]\\n]*`, "gi"), "$1[Redacted]");
  }
  return text;
}

function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (!breadcrumb) return breadcrumb;
  if (breadcrumb.data) breadcrumb.data = scrubPhi(breadcrumb.data) as Record<string, unknown>;
  if (breadcrumb.message) breadcrumb.message = redactFreeText(breadcrumb.message);
  return breadcrumb;
}

// Initialize Sentry for the renderer process.
// The DSN is injected at build time via Vite's define config (import.meta.env.VITE_SENTRY_DSN).
// If not set, Sentry silently no-ops.
//
// HIPAA: All events are scrubbed of PHI before transmission.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    release: import.meta.env.VITE_APP_VERSION as string | undefined,
    environment: import.meta.env.MODE || "production",
    sendDefaultPii: false,
    beforeSend(event) {
      // Drop errors caused by Vite HMR / React Fast Refresh — these are transient
      // mid-edit crashes that resolve on the next save and are not real bugs.
      if (event.exception?.values?.some(v =>
        v.stacktrace?.frames?.some(f => f.filename?.includes("@react-refresh"))
      )) {
        return null;
      }

      // Strip user PII
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
        delete event.user.id;
      }
      // Scrub request body
      if (event.request) {
        if (event.request.data) {
          event.request.data = typeof event.request.data === "string"
            ? redactFreeText(event.request.data) : scrubPhi(event.request.data);
        }
        if (event.request.query_string) event.request.query_string = { _: "[Redacted]" } as any;
        delete event.request.cookies;
      }
      // Scrub contexts & extras
      if (event.contexts) event.contexts = scrubPhi(event.contexts) as Record<string, Record<string, unknown>>;
      if (event.extra) event.extra = scrubPhi(event.extra) as Record<string, unknown>;
      // Scrub breadcrumbs
      if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean) as Sentry.Breadcrumb[];
      // Scrub error messages
      if (event.message) event.message = redactFreeText(event.message);
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = redactFreeText(ex.value);
        }
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
  });
}

createRoot(document.getElementById("root")!).render(<App />);
