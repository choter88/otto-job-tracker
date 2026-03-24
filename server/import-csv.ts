import fs from "fs";
import { randomUUID } from "crypto";
import { parse } from "csv-parse/sync";
import { db } from "./db";
import { jobs, archivedJobs, jobStatusHistory } from "@shared/schema";
import { desc, sql } from "drizzle-orm";
import { normalizePatientNamePart } from "@shared/name-format";
import type { OttoImportField, CsvParseResult, ImportExecuteResult } from "@shared/import-types";

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse a CSV file and return headers, a preview of the first 5 rows,
 * total row count, and (optionally) all unique values from a specific column.
 */
export function parseCsvFile(
  filePath: string,
  statusColumn?: string,
): CsvParseResult {
  if (!fs.existsSync(filePath)) {
    throw new Error("CSV file not found");
  }

  const raw = fs.readFileSync(filePath, "utf-8")
    // Strip BOM (common in Windows-exported CSVs)
    .replace(/^\uFEFF/, "");

  const records: string[][] = parse(raw, {
    skip_empty_lines: true,
    relax_column_count: true,
  });

  if (records.length < 2) {
    throw new Error("CSV file must have at least a header row and one data row");
  }

  const headers = records[0];
  const dataRows = records.slice(1);
  const preview = dataRows.slice(0, 5);

  // Collect unique status values from the full file if a status column is specified
  let uniqueStatusValues: string[] = [];
  if (statusColumn) {
    const colIdx = headers.indexOf(statusColumn);
    if (colIdx >= 0) {
      const valueSet = new Set<string>();
      for (const row of dataRows) {
        const val = (row[colIdx] || "").trim();
        if (val) valueSet.add(val);
      }
      uniqueStatusValues = Array.from(valueSet).sort();
    }
  }

  return { headers, preview, totalRows: dataRows.length, uniqueStatusValues };
}

// ---------------------------------------------------------------------------
// Name splitting
// ---------------------------------------------------------------------------

/**
 * Split a combined patient name into first and last name.
 * Handles "Last, First" (comma-separated) and "First Last" (space-separated).
 */
