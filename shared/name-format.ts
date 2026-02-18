function capitalizeWordSegment(segment: string): string {
  if (!segment) return "";
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

function capitalizeWord(word: string): string {
  return word
    .split("-")
    .map((part) =>
      part
        .split("'")
        .map((subPart) => capitalizeWordSegment(subPart))
        .join("'"),
    )
    .join("-");
}

export function normalizePatientNamePart(value: string | null | undefined): string {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) return "";

  return normalized
    .split(" ")
    .map((word) => capitalizeWord(word))
    .join(" ");
}

export function formatPatientDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const first = normalizePatientNamePart(firstName);
  const last = normalizePatientNamePart(lastName);
  return `${first} ${last}`.trim();
}
