// Today v2 feature flag. Default OFF. On when env OTTO_TODAY_V2 is truthy
// ("1" or "true") OR office.settings.todayV2 === true.

function envEnabled(): boolean {
  const v = process.env.OTTO_TODAY_V2;
  return v === "1" || v === "true";
}

export function isTodayV2Enabled(office?: any): boolean {
  return envEnabled() || office?.settings?.todayV2 === true;
}
