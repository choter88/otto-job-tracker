/**
 * cleanColumnsForSave is the validation gate before persisting custom columns
 * (used by both Settings modal and the wizard's Custom Columns step). The
 * goal is one source of truth for the "select column needs at least one
 * option" rule.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { cleanColumnsForSave, type CustomColumn } from "../client/src/components/customization/columns-helpers";

test("cleanColumnsForSave: trims and drops empty options for select columns", () => {
  const columns: CustomColumn[] = [
    {
      id: "col1",
      name: "Lab",
      type: "select",
      order: 1,
      active: true,
      options: ["  Vision Lab  ", "", "EyeTech", "  "],
    },
  ];
  const { cleaned, invalidColumn } = cleanColumnsForSave(columns);
  assert.equal(invalidColumn, null);
  assert.deepEqual(cleaned[0].options, ["Vision Lab", "EyeTech"]);
});

test("cleanColumnsForSave: returns invalidColumn for select column with empty options", () => {
  const columns: CustomColumn[] = [
    { id: "c1", name: "Empty Select", type: "select", order: 1, active: true, options: [] },
  ];
  const { invalidColumn } = cleanColumnsForSave(columns);
  assert.ok(invalidColumn);
  assert.equal(invalidColumn?.name, "Empty Select");
});

test("cleanColumnsForSave: returns invalidColumn when options are only whitespace", () => {
  const columns: CustomColumn[] = [
    {
      id: "c1",
      name: "Whitespace Select",
      type: "select",
      order: 1,
      active: true,
      options: ["   ", "\t", ""],
    },
  ];
  const { invalidColumn } = cleanColumnsForSave(columns);
  assert.ok(invalidColumn);
});

test("cleanColumnsForSave: text/checkbox/date/number columns pass through unchanged", () => {
  const columns: CustomColumn[] = [
    { id: "t", name: "Text", type: "text", order: 1, active: true },
    { id: "c", name: "Check", type: "checkbox", order: 2, active: true },
    { id: "d", name: "Date", type: "date", order: 3, active: true },
    { id: "n", name: "Number", type: "number", order: 4, active: true },
  ];
  const { cleaned, invalidColumn } = cleanColumnsForSave(columns);
  assert.equal(invalidColumn, null);
  assert.equal(cleaned.length, 4);
});

test("cleanColumnsForSave: returns the FIRST invalid column found", () => {
  const columns: CustomColumn[] = [
    { id: "a", name: "First Bad", type: "select", order: 1, active: true, options: [] },
    { id: "b", name: "Second Bad", type: "select", order: 2, active: true, options: [] },
  ];
  const { invalidColumn } = cleanColumnsForSave(columns);
  assert.equal(invalidColumn?.name, "First Bad");
});
