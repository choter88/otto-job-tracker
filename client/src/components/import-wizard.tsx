import { useState, useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import ImportTemplateSelect from "./import-template-select";
import ImportMappingStep from "./import-mapping-step";
import type { ImportTemplate, CsvParseResult, OttoImportField, ImportExecuteResult } from "@shared/import-types";
import type { Office } from "@shared/schema";

type WizardStep = "template-select" | "mapping" | "confirm" | "executing" | "result";

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ImportWizard({ open, onOpenChange }: ImportWizardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State
  const [step, setStep] = useState<WizardStep>("template-select");
  const [selectedTemplate, setSelectedTemplate] = useState<ImportTemplate | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [csvData, setCsvData] = useState<CsvParseResult | null>(null);
  const [fieldMappings, setFieldMappings] = useState<Record<string, OttoImportField | null>>({});
  const [statusMappings, setStatusMappings] = useState<Record<string, string | null>>({});
  const [jobType, setJobType] = useState("glasses");
  const [importResult, setImportResult] = useState<ImportExecuteResult | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateSaveName, setTemplateSaveName] = useState("");

  // Data queries
  const { data: templates } = useQuery<{ builtIn: ImportTemplate[]; user: ImportTemplate[] }>({
    queryKey: ["/api/import/templates"],
    enabled: open && !!user?.officeId,
  });

  const { data: office } = useQuery<Office>({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const customStatuses = useMemo(() => (office?.settings as any)?.customStatuses || [], [office?.settings]);
  const customJobTypes = useMemo(() => (office?.settings as any)?.customJobTypes || [], [office?.settings]);

  // Parse CSV mutation
  const parseMutation = useMutation({
    mutationFn: async ({ path, statusColumn }: { path: string; statusColumn?: string }) => {
      const res = await apiRequest("POST", "/api/import/parse", { filePath: path, statusColumn });
      return res.json() as Promise<CsvParseResult>;
    },
  });

  // Execute import mutation
  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/import/execute", {
        filePath,
        jobType,
        fieldMappings,
        statusMappings,
        notesFromColumns: selectedTemplate?.notesFromColumns,
        destinationFallbackColumn: selectedTemplate?.destinationFallbackColumn,
      });
      return res.json() as Promise<ImportExecuteResult>;
    },
    onSuccess: (result) => {
      setImportResult(result);
      setStep("result");
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
      setStep("mapping");
    },
  });

  // Save template mutation
  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/import/templates", {
        name: templateSaveName.trim(),
        jobType,
        fieldMappings,
        statusMappings,
        derivedFrom: selectedTemplate?.type === "built-in" ? selectedTemplate.id : undefined,
        notesFromColumns: selectedTemplate?.notesFromColumns,
        destinationFallbackColumn: selectedTemplate?.destinationFallbackColumn,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/import/templates"] });
      toast({ title: "Template saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save template", description: err.message, variant: "destructive" });
    },
  });

  // Reset wizard state
  const resetWizard = useCallback(() => {
    setStep("template-select");
    setSelectedTemplate(null);
    setFilePath(null);
    setCsvData(null);
    setFieldMappings({});
    setStatusMappings({});
    setJobType("glasses");
    setImportResult(null);
    setSaveAsTemplate(false);
    setTemplateSaveName("");
  }, []);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    // Delay reset to avoid flicker during close animation
    setTimeout(resetWizard, 200);
  }, [onOpenChange, resetWizard]);

  // Pick a CSV file via the Electron IPC bridge
  const pickFile = useCallback(async (): Promise<string | null> => {
    const otto = (window as any)?.otto;
    if (!otto?.importPickCsv) {
      toast({
        title: "Desktop app required",
        description: "CSV import requires the Otto desktop app.",
        variant: "destructive",
      });
      return null;
    }

    const result = await otto.importPickCsv();
    if (!result?.ok || result.canceled) return null;
    return result.filePath;
  }, [toast]);

  // After template selection, open file picker and parse
  const handleTemplateSelect = useCallback(
    async (template: ImportTemplate | null) => {
      setSelectedTemplate(template);

      const path = await pickFile();
      if (!path) return;
      setFilePath(path);

      // Find which column maps to status (if template provides one)
      let statusCol: string | undefined;
      if (template) {
        for (const [col, field] of Object.entries(template.fieldMappings)) {
          if (field === "status") {
            statusCol = col;
            break;
          }
        }
      }

      try {
        const data = await parseMutation.mutateAsync({ path, statusColumn: statusCol });
        setCsvData(data);

        // Pre-fill mappings from template if one was selected
        if (template) {
          // Only keep mappings for columns that actually exist in this CSV
          const validMappings: Record<string, OttoImportField | null> = {};
          for (const [col, field] of Object.entries(template.fieldMappings)) {
            if (data.headers.includes(col)) {
              validMappings[col] = field as OttoImportField | null;
            }
          }
          setFieldMappings(validMappings);
          setStatusMappings(template.statusMappings || {});
          setJobType(template.jobType || "glasses");
        } else {
          setFieldMappings({});
          setStatusMappings({});
        }

        setStep("mapping");
      } catch (err: any) {
        toast({ title: "Failed to parse CSV", description: err.message, variant: "destructive" });
      }
    },
    [pickFile, parseMutation, toast],
  );

  // Re-parse to get unique status values when the status column mapping changes
  const handleFieldMappingsChange = useCallback(
    async (mappings: Record<string, OttoImportField | null>) => {
      setFieldMappings(mappings);

      // Check if a column was just mapped to "status"
      let newStatusCol: string | undefined;
      for (const [col, field] of Object.entries(mappings)) {
        if (field === "status") {
          newStatusCol = col;
          break;
        }
      }

      // Re-parse to get unique status values for the newly mapped column
      if (newStatusCol && filePath) {
        const oldStatusCol = Object.entries(fieldMappings).find(([, f]) => f === "status")?.[0];
        if (newStatusCol !== oldStatusCol) {
          try {
            const data = await parseMutation.mutateAsync({
              path: filePath,
              statusColumn: newStatusCol,
            });
            setCsvData(data);
          } catch {
            // Non-critical — preview data is still valid
          }
        }
      }
    },
    [fieldMappings, filePath, parseMutation],
  );

  // Compute import preview counts
  const previewCounts = useMemo(() => {
    if (!csvData) return { total: 0, willImport: 0, willSkip: 0 };
    // This is a rough estimate — actual skip count comes from the server
    return { total: csvData.totalRows, willImport: csvData.totalRows, willSkip: 0 };
  }, [csvData]);

  // Check if mapping is valid enough to proceed
  const canProceed = useMemo(() => {
    // Need at least lastName or patientNameCombined mapped
    const hasName = Object.values(fieldMappings).some(
      (f) => f === "lastName" || f === "patientNameCombined",
    );
    return hasName && !!jobType;
  }, [fieldMappings, jobType]);

  const handleProceedToConfirm = useCallback(() => {
    setStep("confirm");
  }, []);

  const handleExecuteImport = useCallback(async () => {
    // Save template first if requested
    if (saveAsTemplate && templateSaveName.trim()) {
      await saveTemplateMutation.mutateAsync();
    }
    setStep("executing");
    executeMutation.mutate();
  }, [saveAsTemplate, templateSaveName, saveTemplateMutation, executeMutation]);

  // Auto-skip template selection if no templates exist
  const hasTemplates =
    (templates?.builtIn?.length || 0) > 0 || (templates?.user?.length || 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? handleClose() : onOpenChange(true))}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "template-select" && "Import Jobs from EHR Export"}
            {step === "mapping" && "Map CSV Columns"}
            {step === "confirm" && "Confirm Import"}
            {step === "executing" && "Importing..."}
            {step === "result" && "Import Complete"}
          </DialogTitle>
          {step === "template-select" && (
            <DialogDescription>
              Choose a saved template or start from scratch to map your CSV columns.
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Step: Template Selection */}
        {step === "template-select" && (
          <ImportTemplateSelect
            builtIn={templates?.builtIn || []}
            user={templates?.user || []}
            onSelect={handleTemplateSelect}
          />
        )}

        {/* Step: Mapping */}
        {step === "mapping" && csvData && (
          <div className="space-y-6">
            <ImportMappingStep
              csvData={csvData}
              fieldMappings={fieldMappings}
              onFieldMappingsChange={handleFieldMappingsChange}
              statusMappings={statusMappings}
              onStatusMappingsChange={setStatusMappings}
              jobType={jobType}
              onJobTypeChange={setJobType}
              customStatuses={customStatuses}
              customJobTypes={customJobTypes}
              templateName={selectedTemplate?.name}
              notesFromColumns={selectedTemplate?.notesFromColumns}
              destinationFallbackColumn={selectedTemplate?.destinationFallbackColumn}
            />

            {/* Save as template */}
            <div className="flex items-center gap-3 pt-2 border-t">
              <Checkbox
                id="save-template"
                checked={saveAsTemplate}
                onCheckedChange={(checked) => setSaveAsTemplate(!!checked)}
              />
              <Label htmlFor="save-template" className="text-sm">
                Save this mapping as a template
              </Label>
              {saveAsTemplate && (
                <Input
                  placeholder="Template name"
                  value={templateSaveName}
                  onChange={(e) => setTemplateSaveName(e.target.value)}
                  className="w-64"
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="ghost" onClick={() => setStep("template-select")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={handleProceedToConfirm} disabled={!canProceed}>
                Preview Import
              </Button>
            </div>
          </div>
        )}

        {/* Step: Confirm */}
        {step === "confirm" && csvData && (
          <div className="space-y-6">
            <div className="rounded-lg border p-6 space-y-3">
              <p className="text-lg font-medium">
                {previewCounts.total} rows will be processed
              </p>
              <p className="text-sm text-muted-foreground">
                Job type:{" "}
                <span className="font-medium text-foreground">
                  {customJobTypes.find((t: any) => t.id === jobType)?.label ||
                    jobType.charAt(0).toUpperCase() + jobType.slice(1)}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Rows missing a patient last name or with unmapped status values will be skipped.
              </p>
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="ghost" onClick={() => setStep("mapping")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={handleExecuteImport}>Import Jobs</Button>
            </div>
          </div>
        )}

        {/* Step: Executing */}
        {step === "executing" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Importing jobs...</p>
          </div>
        )}

        {/* Step: Result */}
        {step === "result" && importResult && (
          <div className="space-y-6">
            <div className="rounded-lg border p-6 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                <p className="text-lg font-medium">
                  Successfully imported {importResult.imported} job{importResult.imported !== 1 ? "s" : ""}
                </p>
              </div>

              {importResult.skipped > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertCircle className="h-4 w-4" />
                    <span>{importResult.skipped} row{importResult.skipped !== 1 ? "s" : ""} skipped</span>
                  </div>
                  {importResult.skipReasons.length > 0 && (
                    <ul className="text-sm text-muted-foreground ml-6 space-y-1">
                      {importResult.skipReasons.map((r, i) => (
                        <li key={i}>
                          {r.reason}: {r.count} row{r.count !== 1 ? "s" : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}

        {/* Loading state for parse */}
        {parseMutation.isPending && step === "template-select" && (
          <div className="flex items-center justify-center py-8 gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-muted-foreground">Parsing CSV file...</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
