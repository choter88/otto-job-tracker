import { CheckCircle2 } from "lucide-react";

export default function StepDone() {
  return (
    <div className="space-y-6 py-6">
      <div className="flex flex-col items-center text-center gap-4">
        <div className="rounded-full bg-green-500/10 p-4">
          <CheckCircle2 className="h-10 w-10 text-green-600" />
        </div>
        <div className="space-y-2 max-w-md">
          <h2 className="text-2xl font-semibold">You're set</h2>
          <p className="text-muted-foreground">
            Otto is ready to go. You can change any of this anytime in Office Settings.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">A few things to try next:</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Open the dashboard and create your first job.</li>
          <li>Invite team members from Office Settings → Invite Code.</li>
          <li>Set up the Tablet Lab Board if your lab uses one.</li>
        </ul>
      </div>
    </div>
  );
}
