import { useState } from "react";
import { FileSpreadsheet, FileUp, Database } from "lucide-react";
import ImportWizard from "@/components/import-wizard";

interface EhrCardDefinition {
  id: string;
  label: string;
  hint: string;
  icon: typeof Database;
}

// Only two cards: Crystal PM (the one with a real built-in template) and a
// generic CSV path that handles every other EHR via manual column mapping.
// Revolution / OfficeMate / etc. all funnel into the generic CSV flow.
const EHR_CARDS: EhrCardDefinition[] = [
  {
    id: "crystal_pm",
    label: "Crystal PM",
    hint: "Export jobs to CSV from Crystal PM, then upload here.",
    icon: Database,
  },
  {
    id: "generic_csv",
    label: "Other EHR / Generic CSV",
    hint: "Any CSV export — RevolutionEHR, OfficeMate, ECP, etc. Map the columns manually after upload.",
    icon: FileSpreadsheet,
  },
];

export default function StepEhrImport() {
  const [importerOpen, setImporterOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Import from EHR (optional)</h2>
        <p className="text-muted-foreground mt-1">
          Have a CSV export from your EHR? You can import existing jobs now, or skip and
          do it anytime from the Worklist. Most offices skip this on day one.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-3">How importing works</h3>
        <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
          <li>Export a CSV from your EHR — open jobs only.</li>
          <li>Pick the matching format below and select your file.</li>
          <li>Map the columns. Otto remembers your mapping for next time.</li>
          <li>Review and import. You can undo by archiving imported jobs.</li>
        </ol>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {EHR_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setImporterOpen(true)}
              className="text-left p-4 rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/50 transition-colors"
              data-testid={`ehr-card-${card.id}`}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="rounded-md bg-primary/10 p-2">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <p className="font-medium">{card.label}</p>
              </div>
              <p className="text-xs text-muted-foreground">{card.hint}</p>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileUp className="h-3.5 w-3.5" />
        <span>You can re-run import anytime from the Worklist.</span>
      </div>

      <ImportWizard open={importerOpen} onOpenChange={setImporterOpen} />
    </div>
  );
}
