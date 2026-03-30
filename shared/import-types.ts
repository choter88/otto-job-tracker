/**
 * Shared types for the CSV import feature.
 * Used by both server (import-csv.ts, import-templates.ts, routes.ts) and client (import wizard components).
 */

/** Otto job fields that a CSV column can map to */
export const OTTO_IMPORT_FIELDS = [
  "firstName",
  "lastName",
  "patientNameCombined", // "Last, First" or "First Last" — split on server
  "status",
  "destination",
  "createdDate",
  "updatedDate",
  "notes",
] as const;

export type OttoImportField = (typeof OTTO_IMPORT_FIELDS)[number];

/** Human-readable labels for each Otto import field */
export const OTTO_IMPORT_FIELD_LABELS: Record<OttoImportField, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  patientNameCombined: "Patient Name (combined)",
  status: "Status",
  destination: "Destination (lab/vendor)",
  createdDate: "Created Date",
  updatedDate: "Last Updated Date",
  notes: "Notes",
};

/** Import template — shared schema for both built-in and user-created templates */
export interface ImportTemplate {
  id: string;
  name: string;
  ehrSystem?: string;
  type: "built-in" | "user";
  derivedFrom?: string; // id of built-in template this was derived from (informational only)
  createdAt?: string; // ISO date string, user templates only
  jobType: string; // glasses | contacts | sunglasses | prescription
  fieldMappings: Record<string, OttoImportField | null>; // csvColumnName -> ottoField or null (skip)
  statusMappings: Record<string, string | null>; // csvStatusValue -> ottoStatusId or null (skip rows)
  notesFromColumns?: string[]; // CSV columns to combine into notes (e.g. ["Frame UPC", "F Man.", "F Name"])
  destinationFallbackColumn?: string; // CSV column to use if primary destination is empty (e.g. "Manufacturer")
}

/** Result from parsing a CSV file for preview */
export interface CsvParseResult {
  headers: string[];
  preview: string[][]; // first 5 data rows
  totalRows: number;
  uniqueStatusValues: string[]; // all unique values from the status-mapped column (full file scan)
}

/** Result from executing a CSV import */
export interface ImportExecuteResult {
  imported: number;
  skipped: number;
  skipReasons: { reason: string; count: number }[];
}
