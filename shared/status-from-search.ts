// Pulls a ?status=<id> value out of a URL search string (the query string
// wouter's useSearch() returns, with or without a leading "?"). Used by the
// worklist (JobsTable) to pre-filter when arriving from a Today card's
// "View all" footer (see job-queue-tile.tsx). Returns null when the param
// is absent or empty so callers can fall back to their normal default.
export function statusFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const value = params.get("status");
  return value && value.length > 0 ? value : null;
}
