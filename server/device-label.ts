// Derive a short, human-readable label from a browser User-Agent
// string. The label appears in the Host's "Computers" tab as the
// auto-default name for a Client device; an admin can override it
// with a custom name (stored in `client_devices.name`).
//
// We don't try to be exhaustive — the goal is "well enough to
// distinguish two computers in the same office", not a full UA
// taxonomy. Form: "OS · Browser" (e.g. "Mac · Chrome"). When the
// platform can't be classified, returns "Unknown computer".

const OS_PATTERNS: Array<[RegExp, string]> = [
  [/Mac OS X|Macintosh/i, "Mac"],
  [/iPad/i, "iPad"],
  [/iPhone|iPod/i, "iPhone"],
  [/Android/i, "Android"],
  [/Windows NT|Windows/i, "Windows"],
  [/CrOS/i, "Chromebook"],
  [/Linux/i, "Linux"],
];

// Order matters: more specific patterns first (Edge before Chrome,
// since Edge UAs also contain "Chrome"). Same for Brave / Opera if
// we ever care to add them.
const BROWSER_PATTERNS: Array<[RegExp, string]> = [
  [/Edg\/[\d.]+/i, "Edge"],
  [/OPR\/[\d.]+|Opera\/[\d.]+/i, "Opera"],
  [/Firefox\/[\d.]+/i, "Firefox"],
  [/CriOS\/[\d.]+/i, "Chrome"], // Chrome on iOS
  [/Chrome\/[\d.]+/i, "Chrome"],
  [/Safari\/[\d.]+/i, "Safari"],
];

export function deriveDeviceAutoLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent || "").trim();
  if (!ua) return "Unknown computer";

  let os: string | null = null;
  for (const [re, label] of OS_PATTERNS) {
    if (re.test(ua)) { os = label; break; }
  }

  let browser: string | null = null;
  for (const [re, label] of BROWSER_PATTERNS) {
    if (re.test(ua)) { browser = label; break; }
  }

  if (os && browser) return `${os} · ${browser}`;
  if (os) return os;
  if (browser) return browser;
  return "Unknown computer";
}
