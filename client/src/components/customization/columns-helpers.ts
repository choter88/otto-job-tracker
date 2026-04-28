export type CustomColumn = {
  id: string;
  name: string;
  type: string;
  order: number;
  active: boolean;
  editableInWorklist?: boolean;
  options?: string[];
};

/**
 * Strip empty options from select columns and return the cleaned list, plus
 * the first invalid column (a select with no options) if any. Callers should
 * use this before persisting.
 */
export function cleanColumnsForSave(columns: CustomColumn[]): {
  cleaned: CustomColumn[];
  invalidColumn: CustomColumn | null;
} {
  const cleaned = columns.map((col) =>
    col.type === "select" && col.options
      ? { ...col, options: col.options.map((o) => o.trim()).filter(Boolean) }
      : col,
  );
  const invalidColumn =
    cleaned.find((col) => col.type === "select" && (!col.options || col.options.length === 0)) ||
    null;
  return { cleaned, invalidColumn };
}
