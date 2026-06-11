-- Learned order-sheet parsing rules ("the parser remembers your fixes").
-- When staff corrects a reviewed sheet, the server derives WHERE on that
-- form each corrected field lives (anchored to a printed label) and saves
-- it here, keyed by the form's label-set fingerprint. Future sheets that
-- fingerprint the same get those fields extracted from the learned spots
-- before the generic heuristics run. Office-wide: one person's correction
-- teaches every computer. The rule column is OrderSheetAnchorRule JSON
-- (shared/order-sheet-layout.ts) — printed form labels and option-id
-- mappings only, never patient data.
CREATE TABLE IF NOT EXISTS order_sheet_templates (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES offices(id),
  fingerprint TEXT NOT NULL,
  -- patientName | trayNumber | phone | orderDate | jobType | destination
  field TEXT NOT NULL,
  rule TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS order_sheet_templates_office_form_field_unique
  ON order_sheet_templates (office_id, fingerprint, field);
