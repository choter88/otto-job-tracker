# Auto-Update Security

## Current State

Otto Tracker uses `electron-updater` to check for and install updates from
GitHub Releases on a private repository. Updates are checked every 4 hours and
downloaded silently in the background, then installed on next app quit.

### macOS

- Updates are verified via Gatekeeper and code-signing (Apple Developer ID)
- Notarization ensures Apple has scanned the build for malware
- **Status: Secured**

### Windows

- **Windows code signing is NOT yet implemented**
- `electron-updater` does NOT verify code signatures on Windows by default
- The `verifyUpdateCodeSignature` option is not set in the build config

## Risk

Without Windows code signing, a man-in-the-middle attack on the update channel
could serve a trojanized update binary. The attacker would need to intercept
HTTPS traffic to the GitHub API (e.g., via a compromised DNS resolver or
corporate proxy performing TLS inspection).

### Mitigations in Place

1. Updates are fetched over HTTPS from a pinned GitHub repository
2. GitHub's TLS certificate is validated by Node.js/Chromium
3. The repository is private, limiting attacker knowledge of release timing

### Residual Risk

If DNS or TLS is compromised on the network, the update could be replaced.
This is a **high-severity** risk for practices operating on networks with
shared or untrusted infrastructure.

## Remediation Plan

1. Obtain a Windows EV code-signing certificate
2. Integrate certificate into the release pipeline (`scripts/release-win.js`)
3. Set `verifyUpdateCodeSignature: true` in electron-builder config:
   ```json
   "win": {
     "verifyUpdateCodeSignature": true,
     "signingHashAlgorithms": ["sha256"]
   }
   ```
4. Test that unsigned builds are rejected by the updater
5. Verify SmartScreen warnings are eliminated for new installations
