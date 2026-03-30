import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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

  // Find which column is mapped to "status" to show status sub-mapping
  const statusColumn = useMemo(() => {
    for (const [col, field] of Object.entries(fieldMappings)) {
      if (field === "status") return col;
    }
    return null;
  }, [fieldMappings]);

  // Already-used Otto fields (to prevent double-mapping)
  const usedFields = useMemo(() => {
    const used = new Set<string>();
    for (const field of Object.values(fieldMappings)) {
      if (field) used.add(field);
    }
    return used;
  }, [fieldMappings]);

  // Sample values for each column (from preview data)
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
    <div className="space-y-6">
      {/* Template badge */}
      {templateName && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Based on:</span>
          <Badge variant="secondary">{templateName}</Badge>
        </div>
      )}

      {/* Job type selector */}
      <div>
        <label className="text-sm font-medium mb-2 block">
          Job Type <span className="text-muted-foreground">(applies to all imported rows)</span>
        </label>
        <Select value={jobType} onValueChange={onJobTypeChange}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select job type" />
          </SelectTrigger>
          <SelectContent>
            {jobTypes.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Column mapping */}
      <div>
        <h3 className="text-sm font-medium mb-3">Map CSV Columns to Otto Fields</h3>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">CSV Column</TableHead>
                <TableHead className="w-[200px]">Sample Values</TableHead>
                <TableHead className="w-[250px]">Maps To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {csvData.headers.map((header) => {
                const currentMapping = fieldMappings[header];
                return (
                  <TableRow key={header}>
                    <TableCell className="font-medium">{header}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {(sampleValues[header] || []).join(", ") || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={currentMapping === null ? SKIP_VALUE : currentMapping || SKIP_VALUE}
                        onValueChange={(v) => handleFieldChange(header, v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Skip (don't import)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKIP_VALUE}>Skip (don&apos;t import)</SelectItem>
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

      {/* Notes combination info */}
      {notesFromColumns && notesFromColumns.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
          <span className="font-medium text-blue-700">Notes:</span>{" "}
          <span className="text-blue-600">
            The following columns will be combined into the Notes field:{" "}
            {notesFromColumns.map((col, i) => (
              <span key={col}>
                <span className="font-medium">{col}</span>
                {i < notesFromColumns.length - 1 ? ", " : ""}
              </span>
            ))}
          </span>
        </div>
      )}

      {/* Destination fallback info */}
      {destinationFallbackColumn && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
          <span className="font-medium text-blue-700">Destination fallback:</span>{" "}
          <span className="text-blue-600">
            If the destination column is empty, <span className="font-medium">{destinationFallbackColumn}</span> will be used instead.
          </span>
        </div>
      )}

      {/* Status sub-mapping (only when a column is mapped to status) */}
      {statusColumn && csvData.uniqueStatusValues.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3">
            Map Status Values
            <span className="font-normal text-muted-foreground ml-2">
              (from column &ldquo;{statusColumn}&rdquo;)
            </span>
          </h3>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">CSV Status Value</TableHead>
                  <TableHead className="w-[250px]">Maps To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csvData.uniqueStatusValues.map((csvValue) => {
                  const currentMapping = statusMappings[csvValue];
                  return (
                    <TableRow key={csvValue}>
                      <TableCell className="font-medium">{csvValue}</TableCell>
                      <TableCell>
                        <Select
                          value={currentMapping === null ? SKIP_VALUE : currentMapping || SKIP_VALUE}
                          onValueChange={(v) => handleStatusMappingChange(csvValue, v)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Skip rows with this status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP_VALUE}>Skip rows with this status</SelectItem>
                            {statuses.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.label}
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
      )}

      {/* CSV preview */}
      <div>
        <h3 className="text-sm font-medium mb-3">
          CSV Preview
          <span className="font-normal text-muted-foreground ml-2">
            (first {csvData.preview.length} of {csvData.totalRows} rows)
          </span>
        </h3>
        <div className="border rounded-lg overflow-auto max-h-48">
          <Table>
            <TableHeader>
              <TableRow>
                {csvData.headers.map((h) => (
                  <TableHead key={h} className="whitespace-nowrap text-xs">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {csvData.preview.map((row, i) => (
                <TableRow key={i}>
                  {csvData.headers.map((_, colIdx) => (
                    <TableCell key={colIdx} className="text-xs whitespace-nowrap">
                      {row[colIdx] || ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
