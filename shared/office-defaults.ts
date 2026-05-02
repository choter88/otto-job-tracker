/**
 * Default office settings used when a new office is created.
 *
 * Two creation paths share these defaults:
 *   1. storage.createOffice (programmatic test/import path)
 *   2. /api/setup/bootstrap (host activation via desktop setup window)
 *
 * Keeping them in one place prevents the bootstrap path from drifting
 * (which is exactly how the wizard auto-launch broke previously — bootstrap
 * skipped the onboarding stamp because it didn't go through createOffice).
 */

import { defaultOnboardingForNewOffice, type OnboardingState } from "./onboarding";

export interface DefaultOfficeSettings {
  customStatuses: Array<{ id: string; label: string; color: string; order: number }>;
  customJobTypes: Array<{ id: string; label: string; color: string; order: number }>;
  customOrderDestinations: Array<{ id: string; label: string; color: string; order: number }>;
  customColumns: Array<unknown>;
  onboarding: OnboardingState;
  smsEnabled: boolean;
  smsTemplates: Record<string, string>;
}

export function getDefaultOfficeSettings(): DefaultOfficeSettings {
  return {
    // IDs are intentionally stable across label changes — they're stored on
    // every job row + referenced by lifecycle helpers, terminal-status
    // checks (server/import-csv.ts, server/storage.ts), and locked-position
    // logic in the sortable list editor. Renaming an ID would invalidate
    // every existing job's status. Labels are user-facing strings and can
    // change freely. The CSV importer maps user-chosen CSV column values
    // → IDs at import time, so label changes don't affect imports either.
    customStatuses: [
      { id: "job_created", label: "Created", color: "#2563EB", order: 1 },
      { id: "ordered", label: "Ordered", color: "#D97706", order: 2 },
      { id: "in_progress", label: "Lab Processing", color: "#0284C7", order: 3 },
      { id: "quality_check", label: "Quality Check", color: "#7C3AED", order: 4 },
      { id: "ready_for_pickup", label: "Ready for Pickup", color: "#16A34A", order: 5 },
      { id: "completed", label: "Dispensed", color: "#059669", order: 6 },
      { id: "cancelled", label: "Cancelled", color: "#DC2626", order: 7 },
    ],
    customJobTypes: [
      { id: "contacts", label: "Contacts", color: "#475569", order: 1 },
      { id: "glasses", label: "Glasses", color: "#2563EB", order: 2 },
      { id: "sunglasses", label: "Sunglasses", color: "#D97706", order: 3 },
      { id: "prescription", label: "Prescription", color: "#7C3AED", order: 4 },
    ],
    customOrderDestinations: [
      { id: "hoya", label: "Hoya", color: "#0284C7", order: 1 },
      { id: "essilor", label: "Essilor", color: "#16A34A", order: 2 },
      { id: "zeiss", label: "Zeiss", color: "#7C3AED", order: 3 },
      { id: "abb", label: "ABB", color: "#4F46E5", order: 4 },
      { id: "alcon", label: "Alcon", color: "#DC2626", order: 5 },
      { id: "coopervision", label: "CooperVision", color: "#0891B2", order: 6 },
      { id: "jj_vision", label: "J&J Vision", color: "#D97706", order: 7 },
      { id: "bausch_lomb", label: "B+L", color: "#65A30D", order: 8 },
    ],
    customColumns: [],
    onboarding: defaultOnboardingForNewOffice(),
    smsEnabled: false,
    smsTemplates: {
      job_created: "Hi {patient_first_name}, we received your {job_type} order #{order_id}.",
      ordered: "Your {job_type} order #{order_id} has been placed and is being processed.",
      in_progress: "Update: Your {job_type} order #{order_id} is now being processed at the lab.",
      quality_check: "Update: Your {job_type} order #{order_id} is in quality check.",
      ready_for_pickup: "Great news! Your {job_type} order #{order_id} is ready for pickup.",
      completed: "Your {job_type} order #{order_id} has been dispensed.",
      cancelled:
        "Update: Your {job_type} order #{order_id} was cancelled. Please contact {office_name} at {office_phone}.",
    },
  };
}
