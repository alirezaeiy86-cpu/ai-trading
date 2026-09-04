// =============================================================================
// TRADING HOURS
// All times are in UTC (HH:MM format).
// =============================================================================

/**
 * Returns true if the current UTC time is within the configured trading window.
 * @param startHHMM  e.g. "09:00"
 * @param endHHMM    e.g. "17:00"
 * @param now        optional Date for testing (defaults to now)
 */
export function isWithinTradingHours(
  startHHMM: string,
  endHHMM:   string,
  now:       Date = new Date(),
): boolean {
  const [startH = 0, startM = 0] = startHHMM.split(':').map(Number);
  const [endH   = 0, endM   = 0] = endHHMM  .split(':').map(Number);

  const nowMinutes   = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes   = endH   * 60 + endM;

  // Handle overnight windows (e.g. 22:00 – 02:00)
  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  } else {
    return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
  }
}

/**
 * Returns true if 24/7 trading is configured (00:00 – 23:59).
 */
export function isAlwaysOpen(startHHMM: string, endHHMM: string): boolean {
  return startHHMM === '00:00' && (endHHMM === '23:59' || endHHMM === '00:00');
}
