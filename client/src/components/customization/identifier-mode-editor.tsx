import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type JobIdentifierMode = "patientName" | "trayNumber";

interface IdentifierModeEditorProps {
  value: JobIdentifierMode;
  onChange: (next: JobIdentifierMode) => void;
}

export default function IdentifierModeEditor({ value, onChange }: IdentifierModeEditorProps) {
  return (
    <div className="bg-panel border border-line rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5 min-w-0">
          <Label className="text-[calc(13px*var(--ui-scale))] font-medium text-ink">
            Job Identifier Mode
          </Label>
          <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute">
            Choose how jobs are identified in your practice.
          </p>
        </div>
        <Select value={value} onValueChange={(v: JobIdentifierMode) => onChange(v)}>
          <SelectTrigger className="w-48 shrink-0" data-testid="select-identifier-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="patientName">Patient Name</SelectItem>
            <SelectItem value="trayNumber">Tray Number</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 p-3 bg-paper-2 rounded-md border border-line-2">
        <p className="text-[calc(12px*var(--ui-scale))] text-ink-mute leading-relaxed">
          {value === "patientName"
            ? 'Jobs will be identified by patient first and last name (e.g., "Jane Smith").'
            : "Jobs will be identified by a manually-entered tray number. Patient name fields will not be required."}
        </p>
      </div>
    </div>
  );
}
