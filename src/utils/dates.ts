export function formatDate(
  iso: string | null | undefined,
  style: 'short' | 'full' = 'short',
): string {
  if (!iso) return '';
  // interpret as local time
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    weekday: style === 'full' ? 'long' : undefined,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
