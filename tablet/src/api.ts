// Tablet API client — stores auth token in memory only (no localStorage)

let authToken: string | null = null;
let onAuthExpired: (() => void) | null = null;

// Failed mutations queue (retried on reconnection)
let mutationQueue: Array<{ fn: () => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void }> = [];

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setOnAuthExpired(cb: () => void) {
  onAuthExpired = cb;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    authToken = null;
    onAuthExpired?.();
    throw new ApiError("Session expired", 401);
  }

  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message || body.error || "Forbidden", 403, body.error);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || body.message || `HTTP ${res.status}`, res.status);
  }

  return res.json();
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ── Unauthenticated ──

export function fetchOfficeInfo() {
  return request<{ officeId: string; officeName: string; tabletEnabled: boolean }>("/tablet/api/office-info");
}

export function fetchUsers(officeId: string) {
  return request<Array<{ id: string; firstName: string; lastName: string }>>(
    `/tablet/api/users?officeId=${encodeURIComponent(officeId)}`,
  );
}

export function login(userId: string, pin: string) {
  return request<{
    token: string;
    user: { id: string; firstName: string; lastName: string; role: string };
    officeId: string;
  }>("/tablet/api/login", {
    method: "POST",
    body: JSON.stringify({ userId, pin }),
  });
}

// ── Authenticated ──

export function fetchPoll() {
  return request<{ lastModified: number }>("/tablet/api/poll");
}

export function fetchJobs() {
  return request<{
    jobs: any[];
    commentCounts: Record<string, number>;
    notificationRules: any[];
  }>("/tablet/api/jobs");
}

export function fetchJob(id: string) {
  return request<{
    job: any;
    comments: any[];
    statusHistory: any[];
    linkedJobs: any[];
    groupNotes: any[];
  }>(`/tablet/api/jobs/${encodeURIComponent(id)}`);
}

export function updateJobStatus(id: string, status: string) {
  return request<any>(`/tablet/api/jobs/${encodeURIComponent(id)}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export function addJobNote(id: string, content: string) {
  return request<any>(`/tablet/api/jobs/${encodeURIComponent(id)}/notes`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function createJob(data: {
  patientFirstName?: string;
  patientLastName?: string;
  trayNumber?: string;
  jobType: string;
  status: string;
  orderDestination: string;
  notes?: string;
}) {
  return request<any>("/tablet/api/jobs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function fetchConfig() {
  return request<{
    customStatuses: any[];
    customJobTypes: any[];
    customOrderDestinations: any[];
    jobIdentifierMode: string;
  }>("/tablet/api/config");
}

export function sendHeartbeat() {
  return request<{ ok: boolean }>("/tablet/api/heartbeat", { method: "POST" });
}

export function logout() {
  return request<{ ok: boolean }>("/tablet/api/logout", { method: "POST" }).finally(() => {
    authToken = null;
  });
}

// ── Retry queue for failed mutations ──

export function queueMutation(fn: () => Promise<any>): Promise<any> {
  return new Promise((resolve, reject) => {
    mutationQueue.push({ fn, resolve, reject });
  });
}

export async function retryQueuedMutations(): Promise<void> {
  const queue = [...mutationQueue];
  mutationQueue = [];
  for (const item of queue) {
    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (e) {
      // Re-queue if still disconnected
      mutationQueue.push(item);
      item.reject(e);
      break;
    }
  }
}

export function getQueuedMutationCount(): number {
  return mutationQueue.length;
}
