export function formatDate(
  iso: string,
  style: 'short' | 'full' = 'short',
): string {
  // interpret as local time
  const date = new Date(iso + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: style === 'full' ? 'long' : undefined,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
