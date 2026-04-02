type MaybePromise<T> = T | Promise<T>;

export type OutboxItem = {
  id: string;
  idempotencyKey: string;
  origin: string;
  method: string;
  url: string;
  body: unknown | null;
  createdAt: number;
  attempts: number;
  lastError: string | null;
};

export type OutboxFlushFailedItem = {
  method: string;
  url: string;
  error: string;
  attempts: number;
};

export type OutboxFlushResult = {
  flushed: number;
  remaining: number;
  blockedByAuth: boolean;
  lastError: string | null;
  failedItems: OutboxFlushFailedItem[];
};

type OutboxBridge = {
  outboxGet?: () => MaybePromise<unknown>;
  outboxReplace?: (items: unknown) => MaybePromise<unknown>;
};

function getBridge(): OutboxBridge | null {
  try {
    return (window as any)?.otto || null;
  } catch {
    return null;
  }
}

function isLikelyItem(value: any): value is OutboxItem {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.origin === "string" &&
    typeof value.method === "string" &&
    typeof value.url === "string"
  );
}

function safeNow(): number {
  return Date.now();
}

function getApiBaseUrl(): string {
  const raw = (import.meta as any)?.env?.VITE_API_BASE_URL;
  return typeof raw === "string" ? raw.replace(/\/$/, "") : "";
}

function withApiBase(url: string): string {
  const base = getApiBaseUrl();
  if (!base) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return `${base}/${url}`;
  return `${base}${url}`;
}

let cache: OutboxItem[] | null = null;
let loadPromise: Promise<OutboxItem[]> | null = null;
let flushPromise: Promise<OutboxFlushResult> | null = null;
const listeners = new Set<(items: OutboxItem[]) => void>();

function emit(items: OutboxItem[]) {
  listeners.forEach((listener) => {
    try {
      listener(items);
    } catch {
      // ignore
    }
  });
}

async function load(force = false): Promise<OutboxItem[]> {
  if (!force && cache) return cache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const bridge = getBridge();
    if (!bridge?.outboxGet) return [];

    const raw = await bridge.outboxGet();
    const items = Array.isArray(raw) ? raw.filter(isLikelyItem) : [];
    cache = items.map((item: any) => ({
      id: item.id,
      idempotencyKey: typeof item.idempotencyKey === "string" ? item.idempotencyKey : item.id,
      origin: item.origin,
      method: item.method,
      url: item.url,
      body: item.body ?? null,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : safeNow(),
      attempts: typeof item.attempts === "number" ? item.attempts : 0,
      lastError: typeof item.lastError === "string" ? item.lastError : null,
    }));

    emit(cache);
    return cache;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

async function save(items: OutboxItem[]): Promise<void> {
  cache = items;
  emit(items);

  const bridge = getBridge();
  if (!bridge?.outboxReplace) return;
  await bridge.outboxReplace(items);
}

export async function listOutboxItems(): Promise<OutboxItem[]> {
  return await load();
}

export async function refreshOutboxItems(): Promise<OutboxItem[]> {
  return await load(true);
}

export function subscribeOutbox(listener: (items: OutboxItem[]) => void): () => void {
  listeners.add(listener);
  void load().then((items) => listener(items));
  return () => listeners.delete(listener);
}

export async function enqueueOutboxItem(input: {
  id: string;
  idempotencyKey?: string;
  origin: string;
  method: string;
  url: string;
  body: unknown | null;
}): Promise<void> {
  const bridge = getBridge();
  if (!bridge?.outboxGet || !bridge?.outboxReplace) {
    throw new Error("Offline outbox is not available in this environment.");
  }

  const existing = await load();
  const next: OutboxItem[] = [
    ...existing,
    {
      id: input.id,
      idempotencyKey: input.idempotencyKey || input.id,
      origin: input.origin,
      method: input.method,
      url: input.url,
      body: input.body ?? null,
      createdAt: safeNow(),
      attempts: 0,
      lastError: null,
    },
  ].slice(-500);

  await save(next);
}

export async function clearOutboxItems(): Promise<void> {
  const bridge = getBridge();
  if (!bridge?.outboxReplace) {
    throw new Error("Offline outbox is not available in this environment.");
  }
  await save([]);
}

export async function flushOutbox(origin: string): Promise<OutboxFlushResult> {
  if (flushPromise) return await flushPromise;

  flushPromise = (async () => {
  const items = await load();
  const matching = items.filter((item) => item.origin === origin);
  const other = items.filter((item) => item.origin !== origin);

  if (matching.length === 0) {
    return { flushed: 0, remaining: items.length, blockedByAuth: false, lastError: null, failedItems: [] };
  }

  const MAX_ATTEMPTS = 10;
  const remaining: OutboxItem[] = [];
  const failedItems: OutboxFlushFailedItem[] = [];
  let flushed = 0;
  let blockedByAuth = false;
  let lastError: string | null = null;

  for (const item of matching) {
    // Drop items that have exceeded max retry attempts
    if (item.attempts >= MAX_ATTEMPTS) {
      console.warn(`[outbox] Dropping item ${item.id} after ${item.attempts} failed attempts: ${item.lastError}`);
      continue; // silently remove from queue
    }

    try {
      const headers: Record<string, string> = {};
      if (item.body) headers["Content-Type"] = "application/json";
      if (item.idempotencyKey) headers["Idempotency-Key"] = item.idempotencyKey;

      const res = await fetch(withApiBase(item.url), {
        method: item.method,
        headers,
        body: item.body ? JSON.stringify(item.body) : undefined,
        credentials: "include",
      });

      if (res.status === 401) {
        // Auth failure affects ALL remaining items — stop and keep everything queued
        blockedByAuth = true;
        lastError = "Please sign in to sync offline changes.";
        remaining.push({ ...item, attempts: item.attempts + 1, lastError });
        // Push all remaining items without attempting them
        for (const rest of matching.slice(matching.indexOf(item) + 1)) {
          if (rest.attempts < MAX_ATTEMPTS) remaining.push(rest);
        }
        break;
      }

      if (!res.ok) {
        // Non-auth failure: skip this item but CONTINUE with the next
        const text = (await res.text().catch(() => "")) || res.statusText || "Request failed";
        lastError = `${res.status}: ${text}`.slice(0, 500);
        remaining.push({ ...item, attempts: item.attempts + 1, lastError });
        failedItems.push({ method: item.method, url: item.url, error: lastError, attempts: item.attempts + 1 });
        continue;
      }

      flushed += 1;
    } catch (error: any) {
      // Network error: skip this item but continue (Host might be partially available)
      lastError = String(error?.message || "Network error").slice(0, 500);
      remaining.push({ ...item, attempts: item.attempts + 1, lastError });
      failedItems.push({ method: item.method, url: item.url, error: lastError, attempts: item.attempts + 1 });
      continue;
    }
  }

  await save([...other, ...remaining]);
  return { flushed, remaining: other.length + remaining.length, blockedByAuth, lastError, failedItems };
  })();

  try {
    return await flushPromise;
  } finally {
    flushPromise = null;
  }
}
