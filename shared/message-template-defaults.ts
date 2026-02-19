export const DEFAULT_READY_FOR_PICKUP_TEMPLATE =
  "Hi {patient_first_name}, your order #{order_id} is ready for pickup at {office_name}.";

function normalizeStatusToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getStatusId(entry: any): string {
  if (!entry || typeof entry !== "object") return "";
  return String(entry.id || entry.key || entry.value || "").trim();
}

function getStatusLabel(entry: any): string {
  if (!entry || typeof entry !== "object") return "";
  return String(entry.label || entry.name || entry.title || "").trim();
}

export function isReadyForPickupStatus(value: unknown): boolean {
  const token = normalizeStatusToken(value);
  return token === "readyforpickup" || token === "pickupready";
}

export function ensureReadyForPickupTemplate(
  templatesInput: Record<string, unknown> | null | undefined,
  statusesInput?: unknown,
): Record<string, string> {
  const next: Record<string, string> = {};
  if (templatesInput && typeof templatesInput === "object" && !Array.isArray(templatesInput)) {
    for (const [key, value] of Object.entries(templatesInput)) {
      if (typeof value === "string") {
        next[key] = value;
      }
    }
  }

  const readyStatusIds = new Set<string>();
  if (Array.isArray(statusesInput)) {
    for (const status of statusesInput) {
      const id = getStatusId(status);
      const label = getStatusLabel(status);
      if (isReadyForPickupStatus(id) || isReadyForPickupStatus(label)) {
        if (id) readyStatusIds.add(id);
      }
    }
  }
  if (readyStatusIds.size === 0) {
    readyStatusIds.add("ready_for_pickup");
  }

  const existingReadyTemplate = Object.entries(next).find(([key, value]) => {
    return isReadyForPickupStatus(key) && String(value || "").trim().length > 0;
  })?.[1];
  const fallbackTemplate = String(existingReadyTemplate || "").trim() || DEFAULT_READY_FOR_PICKUP_TEMPLATE;

  for (const statusId of Array.from(readyStatusIds)) {
    const current = String(next[statusId] || "").trim();
    if (!current) {
      next[statusId] = fallbackTemplate;
    }
  }

  return next;
}
