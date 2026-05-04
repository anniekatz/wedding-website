export const config = {
  rsvpCutoffDate: process.env.RSVP_CUTOFF_DATE || null,
};

//past cutoff date?
export function isRsvpLocked(): boolean {
  if (!config.rsvpCutoffDate) {
    return false;
  }

  const cutoff = new Date(config.rsvpCutoffDate);
  const now = new Date();

  // Compare dates only (ignore time)
  cutoff.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  return today >= cutoff;
}


export function getRsvpSettings() {
  return {
    cutoffDate: config.rsvpCutoffDate,
    isLocked: isRsvpLocked(),
  };
}
