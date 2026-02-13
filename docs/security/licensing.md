# Offline licensing (no internet)

This document describes an **optional** fully-offline licensing model.

Current desktop production model:
- Host activates/checks in with the portal control plane (`/license/v1/*`).
- Patient/workflow data remains local; licensing requests do not include PHI payloads.

If the app must never connect to the internet, licensing should be **offline**:

## Recommended approach

- You (vendor) generate a **signed license file** (JSON) that contains:
  - customer/office identifier
  - expiration (optional) or subscription term
  - allowed seats / features
  - a Host machine fingerprint (optional, but helpful)
- The desktop Host app verifies the signature using an embedded **public key**.
- The office installs the license file by importing it in-app (USB drive, local file picker, etc.).

## Design goals

- No PHI is ever sent to the licensing system.
- Clients keep working offline even if the subscription expires (configurable grace period).
- Clear in-app status: licensed / expiring soon / expired.

## Notes

- “Machine fingerprinting” should be tolerant of minor changes (OS updates, NIC changes) and should have a support override flow.
- Avoid tying licensing to external time sources; rely on local system time + monotonic counters and keep audit logs for suspicious clock changes.
