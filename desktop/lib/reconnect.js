// Electron-free pure logic for the client reconnect controller, so the timing
// and the "are we actually back online?" decision are unit-testable.

// Exponential backoff (ms) between reconnect attempts, capped at 15s.
export function getReconnectDelay(attempt) {
  const n = Math.min(Number(attempt) || 0, 10);
  return Math.min(15000, 2000 * Math.pow(1.5, n));
}

// A load only counts as "online" when the TARGET app origin loaded. The local
// offline.html (a file:// URL) must return false, or a finished offline-page
// load would wrongly stop the retry loop and strand the user.
export function isOnlineLoad(loadedUrl, targetUrl) {
  try {
    return new URL(loadedUrl).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}

// Which session-CSP policy a response should get: the relaxed (inline-allowing)
// one for local packaged HTML loaded via file:// (offline.html's "Try now"
// button is an inline <script>), the strict one for the real app over https.
// Lives here (electron-free) so the security-relevant choice is unit-testable.
export function cspAllowsInline(url, allowInlineScripts) {
  return !!allowInlineScripts || String(url || "").startsWith("file:");
}
