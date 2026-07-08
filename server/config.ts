export const config = {
  rsvpCutoffDate: process.env.RSVP_CUTOFF_DATE || null,
};

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

//past cutoff date? (inclusive)
export function isRsvpLocked(): boolean {
  if (!config.rsvpCutoffDate) {
    return false;
  }

  const cutoff = parseLocalDate(config.rsvpCutoffDate);
  if (!cutoff) {
    console.warn(
      `[config] RSVP_CUTOFF_DATE "${config.rsvpCutoffDate}" is not a valid YYYY-MM-DD date. RSVPs will not lock.`
    );
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today > cutoff;
}

export function getRsvpSettings() {
  return {
    cutoffDate: config.rsvpCutoffDate,
    isLocked: isRsvpLocked(),
  };
}
