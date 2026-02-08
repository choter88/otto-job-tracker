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
};

