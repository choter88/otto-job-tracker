import SortableListEditor, { type CustomListItem } from "@/components/customization/sortable-list-editor";

interface StepJobTypesProps {
  items: CustomListItem[];
  onChange: (items: CustomListItem[]) => void;
}

export default function StepJobTypes({ items, onChange }: StepJobTypesProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Job types</h2>
        <p className="text-muted-foreground mt-1">
          Categorize jobs by what's being made (glasses, contacts, etc). Used in filters
          and labels throughout the app.
        </p>
      </div>
      <SortableListEditor items={items} onChange={onChange} type="jobTypes" />
    </div>
  );
}
