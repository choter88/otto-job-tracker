-- Baseline migration: marks the starting point for the migration framework.
--
-- All schema changes that existed before the migration system was introduced
-- are handled by sqlite-bootstrap.ts (imperative TypeScript patches).
-- This file exists so that version 1 is recorded as "applied" and future
-- migrations start from version 2+.
--
-- No-op: the schema is already in the correct state after bootstrap.
SELECT 1;
