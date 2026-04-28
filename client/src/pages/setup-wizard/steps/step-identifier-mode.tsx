import IdentifierModeEditor, { type JobIdentifierMode } from "@/components/customization/identifier-mode-editor";

interface StepIdentifierModeProps {
  value: JobIdentifierMode;
  onChange: (next: JobIdentifierMode) => void;
}

export default function StepIdentifierMode({ value, onChange }: StepIdentifierModeProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">How do you identify jobs?</h2>
        <p className="text-muted-foreground mt-1">
          Pick how each job is labeled across the app. You can change this later, but
          changing it after data is entered may make older jobs look inconsistent.
        </p>
      </div>
      <IdentifierModeEditor value={value} onChange={onChange} />
    </div>
  );
}
