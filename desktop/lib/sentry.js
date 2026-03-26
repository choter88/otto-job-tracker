import * as Sentry from "@sentry/electron/main";
import os from "os";

const dsn = process.env.SENTRY_DSN || "";

// ── PHI field names that must never leave the device ──
// Any key matching these patterns is scrubbed from all Sentry events,
// breadcrumbs, and context.  This list is intentionally broad to catch
// misspellings and future schema additions.
const PHI_KEY_PATTERNS = [
  /patient/i,
  /first.?name/i,
  /last.?name/i,
  /phone/i,
  /email/i,
  /address/i,
  /notes/i,
  /tray.?number/i,
  /login.?id/i,
  /pin/i,
  /password/i,
  /secret/i,
  /token/i,
  /ssn/i,
  /dob|date.?of.?birth/i,
  /insurance/i,
  /diagnosis/i,
  /prescription/i,
  /medical/i,
  /health/i,
  /content/i,
  /message/i,
  /user.?agent/i,
  /ip.?address/i,
  /requested.?by.?ip/i,
  /request.?message/i,
  /custom.?column/i,
];

/**
 * Recursively walk an object and redact any value whose key matches a PHI
 * pattern.  Returns a new object (never mutates the original).
 */
function scrubPhi(obj, depth = 0) {
  if (depth > 8 || obj == null) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrubPhi(v, depth + 1));
  if (typeof obj !== "object") return obj;

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
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

/**
 * Scrub PHI from a breadcrumb.  Mutates in-place for Sentry's expected
 * return-or-null contract.
 */
function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb) return breadcrumb;
  if (breadcrumb.data) {
    breadcrumb.data = scrubPhi(breadcrumb.data);
  }
  if (breadcrumb.message) {
    breadcrumb.message = redactFreeText(breadcrumb.message);
  }
  return breadcrumb;
}

/**
 * Best-effort redaction of structured data that may have been stringified
 * into a free-text field (error messages, breadcrumb messages, etc.).
 * Matches common patterns like `"patientFirstName":"John"` or
 * `phone: (555) 123-4567`.
 */
function redactFreeText(text) {
  if (typeof text !== "string") return text;
  // Redact JSON-style key-value pairs with PHI keys
  for (const pattern of PHI_KEY_PATTERNS) {
    const src = pattern.source;
    // "key": "value" or "key":"value"
    const jsonRe = new RegExp(
      `("${src}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`,
      "gi",
    );
    text = text.replace(jsonRe, '$1"[Redacted]"');
    // key: value (unquoted, up to comma/newline)
    const plainRe = new RegExp(
      `(${src}\\s*[:=]\\s*)\\S[^,}\\]\\n]*`,
      "gi",
    );
    text = text.replace(plainRe, "$1[Redacted]");
  }
  return text;
}

/**
 * Initialize Sentry for the Electron main process.
 * If SENTRY_DSN is not set, Sentry silently no-ops.
 *
 * HIPAA: All events are scrubbed of PHI before transmission.
 * - User PII (email, username, IP) is stripped.
 * - Request bodies, breadcrumb data, contexts, and extras are
 *   recursively scrubbed of any key matching PHI_KEY_PATTERNS.
 * - Free-text error messages are pattern-matched for common PHI
 *   key-value formats.
 * - No local variable capture is enabled.
 */
export function initSentryMain({ appVersion, appMode } = {}) {
  if (!dsn) return;

  Sentry.init({
    dsn,
    release: appVersion || undefined,
    environment: process.env.NODE_ENV || "production",
    autoSessionTracking: true,

    // Do NOT send default PII (IP addresses, cookies, user-agent strings)
    sendDefaultPii: false,

    initialScope: {
      tags: {
        "os.platform": os.platform(),
        "os.version": os.release(),
        "app.mode": appMode || "unknown",
      },
    },

    beforeSend(event) {
      // ── Strip user PII ──
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
        delete event.user.id;
      }

      // ── Scrub request URL path params (F-17) ──
      if (event.request && event.request.url) {
        event.request.url = event.request.url
          .replace(/\/[0-9a-f]{8,}(-[0-9a-f]{4,}){0,4}/gi, "/[id]")
          .replace(/\/\d{4,}/g, "/[id]");
      }

      // ── Scrub request body ──
      if (event.request) {
        if (event.request.data) {
          event.request.data =
            typeof event.request.data === "string"
              ? redactFreeText(event.request.data)
              : scrubPhi(event.request.data);
        }
        if (event.request.query_string) {
          event.request.query_string = "[Redacted]";
        }
        if (event.request.cookies) {
          event.request.cookies = "[Redacted]";
        }
      }

      // ── Scrub contexts & extras ──
      if (event.contexts) event.contexts = scrubPhi(event.contexts);
      if (event.extra) event.extra = scrubPhi(event.extra);

      // ── Scrub breadcrumbs ──
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
      }

      // ── Scrub error messages ──
      if (event.message) {
        event.message = redactFreeText(event.message);
      }
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

/**
 * Update the app mode tag after config is loaded.
 */
export function setSentryAppMode(mode) {
  if (!dsn) return;
  Sentry.setTag("app.mode", mode);
}

export { Sentry };
