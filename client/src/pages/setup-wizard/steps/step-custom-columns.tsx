import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import CustomColumnsEditor, { type CustomColumn } from "@/components/customization/custom-columns-editor";

interface StepCustomColumnsProps {
  columns: CustomColumn[];
  onChange: (columns: CustomColumn[]) => void;
}

export default function StepCustomColumns({ columns, onChange }: StepCustomColumnsProps) {
  // Collapsed by default — most offices won't need this on day one.
  // If they already have any columns, expand automatically so they're not hidden.
  const [expanded, setExpanded] = useState(columns.length > 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Custom fields (optional)</h2>
        <p className="text-muted-foreground mt-1">
          Extra fields you want on every job — tracking number, lab order #, frame
          model, coating type, prescription notes, anything else your office needs.
          Most offices skip this on day one and add fields later as you find gaps.
        </p>
      </div>

      {!expanded ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            No custom fields yet. You can add some now or skip this step entirely.
          </p>
          <Button
            variant="outline"
            onClick={() => setExpanded(true)}
            data-testid="button-expand-custom-columns"
          >
            <ChevronRight className="mr-2 h-4 w-4" />
            Add custom fields
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <CustomColumnsEditor columns={columns} onChange={onChange} />
          {columns.length === 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(false)}
              data-testid="button-collapse-custom-columns"
            >
              <ChevronDown className="mr-2 h-4 w-4" />
              Hide for now
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
