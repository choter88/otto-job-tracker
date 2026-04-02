import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "";

function withApiBase(url: string): string {
  if (!API_BASE_URL) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return `${API_BASE_URL}/${url}`;
  return `${API_BASE_URL}${url}`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    let code: string | undefined;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json().catch(() => null);
      if (json && typeof json === "object") {
        const candidate = (json as any).error ?? (json as any).message;
        if (typeof candidate === "string" && candidate.trim()) {
          message = candidate.trim();
        }
        if (typeof (json as any).code === "string") {
          code = (json as any).code;
        }
      }
    } else {
      const text = (await res.text().catch(() => "")) || "";
      if (text.trim()) message = text.trim();
    }

    const err: any = new Error(message);
    err.status = res.status;
    if (code) err.code = code;
    throw err;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(withApiBase(url), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(withApiBase(queryKey.join("/") as string), {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
