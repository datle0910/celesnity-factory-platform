export function formatAge(ageMinutes: number | null): string {
  if (ageMinutes === null) {
    return '—';
  }
  if (ageMinutes < 1) {
    return 'just now';
  }
  if (ageMinutes < 60) {
    return `${Math.floor(ageMinutes)}m ago`;
  }
  const hours = Math.floor(ageMinutes / 60);
  const minutes = Math.floor(ageMinutes % 60);
  return `${hours}h ${minutes}m ago`;
}
