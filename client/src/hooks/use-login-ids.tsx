import { useQuery } from "@tanstack/react-query";

// Approved login IDs for the office, for the pre-login dropdown. Refreshes
// every 45s while the login screen is mounted. Non-fatal on failure — callers
// fall back to a plain text field.
export function useLoginIds(): string[] {
  const { data } = useQuery<string[]>({
    queryKey: ["/api/login-ids"],
    queryFn: async () => {
      const res = await fetch("/api/login-ids", { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json?.loginIds) ? json.loginIds : [];
    },
    refetchInterval: 45_000,
    staleTime: 30_000,
    retry: false,
  });
  return data ?? [];
}
