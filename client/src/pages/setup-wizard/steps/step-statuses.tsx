import SortableListEditor, { type CustomListItem } from "@/components/customization/sortable-list-editor";

interface StepStatusesProps {
  items: CustomListItem[];
  onChange: (items: CustomListItem[]) => void;
}

export default function StepStatuses({ items, onChange }: StepStatusesProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Job statuses</h2>
        <p className="text-muted-foreground mt-1">
          Statuses track where each job is in your workflow. We've added the most common
          ones — rename, recolor, or add your own. "Job Created" and "Completed" are
          required and stay at the start and end.
        </p>
      </div>
      <SortableListEditor items={items} onChange={onChange} type="statuses" />
    </div>
  );
}
