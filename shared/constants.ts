/** Default port Otto Tracker listens on when PORT env var is not set. */
export const OTTO_DEFAULT_PORT = 5150;

/** Default port for the tablet HTTP listener (plain HTTP, no TLS). */
export const OTTO_DEFAULT_TABLET_PORT = 5151;

/**
 * Soft (non-blocking) cap on team members per office.
 *
 * Staff share workstations via PIN login, so there's no per-user seat
 * cost — this isn't a license limit. It's a "huh, that's an unusual
 * shape for an optometry office" tripwire: somewhere past ~50 active
 * accounts, either real users have left and need archiving, or the
 * office really is that large and we'd like to know. Crossing this
 * NEVER blocks an approval; it only shows a one-line banner on the
 * Team page asking the owner to confirm.
 *
 * Paid workstation seats are enforced separately, against the
 * client_devices ledger (see the over-limit grace + read-only flow).
 */
export const OTTO_TEAM_SOFT_CAP = 50;
