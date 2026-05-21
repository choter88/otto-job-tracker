-- Track which portal-side recovery token belongs to each Client
-- device row, so the Host can revoke it when an admin removes the
-- device from the office (or when the Client signals "uninstall and
-- remove from account").
--
-- The token plaintext itself never lives on the Host — only the
-- portal's public recoveryId. The Client holds the plaintext in its
-- own Electron config.

ALTER TABLE client_devices ADD COLUMN recovery_id TEXT;
