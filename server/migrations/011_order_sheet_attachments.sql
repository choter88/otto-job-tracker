-- A lightweight viewable copy of each parsed order sheet, attached to its
-- ledger row. Path is relative to OTTO_DATA_DIR; the JPEG itself lives on
-- disk at <data>/order-sheet-attachments/<id>.jpg with 0o600 perms so it
-- never bloats the SQLite file (and so backup/restore of the database
-- doesn't drag MB of binary per sheet). attachment_page_count lets the UI
-- hint "+N more pages — open original" when only page 1 was rendered.
ALTER TABLE order_sheet_imports ADD COLUMN attachment_path TEXT;
ALTER TABLE order_sheet_imports ADD COLUMN attachment_size INTEGER;
ALTER TABLE order_sheet_imports ADD COLUMN attachment_page_count INTEGER;
