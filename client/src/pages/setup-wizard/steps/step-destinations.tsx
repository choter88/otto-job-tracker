import SortableListEditor, { type CustomListItem } from "@/components/customization/sortable-list-editor";

interface StepDestinationsProps {
  items: CustomListItem[];
  onChange: (items: CustomListItem[]) => void;
}

export default function StepDestinations({ items, onChange }: StepDestinationsProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Labs</h2>
        <p className="text-muted-foreground mt-1">
          The labs you send contact lens and prescription lens orders to. We've added a
          few common ones — replace them with the labs your office actually uses.
        </p>
      </div>
      <SortableListEditor items={items} onChange={onChange} type="destinations" />
    </div>
  );
}
