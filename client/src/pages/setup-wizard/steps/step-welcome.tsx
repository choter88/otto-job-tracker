import { Sparkles } from "lucide-react";

export default function StepWelcome() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold">Welcome to Otto</h2>
          <p className="text-muted-foreground mt-1">
            Let's set up Otto for your office. This takes about 5 minutes — you can skip
            anything and come back later from Office Settings.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-5">
        <p className="text-sm font-medium">What we'll cover</p>
        <ul className="text-sm text-muted-foreground space-y-2">
          <li>
            <strong className="text-foreground">How jobs are identified</strong> — patient name
            or tray number.
          </li>
          <li>
            <strong className="text-foreground">Statuses, types, and labs</strong> —
            the lists Otto uses to categorize your work.
          </li>
          <li>
            <strong className="text-foreground">Custom fields</strong> (optional) — extra
            columns like lab order # or frame model.
          </li>
          <li>
            <strong className="text-foreground">Overdue rules</strong> — alerts when a job
            sits in a status too long.
          </li>
          <li>
            <strong className="text-foreground">EHR import</strong> (optional) — bring in
            existing jobs from a CSV export.
          </li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Each step saves on its own. If you close this and come back later, your progress is
        kept.
      </p>
    </div>
  );
}
