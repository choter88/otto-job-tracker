// Pure projection of office users to their login IDs ONLY. Used by the public
// pre-login endpoint, so it must never surface names, PINs, or any other field.
export function toLoginIds(users: ReadonlyArray<{ loginId?: string | null }> | null | undefined): string[] {
  if (!Array.isArray(users)) return [];
  const seen = new Set<string>();
  for (const u of users) {
    const id = typeof u?.loginId === "string" ? u.loginId.trim() : "";
    if (id) seen.add(id);
  }
  return Array.from(seen).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
