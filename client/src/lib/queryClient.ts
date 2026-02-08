import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { enqueueOutboxItem } from "./offline-outbox";

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

function isMutatingMethod(method: string): boolean {
  const m = String(method || "").toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

function shouldQueueOffline(method: string, url: string): boolean {
  if (!isMutatingMethod(method)) return false;

  // Only queue core job operations for now (jobs, comments, flags, archive/restore).
  const absolute = withApiBase(url);
  try {
    const parsed = new URL(absolute, window.location.origin);
    const path = parsed.pathname;
    if (!path.startsWith("/api/jobs")) return false;
    if (path.includes("/comment-reads")) return false; // not important enough to queue
    if (path.includes("/summary")) return false; // AI summary is not available offline
    return true;
  } catch {
    return false;
  }
}

function isLikelyNetworkError(error: unknown): boolean {
  const message = String((error as any)?.message || "");
  if ((error as any)?.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  if (message.includes("Failed to fetch")) return true;
  if (message.toLowerCase().includes("networkerror")) return true;
  if (message.toLowerCase().includes("load failed")) return true;
  return false;
}

function randomId(): string {
  try {
    const cryptoObj = (globalThis as any)?.crypto;
    if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  } catch {
    // ignore
  }
  return `outbox-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    const res = await fetch(withApiBase(url), {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    if (!isLikelyNetworkError(error) || !shouldQueueOffline(method, url)) {
      throw error;
    }

    const outboxId = randomId();
    try {
      await enqueueOutboxItem({
        id: outboxId,
        origin: window.location.origin,
        method: String(method || "POST").toUpperCase(),
        url,
        body: data ?? null,
      });

      try {
        window.dispatchEvent(
          new CustomEvent("otto:offlineQueued", {
            detail: {
              id: outboxId,
              method: String(method || "POST").toUpperCase(),
              url,
            },
          }),
        );
      } catch {
        // ignore
      }

      return new Response(JSON.stringify({ ok: true, queued: true, outboxId }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // If we can't persist the outbox (e.g. not running in Electron), fall back to the original error.
      throw error;
    }
  }
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
