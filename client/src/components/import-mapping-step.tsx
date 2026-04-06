import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { OTTO_IMPORT_FIELDS, OTTO_IMPORT_FIELD_LABELS } from "@shared/import-types";
import type { OttoImportField, CsvParseResult } from "@shared/import-types";

const SKIP_VALUE = "__skip__";

interface ImportMappingStepProps {
  csvData: CsvParseResult;
  fieldMappings: Record<string, OttoImportField | null>;
  onFieldMappingsChange: (mappings: Record<string, OttoImportField | null>) => void;
  statusMappings: Record<string, string | null>;
  onStatusMappingsChange: (mappings: Record<string, string | null>) => void;
  jobType: string;
  onJobTypeChange: (type: string) => void;
  customStatuses: { id: string; label: string }[];
  customJobTypes: { id: string; label: string }[];
  templateName?: string;
  notesFromColumns?: string[];
  destinationFallbackColumn?: string;
}

const DEFAULT_STATUSES = [
  { id: "job_created", label: "Job Created" },
  { id: "ordered", label: "Ordered" },
  { id: "in_progress", label: "In Progress" },
  { id: "quality_check", label: "Quality Check" },
  { id: "ready_for_pickup", label: "Ready for Pickup" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const DEFAULT_JOB_TYPES = [
  { id: "glasses", label: "Glasses" },
  { id: "contacts", label: "Contacts" },
  { id: "sunglasses", label: "Sunglasses" },
  { id: "prescription", label: "Prescription" },
];

export default function ImportMappingStep({
  csvData,
  fieldMappings,
  onFieldMappingsChange,
  statusMappings,
  onStatusMappingsChange,
  jobType,
  onJobTypeChange,
  customStatuses,
  customJobTypes,
  templateName,
  notesFromColumns,
  destinationFallbackColumn,
}: ImportMappingStepProps) {
  const statuses = customStatuses.length > 0 ? customStatuses : DEFAULT_STATUSES;
  const jobTypes = customJobTypes.length > 0 ? customJobTypes : DEFAULT_JOB_TYPES;

  const statusColumn = useMemo(() => {
    for (const [col, field] of Object.entries(fieldMappings)) {
      if (field === "status") return col;
    }
    return null;
  }, [fieldMappings]);

  const usedFields = useMemo(() => {
    const used = new Set<string>();
    for (const field of Object.values(fieldMappings)) {
      if (field) used.add(field);
    }
    return used;
  }, [fieldMappings]);

  const sampleValues = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (let colIdx = 0; colIdx < csvData.headers.length; colIdx++) {
      const values = new Set<string>();
      for (const row of csvData.preview) {
        const val = (row[colIdx] || "").trim();
        if (val && values.size < 3) values.add(val);
      }
      result[csvData.headers[colIdx]] = Array.from(values);
    }
    return result;
  }, [csvData]);

  // Estimate how many rows will be skipped based on status mappings
  const skippedStatusCount = useMemo(() => {
    if (!statusColumn) return 0;
    return csvData.uniqueStatusValues.filter(
      (v) => statusMappings[v] === null || statusMappings[v] === undefined,
    ).length;
  }, [statusColumn, statusMappings, csvData.uniqueStatusValues]);

  const handleFieldChange = (csvColumn: string, value: string) => {
    const next = { ...fieldMappings };
    if (value === SKIP_VALUE) {
      next[csvColumn] = null;
    } else {
      next[csvColumn] = value as OttoImportField;
    }
    onFieldMappingsChange(next);
  };

  const handleStatusMappingChange = (csvValue: string, ottoStatus: string) => {
    const next = { ...statusMappings };
    if (ottoStatus === SKIP_VALUE) {
      next[csvValue] = null;
    } else {
      next[csvValue] = ottoStatus;
    }
    onStatusMappingsChange(next);
  };

  return (
    <div className="space-y-5">
      {/* Template badge */}
      {templateName && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Template:</span>
          <Badge variant="secondary" className="text-xs">{templateName}</Badge>
        </div>
      )}

      {/* ── Step 1: Job Type ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold">1</span>
          <h3 className="text-sm font-semibold">What type of jobs are these?</h3>
        </div>
        <Select value={jobType} onValueChange={onJobTypeChange}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select job type" />
          </SelectTrigger>
          <SelectContent>
            {jobTypes.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Step 2: Column Mapping ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold">2</span>
          <h3 className="text-sm font-semibold">Match CSV columns to Otto fields</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3 ml-7">
          Columns set to &ldquo;Skip&rdquo; will not be imported.
        </p>

        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs">CSV Column</TableHead>
                <TableHead className="text-xs">Sample Data</TableHead>
                <TableHead className="text-xs w-[180px]">Maps To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {csvData.headers.map((header) => {
                const currentMapping = fieldMappings[header];
                return (
                  <TableRow key={header}>
                    <TableCell className="font-medium text-xs py-1.5">{header}</TableCell>
                    <TableCell className="py-1.5">
                      <span className="text-xs text-muted-foreground truncate block max-w-[200px]">
                        {(sampleValues[header] || []).join(", ") || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Select
                        value={currentMapping === null ? SKIP_VALUE : currentMapping || SKIP_VALUE}
                        onValueChange={(v) => handleFieldChange(header, v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Skip" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKIP_VALUE}>Skip</SelectItem>
                          {OTTO_IMPORT_FIELDS.map((field) => (
                            <SelectItem
                              key={field}
                              value={field}
                              disabled={usedFields.has(field) && currentMapping !== field}
                            >
                              {OTTO_IMPORT_FIELD_LABELS[field]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Info banners */}
      {notesFromColumns && notesFromColumns.length > 0 && (
        <Alert variant="info" className="py-2 px-3 text-xs">
          <Info className="h-3.5 w-3.5" />
          <AlertDescription>
            <span className="font-medium">Notes:</span> {notesFromColumns.join(", ")} will be combined into the Notes field.
          </AlertDescription>
        </Alert>
      )}
      {destinationFallbackColumn && (
        <Alert variant="info" className="py-2 px-3 text-xs">
          <Info className="h-3.5 w-3.5" />
          <AlertDescription>
            <span className="font-medium">Destination fallback:</span> If empty, <span className="font-medium">{destinationFallbackColumn}</span> will be used.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Step 3: Status Mapping ── */}
      {statusColumn && csvData.uniqueStatusValues.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold">3</span>
            <h3 className="text-sm font-semibold">Map status values</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3 ml-7">
            Rows with &ldquo;Skip&rdquo; status will not be imported.
          </p>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs">CSV Status</TableHead>
                  <TableHead className="text-xs w-[180px]">Maps To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csvData.uniqueStatusValues.map((csvValue) => {
                  const currentMapping = statusMappings[csvValue];
                  return (
                    <TableRow key={csvValue}>
                      <TableCell className="font-medium text-xs py-1.5">{csvValue}</TableCell>
                      <TableCell className="py-1.5">
                        <Select
                          value={currentMapping === null ? SKIP_VALUE : currentMapping || SKIP_VALUE}
                          onValueChange={(v) => handleStatusMappingChange(csvValue, v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Skip" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP_VALUE}>Skip rows</SelectItem>
                            {statuses.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="rounded-lg bg-muted/50 border px-4 py-3 flex items-center justify-between">
        <span className="text-sm">
          <span className="font-medium">{csvData.totalRows}</span> rows in file
          {skippedStatusCount > 0 && (
            <span className="text-muted-foreground">
              {" "}· {skippedStatusCount} status value{skippedStatusCount !== 1 ? "s" : ""} will be skipped
            </span>
          )}
        </span>
        <Badge variant="secondary" className="text-xs">
          {jobTypes.find((t) => t.id === jobType)?.label || jobType}
        </Badge>
      </div>
    </div>
  );
}
