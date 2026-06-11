import { Zap } from "lucide-react";
import OrderSheetFolderSetup from "@/components/order-sheet-folder-setup";

// Optional, desktop-only step (mirrors EHR Import): set the folder the
// front desk saves frame order sheets into, and Otto turns each new sheet
// into a job automatically. The folder + on/off state are written to this
// machine's otto-config.json by OrderSheetFolderSetup via the desktop
// bridge — there is nothing for the wizard's persist step to save, so it
// just marks the step complete on Next/Skip.
export default function StepOrderSheets() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Automate order sheets (optional)</h2>
        <p className="text-muted-foreground mt-1">
          Pick the folder where your front desk saves printed frame order sheets. Otto watches it and
          turns each new PDF or text file into a job automatically — no manual entry. You can skip this
          and set it up later from the Order Sheets page.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <OrderSheetFolderSetup />

        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-semibold mb-3">How it works</h3>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li>Save (or scan) each frame order sheet as a PDF into the chosen folder.</li>
            <li>Otto reads the patient, order type, lab, and date, then creates the job.</li>
            <li>Anything it can't fully read waits under “Needs attention” for a quick review.</li>
          </ol>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Zap className="h-3.5 w-3.5" />
        <span>Set this up on the computer at the front desk where sheets are saved.</span>
      </div>
    </div>
  );
}