function splitPatientName(combined: string): { first: string; last: string } {
  const trimmed = combined.trim();
  if (!trimmed) return { first: "", last: "" };

  if (trimmed.includes(",")) {
    // "Last, First" format
    const [last, ...rest] = trimmed.split(",");
    return { first: rest.join(",").trim(), last: last.trim() };
  }

  // "First Last" format — split on the last space
  const lastSpaceIdx = trimmed.lastIndexOf(" ");
  if (lastSpaceIdx > 0) {
    return {
      first: trimmed.slice(0, lastSpaceIdx).trim(),
      last: trimmed.slice(lastSpaceIdx + 1).trim(),
    };
  }

  // Single word — treat as last name
  return { first: "", last: trimmed };
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/** Try to parse common date formats into a Date. Returns null on failure. */
function tryParseDate(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;

  // Try ISO format first (YYYY-MM-DD or full ISO)
  const isoDate = new Date(v);
  if (!isNaN(isoDate.getTime()) && /^\d{4}/.test(v)) return isoDate;

  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day = parseInt(slashMatch[2], 10);
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Import execution
// ---------------------------------------------------------------------------

interface ImportConfig {
  filePath: string;
  jobType: string;
  fieldMappings: Record<string, OttoImportField | null>;
  statusMappings: Record<string, string | null>;
}

export function executeImport(
  config: ImportConfig,
  officeId: string,
  userId: string,
): ImportExecuteResult {
  if (!fs.existsSync(config.filePath)) {
    throw new Error("CSV file not found");
  }

  const raw = fs.readFileSync(config.filePath, "utf-8").replace(/^\uFEFF/, "");
  const records: string[][] = parse(raw, {
    skip_empty_lines: true,
    relax_column_count: true,
  });

  if (records.length < 2) {
    throw new Error("CSV file must have at least a header row and one data row");
  }

  const headers = records[0];
  const dataRows = records.slice(1);

  // Build a reverse mapping: ottoField -> column index
  const fieldToColIdx: Partial<Record<OttoImportField, number>> = {};
  for (const [csvCol, ottoField] of Object.entries(config.fieldMappings)) {
    if (ottoField) {
      const idx = headers.indexOf(csvCol);
      if (idx >= 0) fieldToColIdx[ottoField] = idx;
    }
  }

  // Prepare rows for insertion
  type PreparedRow = {
    firstName: string;
    lastName: string;
    status: string;
    destination: string;
    createdDate: Date | null;
    updatedDate: Date | null;
  };

  const prepared: PreparedRow[] = [];
  const skipReasonCounts: Record<string, number> = {};

  function skipRow(reason: string) {
    skipReasonCounts[reason] = (skipReasonCounts[reason] || 0) + 1;
  }

  for (const row of dataRows) {
    const getVal = (field: OttoImportField): string => {
      const idx = fieldToColIdx[field];
      return idx !== undefined ? (row[idx] || "").trim() : "";
    };

    // Resolve patient name
    let firstName = "";
    let lastName = "";
    const combined = getVal("patientNameCombined");
    if (combined) {
      const split = splitPatientName(combined);
      firstName = split.first;
      lastName = split.last;
    }
    // Explicit first/last overrides combined
    const explicitFirst = getVal("firstName");
    const explicitLast = getVal("lastName");
    if (explicitFirst) firstName = explicitFirst;
    if (explicitLast) lastName = explicitLast;

    firstName = normalizePatientNamePart(firstName);
    lastName = normalizePatientNamePart(lastName);

    // Required: at minimum a patient last name
    if (!lastName) {
      skipRow("Missing patient last name");
      continue;
    }

    // Resolve status
    let status = "job_created";
    const rawStatus = getVal("status");
    if (rawStatus) {
      const mappedStatus = config.statusMappings[rawStatus];
      if (mappedStatus === undefined) {
        // Status value not in mapping at all — skip row
        skipRow(`Unmapped status value: "${rawStatus}"`);
        continue;
      }
      if (mappedStatus === null) {
        // Explicitly set to null/skip in mapping — skip row
        skipRow(`Skipped status value: "${rawStatus}"`);
        continue;
      }
      status = mappedStatus;
    }

    // Resolve destination
    const destination = getVal("destination") || "Other";

    // Resolve dates
    const createdDate = tryParseDate(getVal("createdDate"));
    const updatedDate = tryParseDate(getVal("updatedDate"));

    prepared.push({ firstName, lastName, status, destination, createdDate, updatedDate });
  }

  if (prepared.length === 0) {
    return {
      imported: 0,
      skipped: dataRows.length,
      skipReasons: Object.entries(skipReasonCounts).map(([reason, count]) => ({ reason, count })),
    };
  }

  // Insert all valid rows in a single synchronous transaction.
  // better-sqlite3 transactions must be synchronous (no async/await).
  // Use .all()/.get()/.run() for explicit synchronous execution.
  const imported = db.transaction((tx) => {
    // Determine the starting orderId for this batch by finding the max for today
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const orderIdPrefix = `ORD-${today}-`;

    const maxActiveResult = tx
      .select({ orderId: jobs.orderId })
      .from(jobs)
      .where(sql`${jobs.orderId} LIKE ${orderIdPrefix + "%"}`)
      .orderBy(desc(jobs.orderId))
      .limit(1)
      .all();

    const maxArchivedResult = tx
      .select({ orderId: archivedJobs.orderId })
      .from(archivedJobs)
      .where(sql`${archivedJobs.orderId} LIKE ${orderIdPrefix + "%"}`)
      .orderBy(desc(archivedJobs.orderId))
      .limit(1)
      .all();

    const extractOrderNum = (orderId: string | null): number => {
      if (!orderId) return 0;
      const parts = orderId.split("-");
      const num = parseInt(parts[parts.length - 1], 10);
      return isNaN(num) ? 0 : num;
    };

    const maxActiveNum = extractOrderNum(maxActiveResult[0]?.orderId || null);
    const maxArchivedNum = extractOrderNum(maxArchivedResult[0]?.orderId || null);
    let nextOrderNum = Math.max(maxActiveNum, maxArchivedNum) + 1;

    let count = 0;
    for (const row of prepared) {
      const orderId = `ORD-${today}-${String(nextOrderNum).padStart(4, "0")}`;
      nextOrderNum++;

      const jobId = randomUUID();
      const now = new Date();

      tx.insert(jobs)
        .values({
          id: jobId,
          orderId,
          patientFirstName: row.firstName,
          patientLastName: row.lastName,
          jobType: config.jobType,
          status: row.status,
          orderDestination: row.destination,
          officeId,
          createdBy: userId,
          statusChangedAt: row.createdDate || now,
          createdAt: row.createdDate || now,
          updatedAt: row.updatedDate || row.createdDate || now,
        })
        .run();

      tx.insert(jobStatusHistory)
        .values({
          id: randomUUID(),
          jobId,
          oldStatus: null,
          newStatus: row.status,
          changedBy: userId,
        })
        .run();

      count++;
    }

    return count;
  });

  return {
    imported,
    skipped: dataRows.length - imported,
    skipReasons: Object.entries(skipReasonCounts).map(([reason, count]) => ({ reason, count })),
  };
}
