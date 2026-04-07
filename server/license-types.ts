/**
 * Plan information received from the portal during check-in.
 * Mirrored in otto-web/server/portal/licensing.ts (check-in response).
 */
export type OttoPlan = {
  clientSlots: number;
  tabletSlots: number;
};

/** Default plan for backward compat with older portals that don't send plan data. */
export const DEFAULT_PLAN: OttoPlan = { clientSlots: 999, tabletSlots: 999 };

export type LicenseOfficeStatus = "ACTIVE" | "DISABLED";

export type LicenseMode =
  | "UNACTIVATED"
  | "ACTIVE"
  | "GRACE"
  | "READ_ONLY"
  | "DISABLED"
  | "INVALID";

export type LicenseState = {
  installationId: string;
  hostFingerprint256: string;
  hostToken?: string;
  officeStatus?: LicenseOfficeStatus;
  activatedAt?: number; // local time (ms)

  // Values based on portal server time (ms since epoch)
  lastSuccessfulCheckinAt?: number;
  nextCheckinDueAt?: number;

  // serverTime - Date.now() measured at last successful check-in (ms)
  serverTimeOffsetMs?: number;

  // When the desktop app first started without a valid license token.
  firstRunAt?: number; // local time (ms)

  lastAttemptAt?: number; // local time (ms)
  lastError?: string;
  tokenInvalid?: boolean;
  currentInviteCodeLast4?: string;

  // Subscription billing cycle end (unix ms, from portal's Stripe data).
  // Used to enforce a 3-day grace period after the subscription period expires.
  currentPeriodEnd?: number;

  // Whether the portal indicated payment is required (trial expired or subscription issue)
  paymentRequired?: boolean;

  // Office ID from the portal (used for broadcasting over-limit events)
  officeId?: string;

  // When the office first exceeded its client slot limit (ms). Cleared when under limit.
  overLimitSince?: number;
};

export type LicenseSnapshot = {
  mode: LicenseMode;
  writeAllowed: boolean;
  message: string;
  nowServerTime: number;
  installationId: string;
  hostFingerprint256: string;
  officeStatus: LicenseOfficeStatus | "UNKNOWN";
  hostTokenPresent: boolean;
  activatedAt: number | null;
  lastSuccessfulCheckinAt: number | null;
  nextCheckinDueAt: number | null;
  graceEndsAt: number | null;
  lastError: string | null;
  currentInviteCodeLast4: string | null;
  paymentRequired: boolean;
};
