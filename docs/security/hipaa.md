# HIPAA-oriented guidance (not legal advice)

Offline/local deployment helps, but **HIPAA compliance is a combination of technical controls + policies + training + vendor management**.

## Technical safeguards to implement/verify

- **Unique user IDs** and strong authentication (already present).
- **Automatic logoff** after inactivity (already present; verify on desktop).
- **Role-based access control** (already present; verify least-privilege defaults).
- **Audit controls**:
  - Ensure `phi_access_logs` covers read access for patient/job lists, job details, archived jobs, and exports.
  - Ensure admin actions are logged (`admin_audit_logs`).
- **Integrity controls**:
  - Server-authoritative writes (Host/SOT only).
  - Backups + restore verification.
- **Transmission security**:
  - Prefer TLS on the LAN (self-issued certs with trust/pinning or an office CA).
- **Encryption at rest** (addressable):
  - Require full-disk encryption on the host machine (macOS: FileVault, Windows: BitLocker).
  - Consider DB-level encryption for the local database file/volume.
- **Data minimization**:
  - Avoid logging request/response bodies that could contain ePHI.
  - Avoid committing exports/logs into Git.

## Administrative & physical safeguards (operational)

- Workstation policies (screen lock, access provisioning/deprovisioning, password policy).
- Incident response + breach notification process.
- Backup and disaster recovery policy.
- If any cloud vendors touch ePHI (SMS, email, AI, hosting, error reporting), ensure appropriate agreements (for example BAAs) and configuration.
